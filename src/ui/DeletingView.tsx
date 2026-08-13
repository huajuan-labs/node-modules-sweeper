import React from 'react';
import { Text, Box } from 'ink';
import type { DeleteOutcome } from '../types.js';

export interface DeletingViewProps {
  total: number;
  current?: { relPath: string; index: number } | null;
  outcomes: DeleteOutcome[];
}

export const DeletingView: React.FC<DeletingViewProps> = ({ total, current, outcomes }) => {
  const ok = outcomes.filter(o => o.ok).length;
  const failed = outcomes.filter(o => !o.ok);
  return (
    <Box flexDirection="column">
      {current ? (
        <Text>Deleting [{current.index + 1}/{total}] {current.relPath}…</Text>
      ) : (
        <Text>Done: {ok}/{total} succeeded.</Text>
      )}
      {failed.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">Failed ({failed.length}):</Text>
          {failed.map((o, i) => (
            <Text key={i} color="red">  {o.entry.relPath}: {o.error}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
};
