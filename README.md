# opencode-ledger

TUI review ledger plugin for OpenCode.

## Install

Add the Git package to your OpenCode TUI config:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["github:shivambaku/opencode-ledger"]
}
```

To run Ledger analysis with a specific model, pass a `model` option:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [["github:shivambaku/opencode-ledger", { "model": "provider/model-id" }]]
}
```

Restart OpenCode after changing config. Open Ledger from the command palette or with `/ledger`.

Ledger analysis sessions are temporary and are deleted after analysis finishes or is stopped. Set `LEDGER_DEBUG=1` to keep analysis request and response payloads under `.opencode/ledger/debug`.

## Development

```bash
npm install
npm run check
```
