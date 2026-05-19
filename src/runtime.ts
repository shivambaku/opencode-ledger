import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { ROUTE } from "./constants"
import { parseHunk } from "./git"
import type { LedgerBlock } from "./types"
import { parseRouteParams } from "./utils"

function currentSessionID(api: TuiPluginApi): string | undefined {
  const route = api.route.current
  if (route.name !== "session") return undefined
  const params = route.params ?? {}
  return typeof params.sessionID === "string" ? params.sessionID : undefined
}

export function activeLedger(api: TuiPluginApi) {
  return api.route.current.name === ROUTE && !api.ui.dialog.open
}

export function openLedger(api: TuiPluginApi) {
  api.ui.dialog.clear()
  const sessionID = currentSessionID(api)
  api.route.navigate(ROUTE, { sessionID, directory: api.state.path.worktree || api.state.path.directory, index: 0, scroll: 0 })
}

export function closeLedger(api: TuiPluginApi) {
  const route = api.route.current
  const state = route.name === ROUTE ? parseRouteParams(route.params) : undefined
  if (state?.sessionID) api.route.navigate("session", { sessionID: state.sessionID })
  else api.route.navigate("home")
}

export function yankBlockToClipboard(api: TuiPluginApi, block: LedgerBlock) {
  const body = block.patch
    .split("\n")
    .filter((line) => !parseHunk(line))
    .join("\n")
    .trimEnd()
  return api.renderer.copyToClipboardOSC52(body)
}
