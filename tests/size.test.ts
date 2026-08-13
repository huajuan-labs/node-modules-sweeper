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

  it('forceWalk uses the JS fallback directly', async () => {
    const dir = join(root, 'nm');
    await mkdir(join(dir, 'pkg'), { recursive: true });
    await writeFile(join(dir, 'pkg', 'a.js'), 'aaaa'); // 4 bytes
    const size = await computeSize(dir, { isSymlink: false, forceWalk: true });
    expect(size).toBe(4);
  });
});
