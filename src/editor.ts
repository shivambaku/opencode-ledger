import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { LedgerBlock, LedgerFile, LedgerScope } from "./types"
import { filename, shellQuote, splitCommand } from "./utils"

type EditorResult = { text: string; fg?: string }

function editorCommand(editor: string, file: string, line: number) {
  const parts = splitCommand(editor)
  const executable = filename(parts[0] ?? editor).toLowerCase()
  const base = parts.map(shellQuote).join(" ")

  if (["code", "cursor", "windsurf", "code-insiders"].includes(executable)) return `${base} -g ${shellQuote(`${file}:${line}`)}`
  if (["vim", "nvim", "vi"].includes(executable)) return `${base} +${line} ${shellQuote(file)}`
  return `${base} ${shellQuote(file)}`
}

export async function openEditor(api: TuiPluginApi, scope: LedgerScope, file: LedgerFile, block: LedgerBlock): Promise<EditorResult> {
  if (file.status === "deleted") {
    return { text: "Deleted files cannot be opened from Ledger.", fg: "#f6b26b" }
  }

  const editor = process.env.VISUAL || process.env.EDITOR
  if (!editor) {
    return { text: "Set VISUAL or EDITOR to open files from Ledger.", fg: "#f6b26b" }
  }

  const line = block.newStart || block.oldStart || 1
  const path = `${scope.directory}/${file.path}`
  const command = editorCommand(editor, path, line)
  const bun = (globalThis as unknown as { Bun?: { spawn?: (cmd: string[], options: Record<string, unknown>) => { exited: Promise<number> } } }).Bun
  if (!bun?.spawn) {
    return { text: "Bun.spawn is unavailable in this plugin runtime.", fg: "#f6b26b" }
  }

  try {
    api.renderer.suspend()
    api.renderer.currentRenderBuffer.clear()
    const proc = bun.spawn(["sh", "-lc", command], {
      cwd: scope.directory,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    const code = await proc.exited
    if (code !== 0) {
      return { text: `Editor exited with status ${code}.`, fg: "#f6b26b" }
    }
  } catch (error) {
    return { text: error instanceof Error ? error.message : "Failed to open editor.", fg: "#f6b26b" }
  } finally {
    api.renderer.currentRenderBuffer.clear()
    api.renderer.resume()
    api.renderer.requestRender()
  }
  return { text: `Opened ${file.path}.`, fg: "#3ee06f" }
}
