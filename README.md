# opencode-ledger

TUI review ledger plugin for OpenCode.

## Install

Clone Ledger somewhere stable and install dependencies:

```bash
git clone https://github.com/shivambaku/opencode-ledger.git /absolute/path/to/opencode-ledger
cd /absolute/path/to/opencode-ledger
npm install
```

Add Ledger to your OpenCode TUI config:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["file:///absolute/path/to/opencode-ledger/src/tui.tsx"]
}
```

Use the same absolute path where you cloned the repo. Restart OpenCode after changing config.

Open Ledger from the command palette or with `/ledger`.

Press `m` in Ledger to generate and copy a one-line commit message from the current diff plus any fresh Ledger analysis.

Ledger analysis sessions are temporary and are deleted after analysis finishes or is stopped. Set `LEDGER_DEBUG=1` to keep analysis request and response payloads under `.opencode/ledger/debug`.

## Development

```bash
npm install
npm run check
```
