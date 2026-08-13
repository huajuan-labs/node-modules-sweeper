const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '  —  ';
  if (bytes === 0) return '0B';
  let unit = 0;
  let value = bytes;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const unitLabel = UNITS[unit];
  return unit === 0 ? `${value}${unitLabel}` : `${value.toFixed(1)}${unitLabel}`;
}

export function formatIdleDays(days: number | null): string {
  if (days === null) return '  ?  ';
  if (days === 0) return 'today';
  return `${days}d`;
}

export function barRatio(size: number | null, maxSize: number): number {
  if (size === null || maxSize === 0) return 0;
  return Math.min(size / maxSize, 1);
}

const FULL = '█';
const EMPTY = '░';

export function renderBar(ratio: number, cells: number): string {
  // Round up so a partially-filled cell (e.g. ratio 0.51 → 5/8) shows as filled.
  const filled = Math.min(Math.ceil(ratio * cells), cells);
  return FULL.repeat(filled).padEnd(cells, EMPTY);
}
