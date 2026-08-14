import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'cnm-cli-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('installedVersion', () => {
  it('reads a version string', async () => {
    const { installedVersion } = await import('../src/cli.js');
    const v = installedVersion();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });
});

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
