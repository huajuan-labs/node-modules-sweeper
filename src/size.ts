import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface SizeOptions {
  isSymlink: boolean;
  /** Force the JS fallback (used by tests / when du is known absent). */
  forceWalk?: boolean;
}

/** JS recursive walk: no symlink following, hard-link dedup by (dev, ino). */
export async function sizeByFsWalk(dir: string): Promise<number> {
  const seenInodes = new Set<string>();
  let total = 0;

  async function walk(d: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(d);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(d, name);
      let lst: Awaited<ReturnType<typeof lstat>>;
      try {
        lst = await lstat(p);
      } catch {
        continue;
      }
      if (lst.isSymbolicLink()) {
        // Do not follow; symlink's own lstat size is negligible — skip.
        continue;
      }
      if (lst.isFile()) {
        const key = `${lst.dev}:${lst.ino}`;
        if (lst.ino !== 0 && seenInodes.has(key)) continue; // hardlink dedup
        if (lst.ino !== 0) seenInodes.add(key);
        total += lst.size;
      } else if (lst.isDirectory()) {
        await walk(p);
      }
    }
  }

  await walk(dir);
  return total;
}

async function sizeByDu(dir: string): Promise<number | null> {
  try {
    const { stdout } = await execFileP('du', ['-sk', dir], { maxBuffer: 10 * 1024 * 1024 });
    // output: "<KB>\t<path>"
    const kb = parseInt(stdout.split('\t')[0].trim(), 10);
    if (Number.isNaN(kb)) return null;
    return kb * 1024;
  } catch {
    return null; // du unavailable or errored
  }
}

export async function computeSize(
  absPath: string,
  opts: SizeOptions,
): Promise<number | null> {
  if (opts.isSymlink) return null;
  if (!opts.forceWalk) {
    const du = await sizeByDu(absPath);
    if (du !== null) return du;
  }
  return sizeByFsWalk(absPath);
}
