/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { command, ledgerActionConfigs, ledgerKeyBindings, ROUTE } from "./constants"
import { fileNeedsApproval } from "./domain"
import { reconcileWorkspaceDiff } from "./git"
import { activeLedger, openLedger } from "./runtime"
import { ledgerScope, readFilesForScope, routeScope } from "./storage"
import type { LedgerControls } from "./types"
import { errorMessage } from "./utils"
import { LedgerScreen } from "./ui/LedgerScreen"

const tui: TuiPlugin = async (api) => {
  let controls: LedgerControls | undefined
  const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const registerControls = (next?: LedgerControls) => {
    controls = next
  }
  const applyReconcile = async (scope: ReturnType<typeof ledgerScope>) => {
    const applied = await reconcileWorkspaceDiff(api, scope)
    if (applied && controls && controls.scopeID() === scope.id) controls.refresh()
  }
  const reconcile = async (directory: string | undefined) => applyReconcile(routeScope(api, directory))
  const scheduleReconcile = (scope: ReturnType<typeof ledgerScope>) => {
    const timerKey = scope.id
    const existing = reconcileTimers.get(timerKey)
    if (existing) clearTimeout(existing)
    reconcileTimers.set(
      timerKey,
      setTimeout(() => {
        reconcileTimers.delete(timerKey)
        void applyReconcile(scope)
          .catch((error) => {
            if (controls && controls.scopeID() === scope.id) controls.notice(errorMessage(error), "#f6b26b")
          })
      }, 500),
    )
  }
  api.lifecycle.onDispose(() => {
    for (const timer of reconcileTimers.values()) clearTimeout(timer)
    reconcileTimers.clear()
  })

  api.route.register([
    {
      name: ROUTE,
      render: ({ params }) => <LedgerScreen api={api} params={params} registerControls={registerControls} reconcileWorkspace={reconcile} />,
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
    enabled: () => activeLedger(api),
    priority: 1000,
    commands: [
      ...ledgerActionConfigs.map((item) => ({ name: item.command, run: runKey(item.commandKey) })),
    ],
    bindings: ledgerKeyBindings.map((item) => ({ key: item.key, cmd: command[item.action], desc: item.desc })),
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
        return needs ? <text>ledger {needs}</text> : null
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-ledger",
  tui,
}

export default plugin
