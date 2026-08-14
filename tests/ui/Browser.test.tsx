import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Browser } from '../../src/ui/Browser.js';

const ESC = String.fromCharCode(0x1b);
const DOWN = ESC + '[B';
const RIGHT = ESC + '[C';
const LEFT = ESC + '[D';
const flush = () => new Promise(r => setTimeout(r, 20));

let root: string;
let subA: string;
let subB: string;
let subA1: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cnm-brw-'));
  subA = join(root, 'alpha');
  subB = join(root, 'beta');
  subA1 = join(root, 'alpha', 'deep');
  await mkdir(subA, { recursive: true });
  await mkdir(subB, { recursive: true });
  await mkdir(subA1, { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('Browser', () => {
  it('renders the start dir header and subdirectories', async () => {
    const { lastFrame } = render(
      <Browser startDir={root} onSelect={vi.fn()} onExit={vi.fn()} />,
    );
    await flush(); // wait for the async listDir effect to populate entries
    const frame = lastFrame() ?? '';
    expect(frame).toContain(`Browse: ${root}`);
    expect(frame).toContain('alpha');
    expect(frame).toContain('beta');
  });

  it('hides hidden directories', async () => {
    const { lastFrame } = render(
      <Browser startDir={root} onSelect={vi.fn()} onExit={vi.fn()} />,
    );
    await flush();
    expect(lastFrame() ?? '').not.toContain('.hidden');
  });

  it('→ descends into the selected subdirectory', async () => {
    const { stdin, lastFrame } = render(
      <Browser startDir={root} onSelect={vi.fn()} onExit={vi.fn()} />,
    );
    await flush();
    stdin.write(RIGHT); await flush(); // cursor on 'alpha' (first, sorted) -> descend
    await flush();
    const frame = lastFrame() ?? '';
    expect(frame).toContain(`Browse: ${subA}`);
    expect(frame).toContain('deep');
  });

  it('← returns to the parent directory', async () => {
    const { stdin, lastFrame } = render(
      <Browser startDir={root} onSelect={vi.fn()} onExit={vi.fn()} />,
    );
    await flush();
    stdin.write(RIGHT); await flush();   // into alpha
    await flush();
    expect(lastFrame() ?? '').toContain(`Browse: ${subA}`);
    stdin.write(LEFT); await flush();    // back to parent
    await flush();
    expect(lastFrame() ?? '').toContain(`Browse: ${root}`);
  });

  it('enter confirms the directory under the cursor via onSelect', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <Browser startDir={root} onSelect={onSelect} onExit={vi.fn()} />,
    );
    await flush();
    stdin.write('\r'); await flush(); // cursor on 'alpha' -> scan alpha
    expect(onSelect).toHaveBeenCalledWith(subA);
  });

  it('enter scans the cursor dir after descending', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <Browser startDir={root} onSelect={onSelect} onExit={vi.fn()} />,
    );
    await flush();
    stdin.write(RIGHT); await flush(); // into alpha (cursor now on 'deep')
    await flush();
    stdin.write('\r'); await flush();  // scan deep
    expect(onSelect).toHaveBeenCalledWith(subA1);
  });

  it('↓ moves the cursor to the next entry', async () => {
    const { stdin, lastFrame } = render(
      <Browser startDir={root} onSelect={vi.fn()} onExit={vi.fn()} />,
    );
    await flush();
    expect(lastFrame() ?? '').toContain('❯ 📁 alpha');
    stdin.write(DOWN); await flush();
    expect(lastFrame() ?? '').toContain('❯ 📁 beta');
  });

  it('q exits via onExit', async () => {
    const onExit = vi.fn();
    const { stdin } = render(
      <Browser startDir={root} onSelect={vi.fn()} onExit={onExit} />,
    );
    await flush();
    stdin.write('q'); await flush();
    expect(onExit).toHaveBeenCalled();
  });
});
