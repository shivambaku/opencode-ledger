/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { createSignal } from "solid-js"
import { ledgerActionConfigs, ROUTE } from "./constants"
import { fileNeedsApproval } from "./domain"
import { reconcileWorkspaceDiff } from "./git"
import { registerCommonParsers } from "./parsers"
import { activeLedger, openLedger } from "./runtime"
import { ledgerScope, readFilesForScope } from "./storage"
import type { LedgerControls } from "./types"
import { errorMessage } from "./utils"
import { LedgerScreen } from "./ui/LedgerScreen"

registerCommonParsers()

function setup(api: Context) {
  const [activeControls, setControls] = createSignal<LedgerControls>()
  let controls: LedgerControls | undefined
  const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const reconcileTokens = new Map<string, number>()
  let disposed = false
  const registerControls = (next?: LedgerControls) => {
    // The screen owns reconciliation while open; invalidate background requests.
    for (const [id, token] of reconcileTokens) reconcileTokens.set(id, token + 1)
    for (const timer of reconcileTimers.values()) clearTimeout(timer)
    reconcileTimers.clear()
    controls = next
    setControls(next)
  }
  const applyReconcile = async (scope: ReturnType<typeof ledgerScope>) => {
    const token = (reconcileTokens.get(scope.id) ?? 0) + 1
    reconcileTokens.set(scope.id, token)
    const active = () => !disposed && reconcileTokens.get(scope.id) === token
    const applied = await reconcileWorkspaceDiff(api, scope, active)
    if (applied && active() && controls && controls.scopeID() === scope.id) controls.refresh()
  }
  const scheduleReconcile = (scope: ReturnType<typeof ledgerScope>) => {
    const timerKey = scope.id
    const existing = reconcileTimers.get(timerKey)
    if (existing) clearTimeout(existing)
    reconcileTimers.set(
      timerKey,
      setTimeout(() => {
        reconcileTimers.delete(timerKey)
        if (controls) {
          controls.reloadDiff(false)
          return
        }
        void applyReconcile(scope)
          .catch((error) => {
            if (!disposed && controls && controls.scopeID() === scope.id) controls.notice(errorMessage(error), "error")
          })
      }, 500),
    )
  }
  const unregisterRoute = api.ui.router.register({
    name: ROUTE,
    render: ({ data }) => <LedgerScreen api={api} params={data} analysisModel={api.options.model} registerControls={registerControls} />,
  })

  // V2 keymap layers need the mounted app's provider and Solid owner.
  const unregisterKeys = api.ui.slot({
    append: "app",
    render: () => {
      api.keymap.layer(() => ({
        mode: "global",
        commands: [{
          id: "ledger.open",
          title: "Ledger",
          group: "Review",
          palette: true,
          slash: { name: "ledger" },
          run: () => openLedger(api),
        }],
      }))

      const runKey = (name: string) => () => { controls?.handleKey({ name }) }
      api.keymap.layer(() => ({
        enabled: () => activeLedger(api) && !activeControls()?.commentEditing(),
        priority: 1000,
        commands: ledgerActionConfigs.map((item) => ({
          id: item.command, title: item.desc, bind: item.keys.join(","), run: runKey(item.commandKey),
        })),
      }))

      api.keymap.layer(() => ({
        enabled: () => activeLedger(api) && !!activeControls()?.commentEditing(),
        priority: 1001,
        commands: [{ id: "ledger.comment.cancel", bind: "escape", title: "Cancel comment", run: () => controls?.cancelComment() }],
      }))
      return null
    },
  })

  const stopEvents = api.data.listen(({ details }) => {
    if (!["vcs.updated", "file.edited", "file.watcher.updated", "session.idle"].includes(details.type)) return
    const scope = ledgerScope(api)
    if (details.location?.directory !== scope.directory) return
    scheduleReconcile(scope)
  })

  const unregisterSlot = api.ui.slot({
    append: "prompt.footer.status",
    render: ({ sessionID }) => {
      const scope = ledgerScope(api, sessionID)
      const needs = readFilesForScope(scope).filter(fileNeedsApproval).length
      return needs ? <text>ledger local {needs}</text> : null
    },
  })

  return () => {
    disposed = true
    for (const timer of reconcileTimers.values()) clearTimeout(timer)
    reconcileTimers.clear()
    stopEvents()
    unregisterKeys()
    unregisterSlot()
    unregisterRoute()
  }
}

export default Plugin.define({
  id: "opencode-ledger",
  setup,
})
