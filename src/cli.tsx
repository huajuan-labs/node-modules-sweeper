import { Command } from 'commander';
import { render } from 'ink';
import { scan } from './scanner.js';
import { computeSize } from './size.js';
import { computeIdleDays } from './activity.js';
import { deleteEntries } from './delete.js';
import { progressLine, progressDone } from './progress.js';
import { formatBytes } from './format.js';
import { App } from './ui/App.js';
import type { Entry } from './types.js';
import { resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

export interface RunScanResult {
  entries: Entry[];
  permissionSkipped: number;
}

/** Scan + size + activity enrichment + minDays filter. Pure, testable. */
export async function runScan(opts: {
  root: string;
  minDays: number;
  now?: number;
  onDiscover?: (abs: string, count: number) => void;
}): Promise<RunScanResult> {
  const { entries, permissionSkipped } = await scan({
    root: opts.root,
    onDiscover: opts.onDiscover,
  });

  // Size pass.
  let sized = 0;
  for (const e of entries) {
    progressLine(`Sizing ${sized + 1}/${entries.length} …`);
    e.sizeBytes = await computeSize(e.absPath, { isSymlink: e.isSymlink });
    sized++;
  }

  // Activity pass.
  for (const e of entries) {
    e.idleDays = await computeIdleDays(e, { now: opts.now });
  }
  progressDone(`Found ${entries.length} node_modules`);

  // Filter.
  const filtered = entries.filter(
    e => e.idleDays !== null && e.idleDays >= opts.minDays,
  );
  return { entries: filtered, permissionSkipped };
}

/** Plain-text table for non-TTY mode. */
function renderTable(entries: Entry[]): string {
  const header = 'SIZE        IDLE   PATH';
  const lines = entries.map(e =>
    `${formatBytes(e.sizeBytes).padEnd(11)} ${String(e.idleDays ?? '?').padEnd(6)} ${e.relPath}`,
  );
  const total = entries.reduce((s, e) => s + (e.sizeBytes ?? 0), 0);
  return [header, ...lines, '', `Total: ${entries.length} dirs / ${formatBytes(total)}`].join('\n');
}

async function confirmWideRoot(root: string): Promise<boolean> {
  const abs = isAbsolute(root) ? root : resolve(root);
  const home = homedir();
  if (abs === home || abs === '/') {
    process.stderr.write(
      `Warning: scanning ${abs} may find node_modules inside applications.\nContinue? [y/N] `,
    );
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) {
      chunks.push(c as Buffer);
      if (chunks.join('').includes('\n')) break;
    }
    const answer = chunks.join('').trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  }
  return true;
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name('clean-node-modules')
    .argument('[scan-root]', 'directory to scan', '.')
    .option('--trash', 'move to trash instead of hard delete')
    .option('--min-days <n>', 'only show entries idle >= n days', '0')
    .action(async (scanRoot: string, opts: { trash?: boolean; minDays: string }) => {
      const minDays = parseInt(opts.minDays, 10) || 0;
      const mode: 'hard' | 'trash' = opts.trash ? 'trash' : 'hard';

      if (!(await confirmWideRoot(scanRoot))) {
        process.exit(0);
      }

      let result: RunScanResult;
      try {
        result = await runScan({
          root: scanRoot,
          minDays,
          onDiscover: (_abs, count) => progressLine(`Scanning… found ${count}`),
        });
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exit(1);
      }

      if (result.permissionSkipped > 0) {
        process.stderr.write(
          `${result.permissionSkipped} director${result.permissionSkipped === 1 ? 'y' : 'ies'} skipped due to permissions.\n`,
        );
      }

      if (result.entries.length === 0) {
        process.stdout.write('No node_modules found.\n');
        return;
      }

      // Non-TTY: table only, no deletion.
      if (!process.stdout.isTTY) {
        process.stdout.write(renderTable(result.entries) + '\n');
        return;
      }

      // TTY: ink TUI.
      const { unmount, waitUntilExit } = render(
        <App
          entries={result.entries}
          mode={mode}
          onDelete={async (toDelete, m) => deleteEntries(toDelete, { mode: m })}
          onExit={() => unmount()}
        />,
        { exitOnCtrlC: false },
      );
      await waitUntilExit();
    });

  await program.parseAsync(argv, { from: 'user' });
}
