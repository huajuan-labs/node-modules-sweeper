/** A discovered node_modules directory, before/after size+activity enrichment. */
export interface Entry {
  /** Absolute filesystem path to the node_modules directory. */
  absPath: string;
  /** Path relative to the scan root, for display. */
  relPath: string;
  /** Size in bytes. `null` when skipped (symlink entry). */
  sizeBytes: number | null;
  /** Idle days derived from project activity signal. `null` until computed. */
  idleDays: number | null;
  /** True when the entry itself is a symlink (shared-store/workspace). Non-deletable. */
  isSymlink: boolean;
  /** Nearest ancestor containing package.json (project root), or null. */
  projectRoot: string | null;
}

export type SortKey = 'size' | 'idle' | 'path';

export interface DeleteOutcome {
  entry: Entry;
  ok: boolean;
  error?: string;
}

export interface DeleteSummary {
  ok: DeleteOutcome[];
  failed: DeleteOutcome[];
  freedBytes: number;
}

export interface ScanOptions {
  /** Root to scan. Must exist and be a directory. */
  root: string;
  /** Called with each discovered entry path during the walk (for progress). */
  onDiscover?: (absPath: string, count: number) => void;
}
