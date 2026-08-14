import { Command } from 'commander';
import { render } from 'ink';
import { scan } from './scanner.js';
import { computeSize } from './size.js';
import { computeIdleDays } from './activity.js';
import { deleteEntries } from './delete.js';
import { progressLine, progressDone } from './progress.js';
import { formatBytes } from './format.js';
import { App } from './ui/App.js';
import { Browser } from './ui/Browser.js';
import type { Entry } from './types.js';
import { resolve, isAbsolute, dirname, join } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const PKG_NAME = 'node-modules-sweeper';

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
  // Only warn for an actual full-disk scan (/). $HOME is fine to scan — the
  // ignore list (.git, Library/, *.app, hidden dirs) already filters the
  // dangerous stuff, and deletion has its own confirmation. Blocking here on
  // process.stdin also breaks the ink TUI (stdin is owned by ink), so we
  // reserve the interactive y/N prompt only for `/`.
  if (abs === '/') {
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

/** Run the scan pipeline + render the results (TUI or table).
 *  Returns true if the user asked to change directory (pressed 'd'), false otherwise. */
async function runAndShow(scanRoot: string, minDays: number, mode: 'hard' | 'trash'): Promise<boolean> {
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
    // In interactive (TTY) mode, signal "go back to browser" so the user can
    // pick another directory instead of being dumped to the shell.
    // In non-TTY mode, just report and exit.
    if (process.stdout.isTTY) return true;
    process.stdout.write('No node_modules found.\n');
    return false;
  }

  // Non-TTY: table only, no deletion, no dir change.
  if (!process.stdout.isTTY) {
    process.stdout.write(renderTable(result.entries) + '\n');
    return false;
  }

  // TTY: ink TUI. 'd' (onChangeDir) -> return true so the caller re-opens the browser.
  let changeDir = false;
  const { unmount, waitUntilExit } = render(
    <App
      entries={result.entries}
      mode={mode}
      onDelete={async (toDelete, m) => deleteEntries(toDelete, { mode: m })}
      onExit={() => unmount()}
      onChangeDir={() => { changeDir = true; unmount(); }}
    />,
    { exitOnCtrlC: false },
  );
  await waitUntilExit();
  return changeDir;
}

/** Check the latest published version of this package on npm. Returns null on error. */
async function latestVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileP('npm', ['view', PKG_NAME, 'version'], { maxBuffer: 1024 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Read the installed version from package.json. */
export function installedVersion(): string {
  // dist/cli.js -> ../../package.json
  const file = join(dirname(dirname(fileURLToPath(import.meta.url))), 'package.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function selfUpdate(): Promise<void> {
  const current = installedVersion();
  process.stdout.write(`Current: ${PKG_NAME}@${current}\nChecking npm for latest…\n`);
  const latest = await latestVersion();
  if (!latest) {
    process.stderr.write('Could not reach npm registry. Check your network and try again.\n');
    process.exit(1);
  }
  if (latest === current) {
    process.stdout.write(`Already up to date: ${PKG_NAME}@${current}\n`);
    return;
  }
  process.stdout.write(`Updating ${current} -> ${latest}…\n`);
  // npm install -g must run as a child process so it can update our own package files.
  const r = spawnSync('npm', ['install', '-g', `${PKG_NAME}@latest`], { stdio: 'inherit' });
  if (r.status !== 0) {
    process.stderr.write('Update failed. Try running: npm install -g ' + PKG_NAME + '@latest\n');
    process.exit(typeof r.status === 'number' ? r.status : 1);
  }
  process.stdout.write(`Updated to ${PKG_NAME}@${latest}\n`);
}

export async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name('nms')
    .argument('[scan-root]', 'directory to scan')
    .option('--trash', 'move to trash (default) instead of hard delete')
    .option('--hard', 'hard delete (irreversible) instead of trash')
    .option('--min-days <n>', 'only show entries idle >= n days', '0')
    .option('-u, --update', 'update node-modules-sweeper to the latest version from npm')
    .action(async (scanRoot: string | undefined, opts: { trash?: boolean; hard?: boolean; minDays: string; update?: boolean }) => {
      if (opts.update) {
        await selfUpdate();
        return;
      }
      const minDays = parseInt(opts.minDays, 10) || 0;
      // Default to trash (recoverable). --hard opts into hard delete. --trash is a no-op kept for clarity.
      const mode: 'hard' | 'trash' = opts.hard ? 'hard' : 'trash';

      // No scan-root given AND we're in a TTY: show the directory browser,
      // then scan; the user can press 'd' in the main TUI to come back here.
      if (scanRoot === undefined && process.stdout.isTTY) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          let chosen: string | null = null;
          const { unmount: unmountBrowser, waitUntilExit: waitBrowser } = render(
            <Browser
              onSelect={(d) => { chosen = d; unmountBrowser(); }}
              onExit={() => unmountBrowser()}
            />,
            { exitOnCtrlC: false },
          );
          await waitBrowser();
          if (!chosen) return; // quit the browser without choosing -> exit

          // Scan + main TUI. changeDir=true means the user pressed 'd' to re-pick.
          const changeDir = await runAndShow(chosen, minDays, mode);
          if (!changeDir) return; // exited the main TUI normally -> done
          // else loop back to the browser
        }
      }

      const root = scanRoot ?? '.';
      await runAndShow(root, minDays, mode);
    });

  await program.parseAsync(argv, { from: 'user' });
}
