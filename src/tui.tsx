/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { command, ledgerActionConfigs, ledgerKeyBindings, ROUTE } from "./constants"
import { fileNeedsApproval } from "./domain"
import { reconcileWorkspaceDiff } from "./git"
import { registerCommonParsers } from "./parsers"
import { activeLedger, openLedger } from "./runtime"
import { ledgerScope, readFilesForScope } from "./storage"
import type { LedgerControls } from "./types"
import { errorMessage } from "./utils"
import { LedgerScreen } from "./ui/LedgerScreen"

registerCommonParsers()

const tui: TuiPlugin = async (api, options) => {
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
  api.lifecycle.onDispose(() => {
    disposed = true
    for (const timer of reconcileTimers.values()) clearTimeout(timer)
    reconcileTimers.clear()
  })

  api.route.register([
    {
      name: ROUTE,
      render: ({ params }) => <LedgerScreen api={api} params={params} analysisModel={options?.model} registerControls={registerControls} />,
    },
  ])

  api.keymap.registerLayer({
    commands: [
      {
        name: "ledger.open",
        title: "Ledger",
        category: "Review",
        namespace: "palette",
        slashName: "ledger",
        run: () => openLedger(api),
      },
    ],
  })

  const runKey = (name: string) => () => controls?.handleKey({ name })
  api.keymap.registerLayer({
    enabled: () => activeLedger(api) && !controls?.commentEditing(),
    priority: 1000,
    commands: [
      ...ledgerActionConfigs.map((item) => ({ name: item.command, run: runKey(item.commandKey) })),
    ],
    bindings: ledgerKeyBindings.map((item) => ({ key: item.key, cmd: command[item.action], desc: item.desc })),
  })

  api.keymap.registerLayer({
    enabled: () => activeLedger(api) && !!controls?.commentEditing(),
    priority: 1001,
    commands: [{ name: "ledger.comment.cancel", run: () => controls?.cancelComment() }],
    bindings: [{ key: "escape", cmd: "ledger.comment.cancel", desc: "Cancel comment" }],
  })

  api.event.on("session.diff", () => {
    const scope = ledgerScope(api)
    scheduleReconcile(scope)
  })

  api.event.on("file.edited", () => {
    scheduleReconcile(ledgerScope(api))
  })

  api.event.on("file.watcher.updated", () => {
    scheduleReconcile(ledgerScope(api))
  })

  api.event.on("vcs.branch.updated", () => {
    scheduleReconcile(ledgerScope(api))
  })

  api.slots.register({
    slots: {
      session_prompt_right() {
        const scope = ledgerScope(api)
        const needs = readFilesForScope(scope).filter(fileNeedsApproval).length
        return needs ? <text>ledger local {needs}</text> : null
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-ledger",
  tui,
}

export default plugin
