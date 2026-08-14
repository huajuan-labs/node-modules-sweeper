import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
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
  /** Called when the user wants to go back and pick a different directory. */
  onChangeDir?: () => void;
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

export const App: React.FC<AppProps> = ({ entries: initialEntries, mode: initialMode, onDelete, onExit, onChangeDir }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [screen, setScreen] = useState<Screen>('list');
  const [sortKey, setSortKey] = useState<SortKey>('size');
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [deleteSummary, setDeleteSummary] = useState<DeleteSummary | null>(null);
  // Delete mode is switchable in-TUI (m key). Defaults to the mode passed in
  // (which the CLI defaults to 'trash' so deletions are recoverable out of the box).
  const [mode, setMode] = useState<'hard' | 'trash'>(initialMode);

  const sorted = sortEntries(entries, sortKey);
  const maxSize = Math.max(1, ...entries.map(e => e.sizeBytes ?? 0));
  const selectable = sorted.filter(e => !e.isSymlink);

  // Viewport scrolling: keep the cursor visible within a fixed-height window.
  // Reserve lines for: header (1) + summary (3) + footer (1) + a margin (1) = 6.
  const RESERVED = 6;
  const termRows = stdout?.rows && stdout.rows > 0 ? stdout.rows : 24;
  const viewportRows = Math.max(3, termRows - RESERVED);
  const needScroll = sorted.length > viewportRows;
  // Window start so that cursor stays inside [start, start+viewportRows-1].
  const winStart = needScroll
    ? Math.min(
        Math.max(0, cursor - Math.floor(viewportRows / 2)),
        Math.max(0, sorted.length - viewportRows),
      )
    : 0;
  const winEnd = Math.min(sorted.length, winStart + viewportRows);
  const visible = needScroll ? sorted.slice(winStart, winEnd) : sorted;

  const safeExit = useCallback(() => {
    exit();
    onExit();
  }, [exit, onExit]);

  // Single useInput handles all screens (hooks must run unconditionally).
  useInput((input, key) => {
    if (screen === 'result') { setScreen('list'); return; }
    if (screen !== 'list') return;
    if (input === 'q' || (key.ctrl && input === 'c')) { safeExit(); return; }
    if (input === 'd' && onChangeDir) { onChangeDir(); return; } // back to directory browser
    if (input === 's') { setSortKey(k => NEXT_SORT[k]); return; }
    if (input === 'm') { setMode(prev => (prev === 'trash' ? 'hard' : 'trash')); return; }
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
    if (input === 'g') { setCursor(0); return; }          // g: jump to top
    if (input === 'G') { setCursor(sorted.length - 1); return; } // G: jump to bottom
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
  const modeColor = mode === 'trash' ? 'green' : 'red';
  return (
    <Box flexDirection="column">
      <Text bold>nms — node-modules-sweeper — sort: {SORT_LABEL[sortKey]} (s) · mode: <Text color={modeColor}>{mode === 'trash' ? 'trash' : 'hard-delete'}</Text> (m)</Text>
      {needScroll && winStart > 0 && <Text dimColor>  ↑ {winStart} more above</Text>}
      {visible.map((e, i) => {
        const realIndex = winStart + i;
        return (
          <Row
            key={e.absPath}
            entry={e}
            selected={selected.has(e.absPath)}
            cursor={realIndex === cursor}
            maxSize={maxSize}
          />
        );
      })}
      {needScroll && winEnd < sorted.length && (
        <Text dimColor>  ↓ {sorted.length - winEnd} more below</Text>
      )}
      <SummaryBar entries={sorted} selected={selected} />
      <Text dimColor>↑↓ move · space select · a all · s sort · m mode · g/G top/bottom · enter delete{onChangeDir ? ' · d change dir' : ''} · q quit</Text>
    </Box>
  );
};
