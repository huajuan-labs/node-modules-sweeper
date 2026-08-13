import { rm } from 'node:fs/promises';
import { basename } from 'node:path';
import defaultTrash from 'trash';
import type { Entry, DeleteOutcome, DeleteSummary } from './types.js';

export type DeleteMode = 'hard' | 'trash';

export interface DeleteOptions {
  mode: DeleteMode;
  /** Called as each entry is processed (for progress UI). */
  onProgress?: (entry: Entry, index: number, total: number) => void;
}

const NODE_MODULES = 'node_modules';

export async function deleteEntries(
  entries: Entry[],
  opts: DeleteOptions,
): Promise<DeleteSummary> {
  const ok: DeleteOutcome[] = [];
  const failed: DeleteOutcome[] = [];
  let freedBytes = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    opts.onProgress?.(entry, i, entries.length);

    // Defensive: never delete a symlinked node_modules (shared store) even if
    // somehow selected. The TUI forbids selecting these, but this module is
    // fail-safe on its own.
    if (entry.isSymlink) {
      failed.push({
        entry,
        ok: false,
        error: `refused: symlinked node_modules (shared store): ${entry.absPath}`,
      });
      continue;
    }

    // Path-safety assertion: ONLY ever delete a directory literally named node_modules.
    if (basename(entry.absPath) !== NODE_MODULES) {
      failed.push({
        entry,
        ok: false,
        error: `refused: path basename is not '${NODE_MODULES}' (${entry.absPath})`,
      });
      continue;
    }

    try {
      if (opts.mode === 'trash') {
        await defaultTrash(entry.absPath);
      } else {
        await rm(entry.absPath, { recursive: true, force: false });
      }
      ok.push({ entry, ok: true });
      if (entry.sizeBytes) freedBytes += entry.sizeBytes;
    } catch (err) {
      failed.push({
        entry,
        ok: false,
        error: (err as Error).message,
      });
    }
  }

  return { ok, failed, freedBytes };
}
