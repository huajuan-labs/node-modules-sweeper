/** Overwrite the current terminal line with a status message (pre-TUI only). */
export function progressLine(msg: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\r${msg}`.padEnd(80));
}

export function progressDone(msg: string): void {
  if (!process.stdout.isTTY) return; // non-TTY: the table is the only output
  process.stdout.write(`\r${msg}`.padEnd(80) + '\n');
}
