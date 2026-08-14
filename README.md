# node-modules-sweeper

> Scan and selectively clean `node_modules` directories — an interactive terminal UI.

`node_modules` folders eat disk fast. This tool recursively scans a directory, shows every `node_modules` it finds (size, idle time, path, a bar chart), and lets you pick which ones to delete — to trash (recoverable) or hard-delete (irreversible). Nothing is ever auto-deleted; **you** decide.

## Install

```bash
npm install -g node-modules-sweeper
```

Requires Node.js ≥ 22.

## Usage

```bash
# Interactive: opens a directory browser to pick what to scan.
# Deletes go to the TRASH by default (recoverable).
nms

# Scan a specific directory directly
nms ~/my_code

# Hard-delete instead of trash (irreversible)
nms ~/my_code --hard

# Only show node_modules idle for 90+ days
nms ~/my_code --min-days 90
```

### Flags

```
nms [scan-root] [options]

  scan-root        directory to scan (default: opens a directory browser)
  --hard           hard delete (irreversible) — default is trash (recoverable)
  --trash          force trash mode (default, kept for clarity)
  --min-days <n>   only show entries idle for >= n days
  -h, --help       show help
```

> **Delete mode is also switchable inside the TUI** — press `m` to toggle between `trash` (green, recoverable) and `hard-delete` (red, irreversible). The current mode is shown in the header and used on the confirm screen.

## The flow

1. **Pick a directory** — no argument opens a directory browser (start from cwd). `↑↓` move, `→` descend into a subdir, `←` go back, `enter` confirm & scan.
2. **Select what to clean** — the `node_modules` list with size / idle-time / path / bar. `↑↓` browse, `space` toggle, `a` select-all, `s` cycle sort, `g`/`G` jump top/bottom.
3. **Confirm & delete** — `enter` shows a second confirmation (count + size + mode); `enter` again executes. Failures are collected, not aborted.

### Keys

| Key | Action |
|-----|--------|
| `↑` `↓` | move cursor |
| `space` | toggle selection (symlinked `node_modules` are protected — not selectable) |
| `a` | select / deselect all |
| `s` | cycle sort: size ↓ → idle ↓ → path ↑ |
| `m` | toggle delete mode: trash ↔ hard-delete (shown in header; trash=green, hard=red) |
| `g` / `G` | jump to top / bottom |
| `enter` | confirm (list) / execute (confirm screen) |
| `←` / `→` | in the browser: back / open subdir |
| `esc` | cancel confirm, back to list |
| `q` / `ctrl+c` | quit |

## How it measures things

- **Size** — `du -sk` (fast, correct on pnpm hard-link stores, doesn't follow symlinks). Falls back to a JS walk with inode de-duplication if `du` is unavailable.
- **Idle time** — *not* the `node_modules` mtime (that only reflects the last `install`). It uses the project's last git commit time, falling back to `package.json` mtime, then `node_modules` mtime.
- **Symlinked `node_modules`** (pnpm shared store / workspaces) are shown with `⤳` and **cannot be deleted** — removing the link would break the shared store.

## Safety

- Every deletion is guarded by a `basename(path) === 'node_modules'` assertion — a bug can never delete an unrelated directory.
- Nothing is auto-deleted; every deletion requires explicit selection + a second confirmation.
- `--trash` is recoverable from the system trash.
- Scans skip `.git`, `.Trash`, `Library/`, `*.app` bundles, and hidden dirs by default; scanning `$HOME` or `/` prompts a warning.

## Non-interactive mode

When stdout isn't a TTY (CI, pipes), `nms` prints a plain `SIZE / IDLE / PATH` table and exits — no TUI, no deletion:

```bash
nms ~/my_code | sort -h
```

## Development

```bash
git clone https://github.com/huajuan-labs/node-modules-sweeper.git
cd node-modules-sweeper
npm install
npm test        # 76 tests, vitest
npm run build   # tsc -> dist/
node bin/nms.js .
```

## License

MIT © huajuan-labs
