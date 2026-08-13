import React from 'react';
import { Text, Box, useInput } from 'ink';
import { formatBytes } from '../format.js';

export interface ConfirmDialogProps {
  count: number;
  bytes: number;
  mode: 'hard' | 'trash';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  count, bytes, mode, onConfirm, onCancel,
}) => {
  useInput((_input, key) => {
    if (key.return) onConfirm();
    else if (key.escape) onCancel();
  });
  return (
    <Box flexDirection="column">
      <Text color="yellow">Delete {count} node_modules ({formatBytes(bytes)})?</Text>
      <Text>Mode: {mode === 'trash' ? 'move to trash' : 'hard delete (irreversible)'}</Text>
      <Text dimColor>Enter to confirm · Esc to cancel</Text>
    </Box>
  );
};
