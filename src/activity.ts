import { stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Entry } from './types.js';

const execFileP = promisify(execFile);
const DAY_MS = 86_400_000;
const MAX_UP = 10;

export interface ActivityOptions {
  /** Injected current time (ms). Defaults to Date.now(). */
  now?: number;
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

/** Walk up from `start` (inclusive) for the first dir satisfying `test`,
 *  up to MAX_UP levels or the filesystem root. */
async function findUp(
  start: string,
  test: (dir: string) => Promise<boolean>,
): Promise<string | null> {
  let dir = start;
  for (let i = 0; i < MAX_UP; i++) {
    if (await test(dir)) return dir;
    if (dir === dirname(dir)) break; // filesystem root
    dir = dirname(dir);
  }
  return null;
}

/** Returns committer timestamp (%ct) of last commit, or null if none / not a git repo.
 *  Note: %ct reads the committer date; tests pin it via GIT_COMMITTER_DATE env. */
async function lastCommitTs(gitDir: string): Promise<number | null> {
  try {
    const { stdout } = await execFileP(
      'git', ['-C', gitDir, 'log', '-1', '--format=%ct'], { maxBuffer: 1024 },
    );
    const ts = parseInt(stdout.trim(), 10);
    return Number.isNaN(ts) ? null : ts;
  } catch {
    // not a git repo, or zero commits (log fails)
    return null;
  }
}

export async function computeIdleDays(
  entry: Entry,
  opts: ActivityOptions = {},
): Promise<number | null> {
  const now = opts.now ?? Date.now();
  const startDir = entry.projectRoot ?? dirname(entry.absPath);

  // 1. Nearest .git with at least one commit. Walk up to the filesystem root
  //    (bounded by MAX_UP); per spec §3.4 the project root is the START of the
  //    upward search, not a ceiling — monorepos have .git above the package dir.
  const gitDir = await findUp(startDir, async (d) => exists(join(d, '.git')));
  if (gitDir) {
    const ts = await lastCommitTs(gitDir);
    if (ts !== null) {
      return Math.max(0, Math.floor((now - ts * 1000) / DAY_MS));
    }
    // empty repo — degrade to next signal
  }

  // 2. Nearest package.json mtime (also an upward search from the project root).
  const pkgDir = await findUp(startDir, async (d) => exists(join(d, 'package.json')));
  if (pkgDir) {
    try {
      const s = await stat(join(pkgDir, 'package.json'));
      return Math.max(0, Math.floor((now - s.mtimeMs) / DAY_MS));
    } catch {
      // fall through
    }
  }

  // 3. Fallback: node_modules dir mtime.
  try {
    const s = await stat(entry.absPath);
    return Math.max(0, Math.floor((now - s.mtimeMs) / DAY_MS));
  } catch {
    return null;
  }
}
