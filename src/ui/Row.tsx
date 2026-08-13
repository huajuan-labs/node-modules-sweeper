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
