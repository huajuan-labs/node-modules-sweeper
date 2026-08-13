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
    await mkdir(join(bad, 'sub'), { recursive: true }); // exists, must NOT be deleted
    await writeFile(join(a, 'pkg', 'x'), 'x');
    await writeFile(join(b, 'pkg', 'x'), 'xx');
    await writeFile(join(bad, 'sub', 'x'), 'x');
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

  it('refuses to delete a symlinked entry', async () => {
    const nm = join(root, 'node_modules');
    const entry: Entry = { ...mkEntry(nm, 0), isSymlink: true };
    const summary = await deleteEntries([entry], { mode: 'hard' });
    expect(summary.ok).toHaveLength(0);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].error).toMatch(/symlink/i);
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
