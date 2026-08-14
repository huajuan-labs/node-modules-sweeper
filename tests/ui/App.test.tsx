import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '../../src/ui/App.js';
import type { Entry } from '../../src/types.js';

// Build special-key sequences from char codes so the source stays pure ASCII.
const ESC = String.fromCharCode(0x1b);
const DOWN = ESC + '[B';

const mkEntry = (
  absPath: string, sizeBytes: number, idleDays: number, isSymlink = false,
): Entry => ({
  absPath, relPath: absPath, sizeBytes, idleDays, isSymlink, projectRoot: null,
});

// ink 7 reads stdin via the 'readable' event; multiple synchronous stdin.write
// calls coalesce into one keypress. A short delay between writes lets each
// press land in a separate event-loop turn so ink re-fires its handler per key,
// AND gives newly-mounted child components (e.g. ConfirmDialog) time to register
// their own useInput before the next keypress is dispatched.
const flush = () => new Promise(r => setTimeout(r, 20));

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

  it('m toggles delete mode (hard <-> trash)', async () => {
    const { stdin, lastFrame } = render(
      <App entries={baseEntries} mode="hard" onDelete={vi.fn()} onExit={vi.fn()} />,
    );
    expect(lastFrame() ?? '').toContain('hard-delete');
    stdin.write('m'); await flush();
    expect(lastFrame() ?? '').toContain('trash');
    stdin.write('m'); await flush();
    expect(lastFrame() ?? '').toContain('hard-delete');
  });

  it('default mode from props is shown and used on confirm', async () => {
    const onDelete = vi.fn().mockResolvedValue({
      ok: [{ entry: baseEntries[0], ok: true }], failed: [], freedBytes: 200,
    });
    const { stdin } = render(
      <App entries={baseEntries} mode="trash" onDelete={onDelete} onExit={vi.fn()} />,
    );
    stdin.write(' '); await flush();
    stdin.write('\r'); await flush();
    stdin.write('\r'); await flush();
    await flush();
    expect(onDelete).toHaveBeenCalledWith([baseEntries[0]], 'trash');
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
    stdin.write(ESC); await flush();    // Esc -> onCancel
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

  it('d triggers onChangeDir (when provided)', async () => {
    const onChangeDir = vi.fn();
    const { stdin } = render(
      <App entries={baseEntries} mode="hard" onDelete={vi.fn()} onExit={vi.fn()} onChangeDir={onChangeDir} />,
    );
    stdin.write('d'); await flush();
    expect(onChangeDir).toHaveBeenCalled();
  });

  it('G jumps to bottom; g jumps back to top', async () => {
    // 40 entries — exceeds a 24-row terminal so scrolling/viewport kicks in.
    const many: Entry[] = Array.from({ length: 40 }, (_, i) =>
      mkEntry(`p/item${i}`, 10 * (40 - i), i),
    );
    const { stdin, lastFrame } = render(
      <App entries={many} mode="hard" onDelete={vi.fn()} onExit={vi.fn()} />,
    );
    // default cursor at item0 (top, size desc)
    expect(lastFrame() ?? '').toContain('p/item0');
    stdin.write('G'); await flush(); // jump to bottom (item39)
    const bottomFrame = lastFrame() ?? '';
    expect(bottomFrame).toContain('p/item39');
    expect(bottomFrame).toContain('↑'); // scroll indicator: items above
    stdin.write('g'); await flush(); // back to top
    expect(lastFrame() ?? '').toContain('p/item0');
  });

  it('down arrow scrolls the viewport without jumping past content', async () => {
    const many: Entry[] = Array.from({ length: 40 }, (_, i) =>
      mkEntry(`p/item${i}`, 10 * (40 - i), i),
    );
    const { stdin, lastFrame } = render(
      <App entries={many} mode="hard" onDelete={vi.fn()} onExit={vi.fn()} />,
    );
    // Press down 20 times — cursor should be on item20, still visible (no jump to bottom).
    for (let i = 0; i < 20; i++) { stdin.write(DOWN); await flush(); }
    const frame = lastFrame() ?? '';
    expect(frame).toContain('p/item20'); // cursor item visible
    expect(frame).not.toContain('p/item39'); // bottom NOT yet reached
  });
});
