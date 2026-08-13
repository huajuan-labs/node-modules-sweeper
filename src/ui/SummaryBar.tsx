import React from 'react';
import { Text, Box } from 'ink';
import type { Entry } from '../types.js';
import { formatBytes, renderBar } from '../format.js';

export interface SummaryBarProps {
  entries: Entry[];
  selected: Set<string>;
}

export const SummaryBar: React.FC<SummaryBarProps> = ({ entries, selected }) => {
  const totalSize = entries.reduce((s, e) => s + (e.sizeBytes ?? 0), 0);
  const selectedEntries = entries.filter(e => selected.has(e.absPath));
  const selectedSize = selectedEntries.reduce((s, e) => s + (e.sizeBytes ?? 0), 0);
  const ratio = totalSize === 0 ? 0 : selectedSize / totalSize;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>Total: {entries.length} dirs / {formatBytes(totalSize)}</Text>
      <Text>Selected: {selected.size} dirs / {formatBytes(selectedSize)} to free</Text>
      <Text>Freed ratio: {renderBar(ratio, 20)} {(ratio * 100).toFixed(0)}%</Text>
    </Box>
  );
};
