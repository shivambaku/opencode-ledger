import type { Context as TuiPluginApi } from "@opencode/plugin/tui/context"
import { spawn } from "node:child_process"
import { ROUTE } from "./constants"
import { blockComment, blockHasUnresolvedComment, blockLabel } from "./domain"
import { parseHunk } from "./git"
import type { LedgerBlock, LedgerFile } from "./types"
import { parseRouteParams } from "./utils"

const CLIPBOARD_WRITE_TIMEOUT = 1500

function writeOsc52(text: string) {
  if (!process.stdout.isTTY) return false
  const sequence = `\x1b]52;c;${Buffer.from(text).toString("base64")}\x07`
  process.stdout.write(process.env.TMUX || process.env.STY ? `\x1bPtmux;\x1b${sequence}\x1b\\` : sequence)
  return true
}

function writeWithStdin(command: string, args: string[], text: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] })
    let settled = false
    const timer = setTimeout(() => {
      child.kill()
      finish(false)
    }, CLIPBOARD_WRITE_TIMEOUT)
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }

    child.on("error", () => finish(false))
    child.on("close", (code) => finish(code === 0))
    child.stdin.on("error", () => finish(false))
    child.stdin.end(text)
  })
}

async function writeNativeClipboard(text: string) {
  if (process.platform === "darwin") return writeWithStdin("pbcopy", [], text)
  if (process.platform !== "linux") return false

  const commands: [string, string[]][] = process.env.WAYLAND_DISPLAY
    ? [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]]
    : [["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]], ["wl-copy", []]]

  for (const [command, args] of commands) {
    if (await writeWithStdin(command, args, text)) return true
  }
  return false
}

function currentSessionID(api: TuiPluginApi): string | undefined {
  const route = api.ui.router.current()
  return route.type === "session" ? route.sessionID : undefined
}

export function activeLedger(api: TuiPluginApi) {
  const route = api.ui.router.current()
  return route.type === "plugin" && route.name === ROUTE && api.keymap.mode.current() === "base"
}

export function openLedger(api: TuiPluginApi) {
  api.ui.dialog.clear()
  const sessionID = currentSessionID(api)
  const location = sessionID ? api.data.session.get(sessionID)?.location : api.location
  api.ui.router.navigate({ type: "plugin", name: ROUTE, data: { sessionID, directory: (location ?? api.data.location.default()).directory, index: 0, scroll: 0 } })
}

export function closeLedger(api: TuiPluginApi) {
  const route = api.ui.router.current()
  const state = route.type === "plugin" && route.name === ROUTE ? parseRouteParams(route.data) : undefined
  if (state?.sessionID) api.ui.router.navigate({ type: "session", sessionID: state.sessionID })
  else api.ui.router.navigate({ type: "home" })
}

function blockDiffBody(block: LedgerBlock) {
  return block.patch
    .split("\n")
    .filter((line) => !parseHunk(line))
    .join("\n")
    .trimEnd()
}

function formatCommentedBlock(file: LedgerFile, block: LedgerBlock) {
  const comment = blockComment(block)
  const body = blockDiffBody(block)
  if (!comment) return body
  return `${blockLabel(file, block)}\n\nComment:\n${comment}\n\nDiff:\n${body}`
}

export async function writeClipboard(api: TuiPluginApi, body: string) {
  if (!body) return false

  let renderer = false
  try {
    renderer = api.renderer.copyToClipboardOSC52(body)
  } catch {}
  const osc52 = renderer ? false : writeOsc52(body)
  const native = await writeNativeClipboard(body)
  return renderer || osc52 || native
}

export async function yankBlockToClipboard(api: TuiPluginApi, file: LedgerFile, block: LedgerBlock) {
  return writeClipboard(api, formatCommentedBlock(file, block))
}

export async function yankUnresolvedCommentsToClipboard(api: TuiPluginApi, files: LedgerFile[]) {
  const blocks = files.flatMap((file) => file.blocks.filter(blockHasUnresolvedComment).map((block) => ({ file, block })))
  const body = blocks.map(({ file, block }) => formatCommentedBlock(file, block)).join("\n\n---\n\n")
  return { count: blocks.length, ok: await writeClipboard(api, `# Ledger Comments\n\n${body}`) }
}
