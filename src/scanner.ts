import { readdir, stat, lstat } from 'node:fs/promises';
import { join, relative, dirname, resolve } from 'node:path';
import type { Entry, ScanOptions } from './types.js';

const IGNORE_NAMES = new Set(['.git', '.Trash', 'Library']);
const isHidden = (name: string) => name.startsWith('.') && name !== '.' && name !== '..';
const isAppBundle = (name: string) => name.endsWith('.app');

function shouldIgnore(name: string): boolean {
  return IGNORE_NAMES.has(name) || isHidden(name) || isAppBundle(name);
}

/** Walk up from a dir to find the nearest ancestor (incl. itself) containing package.json. */
async function findProjectRoot(start: string, ceiling: string): Promise<string | null> {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    try {
      const s = await stat(join(dir, 'package.json'));
      if (s.isFile()) return dir;
    } catch {
      // not present here
    }
    if (resolve(dir) === resolve(ceiling) || dir === dirname(dir)) break;
    dir = dirname(dir);
  }
  return null;
}

export interface ScanResult {
  entries: Entry[];
  /** Number of directories skipped because they could not be read (permissions). */
  permissionSkipped: number;
}

export async function scan(opts: ScanOptions): Promise<ScanResult> {
  const { root } = opts;
  const rootStat = await lstat(root).catch(() => {
    throw new Error(`scan root does not exist: ${root}`);
  });
  if (!rootStat.isDirectory() && !rootStat.isSymbolicLink()) {
    throw new Error(`scan root is not a directory: ${root}`);
  }

  const entries: Entry[] = [];
  let permissionSkipped = 0;

  async function walk(dir: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err) {
      // Permission error (EACCES/EPERM) — skip and count.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        permissionSkipped++;
      }
      return;
    }
    for (const name of names) {
      if (name === 'node_modules') {
        const abs = join(dir, name);
        const lst = await lstat(abs).catch(() => null);
        if (!lst) continue;
        const isSymlink = lst.isSymbolicLink();
        const projectRoot = await findProjectRoot(dir, root).catch(() => null);
        const entry: Entry = {
          absPath: abs,
          relPath: relative(root, abs),
          sizeBytes: null,
          idleDays: null,
          isSymlink,
          projectRoot,
        };
        entries.push(entry);
        opts.onDiscover?.(abs, entries.length);
        // Do NOT drill into node_modules.
        continue;
      }
      // Skip ignored dirs. Note: the scan-root directory itself is never passed
      // through here (it is the walk() entry point, not an iterated child), so a
      // hidden scan-root is entered automatically — the §3.1 exemption.
      if (shouldIgnore(name)) continue;
      const child = join(dir, name);
      let s: Awaited<ReturnType<typeof lstat>>;
      try {
        s = await lstat(child);
      } catch {
        continue;
      }
      // Follow directories (not symlinks to dirs — avoid loops / shared stores).
      if (s.isDirectory()) {
        await walk(child);
      }
    }
  }

  await walk(root);
  return { entries, permissionSkipped };
}
