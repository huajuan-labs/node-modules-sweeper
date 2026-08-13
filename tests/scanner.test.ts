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

const nm = (p: string) => mkdir(p, { recursive: true });
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
    await mkdir(join(root, 'pkg'), { recursive: true });
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
      await chmod(locked, 0o755).catch(() => {});
    }
  });
});
