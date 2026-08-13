import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
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
    const commitTs = Math.floor((NOW - 30 * 86400_000) / 1000);
    await exec('git', ['commit', '-q', '-m', 'x', '--date', `${commitTs} +0000`],
      { cwd: root, env: { ...process.env, GIT_COMMITTER_DATE: `${commitTs} +0000` } });

    const entry = mkEntry(join(root, 'node_modules'), root);
    const days = await computeIdleDays(entry, { now: NOW });
    expect(days).toBe(30);
  });

  it('empty git repo degrades to package.json mtime', async () => {
    await git('init', '-q');
    const pkg = join(root, 'package.json');
    await writeFile(pkg, '{}');
    const ts = (NOW - 10 * 86400_000) / 1000;
    await utimes(pkg, ts, ts);

    const entry = mkEntry(join(root, 'node_modules'), root);
    const days = await computeIdleDays(entry, { now: NOW });
    expect(days).toBe(10);
  });

  it('no git -> uses package.json mtime', async () => {
    const pkg = join(root, 'package.json');
    await writeFile(pkg, '{}');
    const ts = (NOW - 5 * 86400_000) / 1000;
    await utimes(pkg, ts, ts);

    const entry = mkEntry(join(root, 'node_modules'), root);
    const days = await computeIdleDays(entry, { now: NOW });
    expect(days).toBe(5);
  });

  it('monorepo: finds .git above package dir', async () => {
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
    await utimes(nm, ts, ts);

    const entry = mkEntry(nm, null);
    const days = await computeIdleDays(entry, { now: NOW });
    expect(days).toBe(7);
  });

  it('returns 0 for activity today', async () => {
    const pkg = join(root, 'package.json');
    await writeFile(pkg, '{}');
    const ts = NOW / 1000;
    await utimes(pkg, ts, ts);

    const entry = mkEntry(join(root, 'node_modules'), root);
    const days = await computeIdleDays(entry, { now: NOW });
    expect(days).toBe(0);
  });
});
