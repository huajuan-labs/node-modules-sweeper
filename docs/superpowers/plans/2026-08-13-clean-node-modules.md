# clean-node-modules Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Node.js CLI that recursively scans a directory for `node_modules`, shows an interactive ink TUI (sizes, idle time, paths, bar charts) for the user to select and delete them (hard delete or trash).

**Architecture:** Pure-logic core modules (`scanner`, `size`, `activity`, `format`, `delete`) are ink-free and unit-tested in isolation. The ink TUI is a thin React layer over that core. CLI wiring (`cli.ts`) orchestrates: scan → size+activity (with stdout progress) → non-TTY fallback OR ink TUI → delete. All deletes require explicit user selection + confirm; a `basename === 'node_modules'` assertion guards every deletion.

**Tech Stack:** TypeScript (ESM) + Node ≥22 / `commander` 15 / `ink` 7 + `react` 19 / `trash` 10 / `vitest` 4 + `ink-testing-library` 4

**Spec:** `docs/superpowers/specs/2026-08-13-clean-node-modules-design.md`

**Key API facts (verified):**
- ink 7 `render(tree, {exitOnCtrlC})` returns `{ unmount, rerender, waitUntilExit, clear }`
- `useInput((input, key) => {...})` for keyboard; `key.upArrow`/`key.downArrow`/`key.return`/`key.escape`
- `useApp()` → `{ exit }` to unmount cleanly (preferred over `process.exit`)
- `exitOnCtrlC` defaults `true`; we set it `false` and handle Ctrl+C ourselves via `useInput` for safe-exit semantics
- `render(..., { interactive })` auto-detects non-TTY (`interactive:false`); we explicitly branch on `process.stdout.isTTY` before rendering and fall back to plain-text table
- ink 7 requires React 19; ESM only (`"type": "module"`)

---

## File Structure

```
clean-node-modules/
  package.json
  tsconfig.json
  vitest.config.ts
  bin/clean-node-modules.js          # tiny ESM shebang launcher -> dist/cli.js
  src/
    types.ts                         # Entry, SortKey, DeleteResult types (shared)
    scanner.ts                       # recursive dir walk, ignore rules, perm-skip count -> Entry[] (no size)
    size.ts                          # du -sk main + JS inode-dedup fallback; symlink entry handling
    activity.ts                      # upward search .git/package.json -> idle days
    format.ts                        # bytes<->human, days->relative, size->bar ratio
    delete.ts                        # hard delete / trash + basename assertion + failure collection
    progress.ts                      # tiny stdout single-line progress printer (pre-TUI only)
    cli.ts                           # commander parse + orchestration + TTY branch + git init guard
    ui/
      App.tsx                        # main screen state machine (list / confirm / deleting / result)
      Row.tsx                        # one entry row
      SummaryBar.tsx                 # bottom totals panel
      ConfirmDialog.tsx              # second confirm screen
      DeletingView.tsx               # per-item delete progress
  tests/
    scanner.test.ts
    size.test.ts
    activity.test.ts
    format.test.ts
    delete.test.ts
    ui/App.test.tsx
    fixtures/                        # built by tests via tmpdir; see Task notes
```

Each `src/*.ts` has one responsibility, is ink-free (except `src/ui/*`), and is independently unit-testable.

---

## Chunk 1: Project scaffold + types + format

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `bin/clean-node-modules.js`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "clean-node-modules",
  "version": "0.1.0",
  "type": "module",
  "description": "Scan and selectively clean node_modules directories",
  "bin": {
    "clean-node-modules": "bin/clean-node-modules.js"
  },
  "exports": "./dist/cli.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "engines": { "node": ">=22" },
  "dependencies": {
    "commander": "^15.0.0",
    "ink": "^7.1.1",
    "react": "^19.2.8",
    "trash": "^10.1.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.2.0",
    "ink-testing-library": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
```

- [ ] **Step 4: Create `bin/clean-node-modules.js`**

```js
#!/usr/bin/env node
import '../dist/cli.js';
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 6: Install deps**

Run: `npm install`
Expected: installs without error; `node_modules/` created.

- [ ] **Step 7: Verify typecheck + test runner bootstrap**

Run: `npx tsc --noEmit && npx vitest run --passWithNoTests`
Expected: tsc passes (no sources yet → no errors); vitest reports "No test files found" and exits 0 (the `--passWithNoTests` flag makes a zero-test run succeed rather than exit 1).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold typescript + vitest + ink project"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared Entry/result types"
```

---

### Task 3: format module (TDD)

**Files:**
- Create: `src/format.ts`
- Test: `tests/format.test.ts`

Pure functions: bytes→human, idle days→relative text, size→bar ratio.

- [ ] **Step 1: Write the failing test**

```ts
// tests/format.test.ts
import { describe, it, expect } from 'vitest';
import { formatBytes, formatIdleDays, barRatio, renderBar } from '../src/format.js';

describe('formatBytes', () => {
  it('0 bytes', () => expect(formatBytes(0)).toBe('0B'));
  it('under 1KB', () => expect(formatBytes(512)).toBe('512B'));
  it('KB', () => expect(formatBytes(2048)).toBe('2.0KB'));
  it('MB', () => expect(formatBytes(128 * 1024 * 1024)).toBe('128.0MB'));
  it('GB', () => expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.0GB'));
  it('null -> placeholder', () => expect(formatBytes(null)).toBe('  —  '));
});

describe('formatIdleDays', () => {
  it('0 days', () => expect(formatIdleDays(0)).toBe('today'));
  it('1 day', () => expect(formatIdleDays(1)).toBe('1d'));
  it('45 days', () => expect(formatIdleDays(45)).toBe('45d'));
  it('365 days', () => expect(formatIdleDays(365)).toBe('365d'));
  it('null -> unknown', () => expect(formatIdleDays(null)).toBe('  ?  '));
});

describe('barRatio', () => {
  it('max is full', () => expect(barRatio(100, 100)).toBe(1));
  it('half', () => expect(barRatio(50, 100)).toBe(0.5));
  it('zero of max', () => expect(barRatio(0, 100)).toBe(0));
  it('max is 0 -> 0 (no divide-by-zero)', () => expect(barRatio(10, 0)).toBe(0));
  it('null size -> 0', () => expect(barRatio(null, 100)).toBe(0));
});

describe('renderBar', () => {
  it('full bar', () => expect(renderBar(1, 8)).toBe('████████'));
  it('half bar', () => expect(renderBar(0.5, 8)).toBe('████░░░░'));
  it('empty bar', () => expect(renderBar(0, 8)).toBe('░░░░░░░░'));
  it('rounds up partial cell', () => expect(renderBar(0.51, 8)).toBe('█████░░░'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/format.ts
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '  —  ';
  if (bytes === 0) return '0B';
  let unit = 0;
  let value = bytes;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const unitLabel = UNITS[unit];
  return unit === 0 ? `${value}${unitLabel}` : `${value.toFixed(1)}${unitLabel}`;
}

export function formatIdleDays(days: number | null): string {
  if (days === null) return '  ?  ';
  if (days === 0) return 'today';
  return `${days}d`;
}

export function barRatio(size: number | null, maxSize: number): number {
  if (size === null || maxSize === 0) return 0;
  return Math.min(size / maxSize, 1);
}

const FULL = '█';
const EMPTY = '░';

export function renderBar(ratio: number, cells: number): string {
  // Round up so a partially-filled cell (e.g. ratio 0.51 → 5/8) shows as filled.
  const filled = Math.min(Math.ceil(ratio * cells), cells);
  return FULL.repeat(filled).padEnd(cells, EMPTY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/format.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/format.ts tests/format.test.ts
git commit -m "feat: add format helpers (bytes/days/bar)"
```

---

## Chunk 2: scanner module

### Task 4: scanner — recursive walk, ignore rules, permission skips (TDD)

**Files:**
- Create: `src/scanner.ts`
- Test: `tests/scanner.test.ts`

`scan(opts)` walks `opts.root` depth-first, yields `node_modules` dirs as partial `Entry` objects (size/activity filled later). Stops drilling at any `node_modules`. Skips ignore-list dirs. Counts permission errors into `permissionSkipped`.

Returns `ScanResult` (`{ entries, permissionSkipped }`) so the CLI can print "X directories skipped due to permissions" per spec §3.1.

**Ignore rules (spec §3.1):** `.git`, `.Trash`, hidden dirs (`.*`), `*.app`, `Library/`. The scan-root *directory itself* is exempt when hidden — its own name is never checked by `walk` (the root is the starting point, not a child iterated over), so the exemption is automatic.

- [ ] **Step 1: Write the failing test**

```ts
// tests/scanner.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../src/scanner.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cnm-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// helper: create a node_modules dir
const nm = (p: string) => mkdir(p, { recursive: true });
// scan returns ScanResult; extract entries for brevity in most tests
const entriesOf = (r: Awaited<ReturnType<typeof scan>>) => r.entries;

describe('scan', () => {
  it('discovers top-level node_modules', async () => {
    await nm(join(root, 'node_modules'));
    const entries = entriesOf(await scan({ root }));
    expect(entries).toHaveLength(1);
    expect(entries[0].absPath).toBe(join(root, 'node_modules'));
    expect(entries[0].relPath).toBe('node_modules');
  });

  it('does not drill into node_modules (nested not separate)', async () => {
    // root/node_modules/pkg/node_modules -> only the outer is one entry
    await nm(join(root, 'node_modules', 'pkg', 'node_modules'));
    const entries = entriesOf(await scan({ root }));
    expect(entries).toHaveLength(1);
    expect(entries[0].absPath).toBe(join(root, 'node_modules'));
  });

  it('discovers node_modules in nested project dirs', async () => {
    await nm(join(root, 'apps', 'web', 'node_modules'));
    await nm(join(root, 'apps', 'api', 'node_modules'));
    const entries = entriesOf(await scan({ root }));
    expect(entries.map(e => e.relPath).sort()).toEqual([
      'apps/api/node_modules',
      'apps/web/node_modules',
    ]);
  });

  it('skips .git', async () => {
    await nm(join(root, '.git', 'node_modules'));
    await nm(join(root, 'real', 'node_modules'));
    const entries = entriesOf(await scan({ root }));
    expect(entries).toHaveLength(1);
    expect(entries[0].relPath).toBe('real/node_modules');
  });

  it('skips hidden dirs', async () => {
    await nm(join(root, '.cache', 'node_modules'));
    await nm(join(root, 'pkg', 'node_modules'));
    const entries = entriesOf(await scan({ root }));
    expect(entries).toHaveLength(1);
    expect(entries[0].relPath).toBe('pkg/node_modules');
  });

  it('skips *.app bundles', async () => {
    await nm(join(root, 'VSCode.app', 'Contents', 'Resources', 'app', 'node_modules'));
    await nm(join(root, 'pkg', 'node_modules'));
    const entries = entriesOf(await scan({ root }));
    expect(entries).toHaveLength(1);
    expect(entries[0].relPath).toBe('pkg/node_modules');
  });

  it('skips Library/', async () => {
    await nm(join(root, 'Library', 'node_modules'));
    await nm(join(root, 'pkg', 'node_modules'));
    const entries = entriesOf(await scan({ root }));
    expect(entries).toHaveLength(1);
  });

  it('skips .Trash', async () => {
    await nm(join(root, '.Trash', 'node_modules'));
    await nm(join(root, 'pkg', 'node_modules'));
    const entries = entriesOf(await scan({ root }));
    expect(entries).toHaveLength(1);
    expect(entries[0].relPath).toBe('pkg/node_modules');
  });

  it('scan-root hidden dir is exempt (still enters it)', async () => {
    // root itself is e.g. ~/.config ; make a hidden root and scan it.
    // The root's own name is never checked by walk, so hidden roots are entered.
    const hidden = join(root, '.myconfig');
    await nm(join(hidden, 'pkg', 'node_modules'));
    const entries = entriesOf(await scan({ root: hidden }));
    expect(entries).toHaveLength(1);
    expect(entries[0].relPath).toBe('pkg/node_modules');
  });

  it('rejects non-existent root', async () => {
    await expect(scan({ root: join(root, 'nope') })).rejects.toThrow();
  });

  it('rejects non-directory root', async () => {
    const f = join(root, 'file');
    await writeFile(f, 'x');
    await expect(scan({ root: f })).rejects.toThrow();
  });

  it('marks symlinked node_modules entry as isSymlink', async () => {
    const target = join(root, 'store');
    await nm(target);
    await symlink(target, join(root, 'node_modules'), 'dir');
    const entries = entriesOf(await scan({ root }));
    expect(entries).toHaveLength(1);
    expect(entries[0].isSymlink).toBe(true);
  });

  it('records projectRoot (nearest ancestor with package.json)', async () => {
    await writeFile(join(root, 'pkg', 'package.json'), '{}');
    await nm(join(root, 'pkg', 'node_modules'));
    const entries = entriesOf(await scan({ root }));
    expect(entries[0].projectRoot).toBe(join(root, 'pkg'));
  });

  it('invokes onDiscover callback per entry', async () => {
    await nm(join(root, 'a', 'node_modules'));
    await nm(join(root, 'b', 'node_modules'));
    const seen: string[] = [];
    await scan({ root, onDiscover: (abs) => seen.push(abs) });
    expect(seen).toHaveLength(2);
  });

  it('counts permission-denied directories in permissionSkipped', async () => {
    // A dir we cannot read (mode 000). Still find node_modules elsewhere.
    const locked = join(root, 'locked');
    await nm(join(locked, 'inner', 'node_modules'));
    await nm(join(root, 'ok', 'node_modules'));
    await chmod(locked, 0o000);
    try {
      const result = await scan({ root });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].relPath).toBe('ok/node_modules');
      expect(result.permissionSkipped).toBeGreaterThanOrEqual(1);
    } finally {
      // restore so afterEach rm can clean up
      await chmod(locked, 0o755).catch(() => {});
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scanner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/scanner.ts
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
      if ((err as NodeJS.ErrnoException).code === 'EACCES' || (err as NodeJS.ErrnoException).code === 'EPERM') {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scanner.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/scanner.ts tests/scanner.test.ts
git commit -m "feat: add recursive node_modules scanner with ignore rules"
```

---

## Chunk 3: size + activity modules

### Task 5: size module — du -sk main + JS inode-dedup fallback (TDD)

**Files:**
- Create: `src/size.ts`
- Test: `tests/size.test.ts`

`computeSize(absPath, opts)` returns bytes for a real directory, or `null` for a symlink entry (caller skips). Main path spawns `du -sk`; if `du` is unavailable (spawning fails / non-zero exit) it falls back to a JS recursive walk that (a) does not follow symlinks and (b) dedups hard links by `(dev, ino)`. The JS fallback is the unit-testable core; `du` is exercised by an integration test that is skipped when `du` is absent.

- [ ] **Step 1: Write the failing test**

```ts
// tests/size.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeSize, sizeByFsWalk } from '../src/size.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'cnm-size-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('sizeByFsWalk (JS fallback)', () => {
  it('sums file sizes in a directory tree', async () => {
    const dir = join(root, 'nm');
    await mkdir(join(dir, 'pkg'), { recursive: true });
    await writeFile(join(dir, 'pkg', 'a.js'), 'aaaa');      // 4 bytes
    await writeFile(join(dir, 'index.js'), 'bb');           // 2 bytes
    const size = await sizeByFsWalk(dir);
    expect(size).toBe(6);
  });

  it('does not follow symlinks', async () => {
    const dir = join(root, 'nm');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'real.txt'), 'xxxx');         // 4 bytes
    // symlink pointing outside the tree — must NOT be followed/counted by its target
    await symlink(join(root, 'nm', 'real.txt'), join(dir, 'link.txt'));
    const size = await sizeByFsWalk(dir);
    expect(size).toBe(4); // only real.txt; symlink itself contributes ~0 (lstat size)
  });

  it('dedups hard links (counts shared inode once)', async () => {
    const dir = join(root, 'nm');
    await mkdir(dir, { recursive: true });
    const orig = join(dir, 'orig.txt');
    await writeFile(orig, 'xxxxxxxxxx');                    // 10 bytes
    await link(orig, join(dir, 'hardlink.txt'));            // same inode
    const size = await sizeByFsWalk(dir);
    expect(size).toBe(10); // not 20
  });

  it('returns 0 for empty dir', async () => {
    const dir = join(root, 'empty');
    await mkdir(dir);
    expect(await sizeByFsWalk(dir)).toBe(0);
  });
});

describe('computeSize', () => {
  it('returns null for a symlink entry', async () => {
    const target = join(root, 'store');
    await mkdir(target);
    const linkPath = join(root, 'nm');
    await symlink(target, linkPath, 'dir');
    expect(await computeSize(linkPath, { isSymlink: true })).toBeNull();
  });

  it('returns a positive number for a real directory (du or fallback)', async () => {
    const dir = join(root, 'nm');
    await mkdir(dir);
    await writeFile(join(dir, 'data.bin'), 'x'.repeat(4096));
    const size = await computeSize(dir, { isSymlink: false });
    expect(size).not.toBeNull();
    expect(size!).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/size.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/size.ts
import { readdir, lstat, stat } from 'node:fs/promises';
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/size.test.ts`
Expected: PASS (all). (`computeSize` positive-number test uses whichever path is available; on macOS/Linux `du` succeeds, elsewhere the fallback runs.)

- [ ] **Step 5: Commit**

```bash
git add src/size.ts tests/size.test.ts
git commit -m "feat: add size computation (du -sk + inode-dedup JS fallback)"
```

---

### Task 6: activity module — idle days signal (TDD)

**Files:**
- Create: `src/activity.ts`
- Test: `tests/activity.test.ts`

`computeIdleDays(entry, opts)` resolves project activity per spec §3.4:
1. Upward search (≤10 levels) for nearest `.git`; if the repo has ≥1 commit, use `git log -1 --format=%ct`. An empty repo (git present, 0 commits) degrades to step 2.
2. Else upward search for nearest `package.json` → its mtime.
3. Else the `node_modules` dir mtime.

Returns integer days since that timestamp (floor of now−ts / 86400), or `null` if nothing resolves. `opts.now` is injectable for deterministic tests.

- [ ] **Step 1: Write the failing test**

```ts
// tests/activity.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeIdleDays } from '../src/activity.js';
import type { Entry } from '../src/types.js';

const exec = promisify(execFile);
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'cnm-act-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const git = (...args: string[]) => exec('git', args, { cwd: root });

const NOW = new Date('2026-08-13T00:00:00Z').getTime();

const mkEntry = (absPath: string, projectRoot: string | null): Entry => ({
  absPath, relPath: absPath, sizeBytes: null, idleDays: null, isSymlink: false, projectRoot,
});

describe('computeIdleDays', () => {
  it('uses last git commit time', async () => {
    await git('init', '-q');
    await git('config', 'user.email', 't@t');
    await git('config', 'user.name', 't');
    await writeFile(join(root, 'a.txt'), 'x');
    await git('add', '.');
    // commit at 30 days ago
    const commitTs = Math.floor((NOW - 30 * 86400_000) / 1000);
    await exec('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x',
      '--date', `${commitTs} +0000`], { cwd: root });
    // author date is what %ct reads back for the commit? %ct = committer date.
    // Set committer date via env to be deterministic:
    await exec('git', ['commit', '--amend', '--no-edit', '--date', `${commitTs} +0000'],
      { cwd: root, env: { ...process.env, GIT_COMMITTER_DATE: `${commitTs} +0000` } });

    const entry = mkEntry(join(root, 'node_modules'), root);
    const days = await computeIdleDays(entry, { now: NOW });
    expect(days).toBe(30);
  });

  it('empty git repo degrades to package.json mtime', async () => {
    await git('init', '-q');
    const pkg = join(root, 'package.json');
    await writeFile(pkg, '{}');
    // set package.json mtime to 10 days ago
    const ts = (NOW - 10 * 86400_000) / 1000;
    await exec('touch', ['-d', new Date(ts * 1000).toISOString(), pkg]).catch(() => {});
    // fallback for touch -d portability: use utimes via fs
    const { utimes } = await import('node:fs/promises');
    await utimes(pkg, ts, ts);

    const entry = mkEntry(join(root, 'node_modules'), root);
    const days = await computeIdleDays(entry, { now: NOW });
    expect(days).toBe(10);
  });

  it('no git -> uses package.json mtime', async () => {
    const pkg = join(root, 'package.json');
    await writeFile(pkg, '{}');
    const ts = (NOW - 5 * 86400_000) / 1000;
    const { utimes } = await import('node:fs/promises');
    await utimes(pkg, ts, ts);

    const entry = mkEntry(join(root, 'node_modules'), root);
    const days = await computeIdleDays(entry, { now: NOW });
    expect(days).toBe(5);
  });

  it('monorepo: finds .git above package dir', async () => {
    // root/.git , root/packages/a/package.json , node_modules under a
    await git('init', '-q');
    await git('config', 'user.email', 't@t');
    await git('config', 'user.name', 't');
    await mkdir(join(root, 'packages', 'a'), { recursive: true });
    await writeFile(join(root, 'packages', 'a', 'package.json'), '{}');
    await writeFile(join(root, 'packages', 'a', 'index.js'), 'x');
    await git('add', '.');
    const commitTs = Math.floor((NOW - 20 * 86400_000) / 1000);
    await exec('git', ['commit', '-q', '-m', 'x', '--date', `${commitTs} +0000`],
      { cwd: root, env: { ...process.env, GIT_COMMITTER_DATE: `${commitTs} +0000` } });

    const entry = mkEntry(join(root, 'packages', 'a', 'node_modules'),
      join(root, 'packages', 'a'));
    const days = await computeIdleDays(entry, { now: NOW });
    expect(days).toBe(20);
  });

  it('fallback to node_modules mtime when nothing else', async () => {
    const nm = join(root, 'node_modules');
    await mkdir(nm);
    const ts = (NOW - 7 * 86400_000) / 1000;
    const { utimes } = await import('node:fs/promises');
    await utimes(nm, ts, ts);

    const entry = mkEntry(nm, null); // no projectRoot, no git, no package.json
    const days = await computeIdleDays(entry, { now: NOW });
    expect(days).toBe(7);
  });

  it('returns 0 for activity today', async () => {
    const pkg = join(root, 'package.json');
    await writeFile(pkg, '{}');
    const ts = NOW / 1000;
    const { utimes } = await import('node:fs/promises');
    await utimes(pkg, ts, ts);

    const entry = mkEntry(join(root, 'node_modules'), root);
    const days = await computeIdleDays(entry, { now: NOW });
    expect(days).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/activity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/activity.ts
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

/** Returns committer timestamp (%ct) of last commit, or null if none / not a git repo. */
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/activity.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/activity.ts tests/activity.test.ts
git commit -m "feat: add activity signal (git commit -> package.json -> nm mtime)"
```

---

## Chunk 4: delete + progress modules

### Task 7: delete module — hard delete / trash + path assertion (TDD)

**Files:**
- Create: `src/delete.ts`
- Test: `tests/delete.test.ts`

`deleteEntries(entries, opts)` deletes each entry, collecting outcomes. Hard delete uses `fs.rm`; `--trash` uses the `trash` package. Every deletion is guarded by `basename(path) === 'node_modules'` — a non-matching path is rejected and recorded as a failure, never deleted. A single failure does not abort the rest.

- [ ] **Step 1: Write the failing test**

```ts
// tests/delete.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteEntries } from '../src/delete.js';
import type { Entry } from '../src/types.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'cnm-del-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const mkEntry = (absPath: string, sizeBytes: number | null): Entry => ({
  absPath, relPath: absPath, sizeBytes, idleDays: null, isSymlink: false, projectRoot: null,
});

const exists = (p: string) => stat(p).then(() => true).catch(() => false);

describe('deleteEntries (hard delete)', () => {
  it('deletes a node_modules directory', async () => {
    const nm = join(root, 'node_modules');
    await mkdir(join(nm, 'pkg'), { recursive: true });
    await writeFile(join(nm, 'pkg', 'x'), 'x');
    const summary = await deleteEntries([mkEntry(nm, 2)], { mode: 'hard' });
    expect(await exists(nm)).toBe(false);
    expect(summary.ok).toHaveLength(1);
    expect(summary.failed).toHaveLength(0);
    expect(summary.freedBytes).toBe(2);
  });

  it('rejects a path whose basename is not node_modules', async () => {
    const danger = join(root, 'important');
    await mkdir(join(danger, 'sub'), { recursive: true });
    await writeFile(join(danger, 'sub', 'x'), 'x');
    const summary = await deleteEntries([mkEntry(danger, 100)], { mode: 'hard' });
    expect(await exists(danger)).toBe(true); // NOT deleted
    expect(summary.ok).toHaveLength(0);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].error).toMatch(/node_modules/);
  });

  it('a single failure does not abort subsequent deletes', async () => {
    const a = join(root, 'a', 'node_modules');
    const bad = join(root, 'notnm'); // wrong basename -> fails assertion
    const b = join(root, 'b', 'node_modules');
    await mkdir(join(a, 'pkg'), { recursive: true });
    await mkdir(join(b, 'pkg'), { recursive: true });
    await writeFile(join(a, 'pkg', 'x'), 'x');
    await writeFile(join(b, 'pkg', 'x'), 'xx');
    const summary = await deleteEntries(
      [mkEntry(a, 1), mkEntry(bad, 0), mkEntry(b, 2)],
      { mode: 'hard' },
    );
    expect(await exists(a)).toBe(false);
    expect(await exists(b)).toBe(false);
    expect(await exists(bad)).toBe(true);
    expect(summary.ok).toHaveLength(2);
    expect(summary.failed).toHaveLength(1);
    expect(summary.freedBytes).toBe(3);
  });

  it('records a filesystem error (missing dir) as a failure', async () => {
    const ghost = join(root, 'node_modules'); // never created
    const summary = await deleteEntries([mkEntry(ghost, 5)], { mode: 'hard' });
    expect(summary.ok).toHaveLength(0);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].ok).toBe(false);
  });
});

describe('deleteEntries (trash)', () => {
  it('moves a node_modules to trash', async () => {
    const nm = join(root, 'node_modules');
    await mkdir(join(nm, 'pkg'), { recursive: true });
    await writeFile(join(nm, 'pkg', 'x'), 'x');
    const summary = await deleteEntries([mkEntry(nm, 1)], { mode: 'trash' });
    expect(await exists(nm)).toBe(false);
    expect(summary.ok).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/delete.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/delete.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/delete.test.ts`
Expected: PASS (all). (The trash test relies on the `trash` package moving the dir out of place; on CI without a real trash it may still remove the path — assert on `exists(nm) === false` which holds either way.)

- [ ] **Step 5: Commit**

```bash
git add src/delete.ts tests/delete.test.ts
git commit -m "feat: add delete with basename assertion + failure collection"
```

---

### Task 8: progress module — pre-TUI stdout printer

**Files:**
- Create: `src/progress.ts`

Tiny single-line stdout progress printer for the scan/size phase (before ink takes over stdout). Overwrites the current line with `\r`. No tests required — trivial and exercised end-to-end via the CLI; keep it small.

- [ ] **Step 1: Write `src/progress.ts`**

```ts
// src/progress.ts

/** Overwrite the current terminal line with a status message (pre-TUI only). */
export function progressLine(msg: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\r${msg}`.padEnd(80));
}

export function progressDone(msg: string): void {
  if (!process.stdout.isTTY) {
    process.stdout.write(`${msg}\n`);
    return;
  }
  process.stdout.write(`\r${msg}`.padEnd(80) + '\n');
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/progress.ts
git commit -m "feat: add pre-TUI stdout progress printer"
```

---


## Chunk 5: ink TUI (Row, SummaryBar, ConfirmDialog, DeletingView, App)

> ink 7 + React 19. `render(tree, {exitOnCtrlC:false})` returns `{unmount, waitUntilExit}`. `useInput((input,key)=>...)` for keys (`key.upArrow/downArrow/return/escape`, `input==='q'/'a'/'s'/' '`). `useApp()` → `{exit}` to unmount cleanly. We set `exitOnCtrlC:false` and handle Ctrl+C in `useInput` (treat as safe-exit, same as `q`). All key handling is centralized in `App.tsx`.

### Task 9: Row component

**Files:**
- Create: `src/ui/Row.tsx`

Pure presentational component for one entry line. Uses Unicode glyphs: cursor `❯` (U+276F), selected `✓` (U+2713), symlink `⤳` (U+29F3), bar chars `█`/`░`.

- [ ] **Step 1: Write `src/ui/Row.tsx`**

```tsx
// src/ui/Row.tsx
import React from 'react';
import { Text } from 'ink';
import type { Entry } from '../types.js';
import { formatBytes, formatIdleDays, barRatio, renderBar } from '../format.js';

export interface RowProps {
  entry: Entry;
  selected: boolean;
  cursor: boolean;
  maxSize: number;
}

export const Row: React.FC<RowProps> = ({ entry, selected, cursor, maxSize }) => {
  const marker = entry.isSymlink ? '⤳' : selected ? '✓' : ' ';
  const bar = renderBar(barRatio(entry.sizeBytes, maxSize), 8);
  const size = formatBytes(entry.sizeBytes);
  const idle = formatIdleDays(entry.idleDays);
  const cursorMark = cursor ? '❯' : ' ';
  return (
    <Text>
      {cursorMark} [{marker}] {bar} {size} {idle} {entry.relPath}
    </Text>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ui/Row.tsx
git commit -m "feat(ui): add Row component"
```

---

### Task 10: SummaryBar component

**Files:**
- Create: `src/ui/SummaryBar.tsx`

Bottom totals panel: total count/size, selected count/size/freed, selected-ratio progress bar.

- [ ] **Step 1: Write `src/ui/SummaryBar.tsx`**

```tsx
// src/ui/SummaryBar.tsx
import React from 'react';
import { Text, Box } from 'ink';
import type { Entry } from '../types.js';
import { formatBytes, renderBar } from '../format.js';

export interface SummaryBarProps {
  entries: Entry[];
  selected: Set<string>;
}

export const SummaryBar: React.FC<SummaryBarProps> = ({ entries, selected }) => {
  const totalSize = entries.reduce((s, e) => s + (e.sizeBytes ?? 0), 0);
  const selectedEntries = entries.filter(e => selected.has(e.absPath));
  const selectedSize = selectedEntries.reduce((s, e) => s + (e.sizeBytes ?? 0), 0);
  const ratio = totalSize === 0 ? 0 : selectedSize / totalSize;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>Total: {entries.length} dirs / {formatBytes(totalSize)}</Text>
      <Text>Selected: {selected.size} dirs / {formatBytes(selectedSize)} to free</Text>
      <Text>Freed ratio: {renderBar(ratio, 20)} {(ratio * 100).toFixed(0)}%</Text>
    </Box>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ui/SummaryBar.tsx
git commit -m "feat(ui): add SummaryBar component"
```

---

### Task 11: ConfirmDialog + DeletingView components

**Files:**
- Create: `src/ui/ConfirmDialog.tsx`
- Create: `src/ui/DeletingView.tsx`

`ConfirmDialog` shows the second-confirm screen (N items, X to free, mode); Enter confirms, Esc cancels. `DeletingView` shows per-item delete progress + failures.

- [ ] **Step 1: Write `src/ui/ConfirmDialog.tsx`**

```tsx
// src/ui/ConfirmDialog.tsx
import React from 'react';
import { Text, Box, useInput } from 'ink';
import { formatBytes } from '../format.js';

export interface ConfirmDialogProps {
  count: number;
  bytes: number;
  mode: 'hard' | 'trash';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  count, bytes, mode, onConfirm, onCancel,
}) => {
  useInput((_input, key) => {
    if (key.return) onConfirm();
    else if (key.escape) onCancel();
  });
  return (
    <Box flexDirection="column">
      <Text color="yellow">Delete {count} node_modules ({formatBytes(bytes)})?</Text>
      <Text>Mode: {mode === 'trash' ? 'move to trash' : 'hard delete (irreversible)'}</Text>
      <Text dimColor>Enter to confirm · Esc to cancel</Text>
    </Box>
  );
};
```

- [ ] **Step 2: Write `src/ui/DeletingView.tsx`**

```tsx
// src/ui/DeletingView.tsx
import React from 'react';
import { Text, Box } from 'ink';
import type { DeleteOutcome } from '../types.js';

export interface DeletingViewProps {
  total: number;
  current?: { relPath: string; index: number } | null;
  outcomes: DeleteOutcome[];
}

export const DeletingView: React.FC<DeletingViewProps> = ({ total, current, outcomes }) => {
  const ok = outcomes.filter(o => o.ok).length;
  const failed = outcomes.filter(o => !o.ok);
  return (
    <Box flexDirection="column">
      {current ? (
        <Text>Deleting [{current.index + 1}/{total}] {current.relPath}…</Text>
      ) : (
        <Text>Done: {ok}/{total} succeeded.</Text>
      )}
      {failed.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">Failed ({failed.length}):</Text>
          {failed.map((o, i) => (
            <Text key={i} color="red">  {o.entry.relPath}: {o.error}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ui/ConfirmDialog.tsx src/ui/DeletingView.tsx
git commit -m "feat(ui): add ConfirmDialog and DeletingView components"
```

---

### Task 12: App — main screen state machine (TDD)

**Files:**
- Create: `src/ui/App.tsx`
- Test: `tests/ui/App.test.tsx`

`App` manages a screen state machine: `list` → `confirm` → `deleting` → `result` (back to `list`). State: entries, selected set, cursor index, sort key, screen. Keyboard: up/down move, space toggle, `a` toggle-all, `s` cycle sort, Enter → confirm, `q`/Ctrl+C → exit (via `useApp().exit`). Symlink entries cannot be selected (space on them is a no-op). After delete, removed entries leave the list and the summary updates.

**Keystroke encoding note:** ink-testing-library's `stdin.write` takes a string. Special keys are written as escape sequences using the ESC byte (0x1b) in the test source:
- Down arrow = ESC followed by `[B`
- Up arrow = ESC followed by `[A`
- Enter = `\r` (detected as `key.return`)
- Esc = the ESC byte (detected as `key.escape`)
- Plain letters = the literal char (e.g. `'q'`, `'a'`, `'s'`, `' '`)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/ui/App.test.tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/ui/App.js';
import type { Entry } from '../../src/types.js';

// Build special-key sequences from char codes so the source stays pure ASCII.
const ESC = String.fromCharCode(0x1b);
const DOWN = ESC + '[B';
const UP = ESC + '[A';

const mkEntry = (
  absPath: string, sizeBytes: number, idleDays: number, isSymlink = false,
): Entry => ({
  absPath, relPath: absPath, sizeBytes, idleDays, isSymlink, projectRoot: null,
});

// ink 7 reads stdin via the 'readable' event; multiple synchronous stdin.write
// calls coalesce into one keypress. A setTimeout(0) between writes lets each
// press land in a separate event-loop turn so ink re-fires its handler per key.
const flush = () => new Promise(r => setTimeout(r, 0));

const baseEntries: Entry[] = [
  mkEntry('proj/big', 200, 30),
  mkEntry('proj/small', 50, 5),
  mkEntry('proj/sym', 0, 10, true), // symlink, non-selectable
];

describe('App', () => {
  it('renders all entries with sort label', () => {
    const { lastFrame } = render(
      <App entries={baseEntries} mode="hard" onDelete={vi.fn()} onExit={vi.fn()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('proj/big');
    expect(frame).toContain('proj/small');
    expect(frame).toContain('sort: size');
  });

  it('space toggles selection (skips symlink)', async () => {
    const { stdin, lastFrame } = render(
      <App entries={baseEntries} mode="hard" onDelete={vi.fn()} onExit={vi.fn()} />,
    );
    stdin.write(' ');                  await flush(); // toggle first (big) on
    expect(lastFrame() ?? '').toContain('Selected: 1');
    stdin.write(DOWN);                 await flush(); // cursor -> small
    stdin.write(' ');                  await flush(); // toggle small on
    expect(lastFrame() ?? '').toContain('Selected: 2');
    stdin.write(DOWN);                 await flush(); // cursor -> symlink (3rd)
    stdin.write(' ');                  await flush(); // no-op
    expect(lastFrame() ?? '').toContain('Selected: 2');
  });

  it('a toggles all selectable entries', async () => {
    const { stdin, lastFrame } = render(
      <App entries={baseEntries} mode="hard" onDelete={vi.fn()} onExit={vi.fn()} />,
    );
    stdin.write('a'); await flush();
    expect(lastFrame() ?? '').toContain('Selected: 2'); // big + small; symlink excluded
  });

  it('s cycles sort keys', async () => {
    const { stdin, lastFrame } = render(
      <App entries={baseEntries} mode="hard" onDelete={vi.fn()} onExit={vi.fn()} />,
    );
    expect(lastFrame() ?? '').toContain('sort: size');
    stdin.write('s'); await flush();
    expect(lastFrame() ?? '').toContain('sort: idle');
    stdin.write('s'); await flush();
    expect(lastFrame() ?? '').toContain('sort: path');
    stdin.write('s'); await flush();
    expect(lastFrame() ?? '').toContain('sort: size');
  });

  it('Enter with selection shows confirm dialog', async () => {
    const { stdin, lastFrame } = render(
      <App entries={baseEntries} mode="hard" onDelete={vi.fn()} onExit={vi.fn()} />,
    );
    stdin.write(' '); await flush();
    stdin.write('\r'); await flush();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Delete 1 node_modules');
    expect(frame).toContain('Enter to confirm');
  });

  it('Esc from confirm returns to list', async () => {
    const { stdin, lastFrame } = render(
      <App entries={baseEntries} mode="hard" onDelete={vi.fn()} onExit={vi.fn()} />,
    );
    stdin.write(' '); await flush();
    stdin.write('\r'); await flush();   // -> confirm
    stdin.write(ESC); await flush();    // Esc
    expect(lastFrame() ?? '').toContain('proj/big'); // back to list
  });

  it('Enter on confirm calls onDelete with selected entries', async () => {
    const onDelete = vi.fn().mockResolvedValue({
      ok: [{ entry: baseEntries[0], ok: true }], failed: [], freedBytes: 200,
    });
    const { stdin } = render(
      <App entries={baseEntries} mode="hard" onDelete={onDelete} onExit={vi.fn()} />,
    );
    stdin.write(' ');    await flush(); // select big
    stdin.write('\r');   await flush(); // -> confirm
    stdin.write('\r');   await flush(); // confirm
    await flush();
    expect(onDelete).toHaveBeenCalledWith([baseEntries[0]], 'hard');
  });

  it('q exits via onExit', async () => {
    const onExit = vi.fn();
    const { stdin } = render(
      <App entries={baseEntries} mode="hard" onDelete={vi.fn()} onExit={onExit} />,
    );
    stdin.write('q'); await flush();
    expect(onExit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/App.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/ui/App.tsx
import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { Entry, SortKey, DeleteSummary } from '../types.js';
import { Row } from './Row.js';
import { SummaryBar } from './SummaryBar.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { DeletingView } from './DeletingView.js';

type Screen = 'list' | 'confirm' | 'deleting' | 'result';

export interface AppProps {
  entries: Entry[];
  mode: 'hard' | 'trash';
  /** Delete the given entries; resolves a summary. */
  onDelete: (entries: Entry[], mode: 'hard' | 'trash') => Promise<DeleteSummary>;
  onExit: () => void;
}

const SORT_LABEL: Record<SortKey, string> = { size: 'size', idle: 'idle', path: 'path' };
const NEXT_SORT: Record<SortKey, SortKey> = { size: 'idle', idle: 'path', path: 'size' };

function sortEntries(entries: Entry[], key: SortKey): Entry[] {
  const copy = [...entries];
  switch (key) {
    case 'size':
      copy.sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
      break;
    case 'idle':
      copy.sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0));
      break;
    case 'path':
      copy.sort((a, b) => a.relPath.localeCompare(b.relPath));
      break;
  }
  return copy;
}

export const App: React.FC<AppProps> = ({ entries: initialEntries, mode, onDelete, onExit }) => {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>('list');
  const [sortKey, setSortKey] = useState<SortKey>('size');
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [deleteSummary, setDeleteSummary] = useState<DeleteSummary | null>(null);

  const sorted = sortEntries(entries, sortKey);
  const maxSize = Math.max(1, ...entries.map(e => e.sizeBytes ?? 0));
  const selectable = sorted.filter(e => !e.isSymlink);

  const safeExit = useCallback(() => {
    exit();
    onExit();
  }, [exit, onExit]);

  // Single useInput handles all screens (hooks must run unconditionally).
  useInput((input, key) => {
    if (screen === 'result') { setScreen('list'); return; }
    if (screen !== 'list') return;
    if (input === 'q' || (key.ctrl && input === 'c')) { safeExit(); return; }
    if (input === 's') { setSortKey(k => NEXT_SORT[k]); return; }
    if (input === 'a') {
      setSelected(prev => {
        const allSelected = selectable.every(e => prev.has(e.absPath));
        const next = new Set(prev);
        for (const e of selectable) {
          if (allSelected) next.delete(e.absPath);
          else next.add(e.absPath);
        }
        return next;
      });
      return;
    }
    if (input === ' ') {
      const e = sorted[cursor];
      if (e && !e.isSymlink) {
        setSelected(prev => {
          const next = new Set(prev);
          if (next.has(e.absPath)) next.delete(e.absPath);
          else next.add(e.absPath);
          return next;
        });
      }
      return;
    }
    if (key.downArrow) { setCursor(c => Math.min(c + 1, sorted.length - 1)); return; }
    if (key.upArrow) { setCursor(c => Math.max(c - 1, 0)); return; }
    if (key.return) {
      if (selected.size > 0) setScreen('confirm');
      return;
    }
  });

  const doDelete = useCallback(async () => {
    setScreen('deleting');
    const toDelete = entries.filter(e => selected.has(e.absPath));
    const summary = await onDelete(toDelete, mode);
    setDeleteSummary(summary);
    const removed = new Set(summary.ok.map(o => o.entry.absPath));
    setEntries(prev => prev.filter(e => !removed.has(e.absPath)));
    setSelected(new Set());
    setCursor(0);
    setScreen('result');
  }, [entries, selected, mode, onDelete]);

  if (screen === 'confirm') {
    const sel = entries.filter(e => selected.has(e.absPath));
    const bytes = sel.reduce((s, e) => s + (e.sizeBytes ?? 0), 0);
    return (
      <ConfirmDialog
        count={sel.length}
        bytes={bytes}
        mode={mode}
        onConfirm={doDelete}
        onCancel={() => setScreen('list')}
      />
    );
  }

  if (screen === 'deleting' || screen === 'result') {
    const outcomes = deleteSummary
      ? [...deleteSummary.ok, ...deleteSummary.failed]
      : [];
    return (
      <Box flexDirection="column">
        <DeletingView
          total={outcomes.length || selected.size}
          current={null}
          outcomes={outcomes}
        />
        {screen === 'result' && (
          <Box marginTop={1}>
            <Text dimColor>Press any key to return to list…</Text>
          </Box>
        )}
      </Box>
    );
  }

  // list screen
  return (
    <Box flexDirection="column">
      <Text bold>clean-node-modules — sort: {SORT_LABEL[sortKey]} (s to cycle)</Text>
      {sorted.map((e, i) => (
        <Row
          key={e.absPath}
          entry={e}
          selected={selected.has(e.absPath)}
          cursor={i === cursor}
          maxSize={maxSize}
        />
      ))}
      <SummaryBar entries={sorted} selected={selected} />
      <Text dimColor>up/down move · space select · a all · s sort · enter delete · q quit</Text>
    </Box>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui/App.test.tsx`
Expected: PASS (all 8).

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx tests/ui/App.test.tsx
git commit -m "feat(ui): add App state machine (list/confirm/deleting/result)"
```

---


## Chunk 6: CLI orchestration + integration

### Task 13: cli.tsx — commander parse, scan/size/activity pipeline, TTY branch

**Files:**
- Create: `src/cli.tsx` (note `.tsx` — contains JSX for the `<App>` render call)
- Modify: `bin/clean-node-modules.js` (call `main` explicitly; no auto-run in cli)
- Test: `tests/cli.test.ts`

`cli.tsx` is the entry point. It parses args with `commander`, runs the scan→size→activity pipeline (printing pre-TUI progress), then either:
- **TTY**: renders the ink `App`, wiring `onDelete` to `deleteEntries` and `onExit` to `unmount`.
- **Non-TTY**: prints a plain-text table and exits (no deletion allowed).

It also handles the `$HOME` / `/` scan-root warning, the `--min-days` pre-filter, the scan-root-exists check, and the permission-skip summary message.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// We test the pure orchestration helper `runScan` (scan+size+activity+filter),
// not the ink render path (which needs a TTY). The TTY branch is exercised
// manually in the final verification step.

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'cnm-cli-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('runScan', () => {
  it('returns enriched entries with size and idleDays', async () => {
    const { runScan } = await import('../src/cli.js');
    const nm = join(root, 'pkg', 'node_modules');
    await mkdir(join(nm, 'dep'), { recursive: true });
    await writeFile(join(nm, 'dep', 'x'), 'x'.repeat(100));
    await writeFile(join(root, 'pkg', 'package.json'), '{}');
    const result = await runScan({ root, minDays: 0 });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].sizeBytes).not.toBeNull();
    expect(result.entries[0].sizeBytes!).toBeGreaterThan(0);
    expect(result.entries[0].idleDays).not.toBeNull();
    expect(result.entries[0].idleDays!).toBeGreaterThanOrEqual(0);
  });

  it('filters by minDays', async () => {
    const { runScan } = await import('../src/cli.js');
    await mkdir(join(root, 'pkg', 'node_modules', 'dep'), { recursive: true });
    await writeFile(join(root, 'pkg', 'package.json'), '{}');
    // minDays huge -> entry filtered out
    const result = await runScan({ root, minDays: 99999 });
    expect(result.entries).toHaveLength(0);
  });

  it('reports permissionSkipped from scanner', async () => {
    const { runScan } = await import('../src/cli.js');
    const result = await runScan({ root, minDays: 0 });
    expect(result).toHaveProperty('permissionSkipped');
    expect(typeof result.permissionSkipped).toBe('number');
  });

  it('rejects non-existent root', async () => {
    const { runScan } = await import('../src/cli.js');
    await expect(runScan({ root: join(root, 'nope'), minDays: 0 })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/cli.tsx
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { scan } from './scanner.js';
import { computeSize } from './size.js';
import { computeIdleDays } from './activity.js';
import { deleteEntries } from './delete.js';
import { progressLine, progressDone } from './progress.js';
import { formatBytes } from './format.js';
import { App } from './ui/App.js';
import type { Entry } from './types.js';
import { resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

export interface RunScanResult {
  entries: Entry[];
  permissionSkipped: number;
}

/** Scan + size + activity enrichment + minDays filter. Pure, testable. */
export async function runScan(opts: {
  root: string;
  minDays: number;
  now?: number;
  onDiscover?: (abs: string, count: number) => void;
}): Promise<RunScanResult> {
  const { entries, permissionSkipped } = await scan({
    root: opts.root,
    onDiscover: opts.onDiscover,
  });

  // Size pass.
  let sized = 0;
  for (const e of entries) {
    progressLine(`Sizing ${sized + 1}/${entries.length} …`);
    e.sizeBytes = await computeSize(e.absPath, { isSymlink: e.isSymlink });
    sized++;
  }

  // Activity pass.
  for (const e of entries) {
    e.idleDays = await computeIdleDays(e, { now: opts.now });
  }
  progressDone(`Found ${entries.length} node_modules`);

  // Filter.
  const filtered = entries.filter(
    e => e.idleDays !== null && e.idleDays >= opts.minDays,
  );
  return { entries: filtered, permissionSkipped };
}

/** Plain-text table for non-TTY mode. */
function renderTable(entries: Entry[]): string {
  const header = 'SIZE        IDLE   PATH';
  const lines = entries.map(e =>
    `${formatBytes(e.sizeBytes).padEnd(11)} ${String(e.idleDays ?? '?').padEnd(6)} ${e.relPath}`,
  );
  const total = entries.reduce((s, e) => s + (e.sizeBytes ?? 0), 0);
  return [header, ...lines, '', `Total: ${entries.length} dirs / ${formatBytes(total)}`].join('\n');
}

async function confirmWideRoot(root: string): Promise<boolean> {
  const abs = isAbsolute(root) ? root : resolve(root);
  const home = homedir();
  if (abs === home || abs === '/') {
    process.stderr.write(
      `Warning: scanning ${abs} may find node_modules inside applications.\nContinue? [y/N] `,
    );
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) {
      chunks.push(c as Buffer);
      if (chunks.join('').includes('\n')) break;
    }
    const answer = chunks.join('').trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  }
  return true;
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name('clean-node-modules')
    .argument('[scan-root]', 'directory to scan', '.')
    .option('--trash', 'move to trash instead of hard delete')
    .option('--min-days <n>', 'only show entries idle >= n days', '0')
    .action(async (scanRoot: string, opts: { trash?: boolean; minDays: string }) => {
      const minDays = parseInt(opts.minDays, 10) || 0;
      const mode: 'hard' | 'trash' = opts.trash ? 'trash' : 'hard';

      if (!(await confirmWideRoot(scanRoot))) {
        process.exit(0);
      }

      let result: RunScanResult;
      try {
        result = await runScan({
          root: scanRoot,
          minDays,
          onDiscover: (_abs, count) => progressLine(`Scanning… found ${count}`),
        });
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exit(1);
      }

      if (result.permissionSkipped > 0) {
        process.stderr.write(
          `${result.permissionSkipped} director${result.permissionSkipped === 1 ? 'y' : 'ies'} skipped due to permissions.\n`,
        );
      }

      if (result.entries.length === 0) {
        process.stdout.write('No node_modules found.\n');
        return;
      }

      // Non-TTY: table only, no deletion.
      if (!process.stdout.isTTY) {
        process.stdout.write(renderTable(result.entries) + '\n');
        return;
      }

      // TTY: ink TUI.
      const { unmount, waitUntilExit } = render(
        <App
          entries={result.entries}
          mode={mode}
          onDelete={async (toDelete, m) => deleteEntries(toDelete, { mode: m })}
          onExit={() => unmount()}
        />,
        { exitOnCtrlC: false },
      );
      await waitUntilExit();
    });

  await program.parseAsync(argv, { from: 'user' });
}
```

`cli.tsx` only exports `main` and `runScan` — it does NOT auto-run. The bin launcher calls `main` explicitly:

```js
// bin/clean-node-modules.js
#!/usr/bin/env node
import { main } from '../dist/cli.js';
main(process.argv.slice(2)).catch(err => {
  process.stderr.write('Fatal: ' + (err && err.message ? err.message : String(err)) + '\n');
  process.exit(1);
});
```

> **No `isMain` auto-run:** a tautological `isMain` guard would fire `main()` on every import (including the test's dynamic `import('../src/cli.js')`). Exporting `main`/`runScan` and invoking from the bin launcher avoids that. The bin is plain JS (no type-check), so no casts needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS (all 4). The test imports `runScan` only; `main` is never auto-invoked.

- [ ] **Step 5: Typecheck whole project**

Run: `npx tsc --noEmit`
Expected: PASS (zero errors across all sources, including JSX in `cli.tsx`).

- [ ] **Step 6: Commit**

```bash
git add src/cli.tsx bin/clean-node-modules.js tests/cli.test.ts
git commit -m "feat: add CLI orchestration (scan pipeline + TTY/non-TTY branch)"
```

---

### Task 14: Full test suite + build + manual smoke test

**Files:**
- None (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: ALL tests pass (format, scanner, size, activity, delete, ui/App, cli).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `dist/` populated with compiled JS, no errors.

- [ ] **Step 4: Non-TTY smoke test**

Create a throwaway tree and run the compiled CLI through a pipe (non-TTY path):

```bash
T=$(mktemp -d)
mkdir -p "$T/pkg/node_modules/dep"
echo 'x' > "$T/pkg/node_modules/dep/x"
echo '{}' > "$T/pkg/package.json"
node bin/clean-node-modules.js "$T" | cat
rm -rf "$T"
```
Expected: a SIZE/IDLE/PATH table with one row and a Total line; no TUI, no deletion.

- [ ] **Step 5: TTY smoke test (manual)**

Run interactively (must be a real terminal):

```bash
node bin/clean-node-modules.js .
```
Expected:
- Scanning progress line, then the ink list UI with the project's own `node_modules` row(s).
- `space` toggles selection, `a` selects all, `s` cycles sort, summary panel updates live.
- `enter` on a selection shows the confirm dialog; `Esc` returns; `enter` again deletes (use the project's own `node_modules` only if you're OK reinstalling — otherwise point at a throwaway dir).
- `q` exits cleanly, restoring the terminal.

If the real `node_modules` of this project is the only candidate and you don't want to delete it, point the smoke test at the throwaway tree from Step 4 and delete the fake entry there.

- [ ] **Step 6: Commit + tag**

```bash
git add -A
git commit --allow-empty -m "chore: v0.1.0 verification complete (tests + build + smoke)"
git tag v0.1.0
```

---
