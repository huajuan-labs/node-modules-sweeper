import { readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve, isAbsolute } from 'node:path';

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

/**
 * List the entries of `dir` for the directory browser.
 * - Only directories are returned (files are filtered out — the browser navigates dirs).
 *   Actually: return both, but mark isDir, so the UI can show files greyed/non-selectable.
 *   For simplicity and to match the agreed design, we return directories only.
 * - Hidden entries (starting with '.') are hidden from the browser to reduce noise.
 * - Entries that cannot be read (permissions) are skipped.
 * - Sorted: directories first, then alphabetically (case-insensitive).
 */
export async function listDir(dir: string): Promise<{ entries: DirEntry[]; parent: string | null }> {
  const abs = isAbsolute(dir) ? dir : resolve(dir);
  let names: string[];
  try {
    names = await readdir(abs);
  } catch {
    return { entries: [], parent: parentOf(abs) };
  }

  const entries: DirEntry[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue; // hide hidden
    const p = join(abs, name);
    try {
      const s = await stat(p);
      if (s.isDirectory()) {
        entries.push({ name, path: p, isDir: true });
      }
    } catch {
      // stat failed (permissions / broken symlink) — skip
    }
  }

  entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  return { entries, parent: parentOf(abs) };
}

function parentOf(abs: string): string | null {
  const parent = dirname(abs);
  if (parent === abs) return null; // filesystem root
  return parent;
}

/** Resolve a starting directory for the browser. Used when no scan-root is given. */
export function startingDir(): string {
  return resolve('.');
}
