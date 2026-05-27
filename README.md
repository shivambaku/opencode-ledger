# opencode-ledger

Experimental TUI review ledger plugin for OpenCode.

> Note: opencode-ledger is an independent project and is not built by, affiliated with, or endorsed by the OpenCode team.

## Requirements

- OpenCode
- A git repository to review

## Install

Add Ledger to your OpenCode TUI config:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@shivambaku/opencode-ledger"]
}
```

Use one of these config locations:

- `~/.config/opencode/tui.json` for all projects
- `.opencode/tui.json` inside one project

Restart OpenCode after changing config. OpenCode installs npm plugins automatically on startup.

Open Ledger from the command palette or with `/ledger`. Press `?` inside Ledger for help.

## Privacy and storage

- Ledger stores local review state in `.opencode/ledger/state.json` inside the reviewed repository.
- Ledger writes `.opencode/.gitignore` with `/ledger/` so its state is not committed by default.
- AI analysis sends the current Git diff and relevant prior OpenCode edit context to your configured OpenCode model provider.
- Analysis sessions are temporary and are deleted after analysis finishes or is stopped.
- Set `LEDGER_DEBUG=1` to keep analysis request and response payloads under `.opencode/ledger/debug` for troubleshooting.

## Troubleshooting

- If Ledger does not appear, restart OpenCode and check that `@shivambaku/opencode-ledger` is listed in your `tui.json` `plugin` array.
- If you already have plugins configured, add `@shivambaku/opencode-ledger` to the existing `plugin` array instead of replacing it.
- If analysis has no files to show, make sure OpenCode is running inside a git repository with local changes.

## Development

Clone Ledger somewhere stable and install dependencies:

```bash
mkdir -p ~/opencode-plugins
git clone https://github.com/shivambaku/opencode-ledger.git ~/opencode-plugins/opencode-ledger
cd ~/opencode-plugins/opencode-ledger
npm install
```

Use the local source path in your OpenCode TUI config:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["file:///Users/you/opencode-plugins/opencode-ledger/src/tui.tsx"]
}
```

Replace `/Users/you` with your actual home directory path.

Run the type check:

```bash
npm run check
```
