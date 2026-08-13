import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { listDir, startingDir, type DirEntry } from '../dirbrowser.js';

export interface BrowserProps {
  /** Starting directory. Defaults to current dir. */
  startDir?: string;
  /** Called when the user confirms a directory to scan. */
  onSelect: (dir: string) => void;
  onExit: () => void;
}

export const Browser: React.FC<BrowserProps> = ({ startDir, onSelect, onExit }) => {
  const { exit } = useApp();
  const [dir, setDir] = useState<string>(startDir ?? startingDir());
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    const { entries: e, parent: p } = await listDir(d);
    setEntries(e);
    setParent(p);
    setCursor(0);
    setError(null);
  }, []);

  useEffect(() => {
    load(dir).catch(err => setError((err as Error).message));
  }, [dir, load]);

  // Viewport scrolling (reuse the same approach as the main list).
  const RESERVED = 5; // header(2) + footer(1) + margins
  const termRows = process.stdout.rows && process.stdout.rows > 0 ? process.stdout.rows : 24;
  const viewportRows = Math.max(3, termRows - RESERVED);
  const needScroll = entries.length > viewportRows;
  const winStart = needScroll
    ? Math.min(
        Math.max(0, cursor - Math.floor(viewportRows / 2)),
        Math.max(0, entries.length - viewportRows),
      )
    : 0;
  const winEnd = Math.min(entries.length, winStart + viewportRows);
  const visible = needScroll ? entries.slice(winStart, winEnd) : entries;

  const safeExit = useCallback(() => {
    exit();
    onExit();
  }, [exit, onExit]);

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) { safeExit(); return; }
    if (key.upArrow) { setCursor(c => Math.max(c - 1, 0)); return; }
    if (key.downArrow) { setCursor(c => Math.min(c + 1, entries.length - 1)); return; }
    if (key.leftArrow) {
      // back to parent
      if (parent) setDir(parent);
      return;
    }
    if (key.rightArrow || key.return) {
      const e = entries[cursor];
      if (e && e.isDir) {
        // Enter/right-arrow on a directory:
        //  - rightArrow => descend into it
        //  - return     => confirm scan of THIS directory (the one shown in header)
        if (key.rightArrow) {
          setDir(e.path);
        } else {
          // return: scan the current header dir
          onSelect(dir);
        }
      } else if (key.return) {
        // return on empty/non-dir: scan current header dir
        onSelect(dir);
      }
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>📁 Browse: {dir}</Text>
      <Text dimColor>enter = scan this dir · → open · ← back</Text>
      {error && <Text color="red">Error: {error}</Text>}
      {needScroll && winStart > 0 && <Text dimColor>  ↑ {winStart} more</Text>}
      {visible.length === 0 && !error && (
        <Text dimColor>  (no subdirectories)</Text>
      )}
      {visible.map((e, i) => {
        const realIndex = winStart + i;
        return (
          <Text key={e.path} wrap="truncate">
            {realIndex === cursor ? '❯' : ' '} 📁 {e.name}
          </Text>
        );
      })}
      {needScroll && winEnd < entries.length && (
        <Text dimColor>  ↓ {entries.length - winEnd} more</Text>
      )}
      <Text dimColor>↑↓ move · → open subdir · ← back · enter scan here · q quit</Text>
    </Box>
  );
};
