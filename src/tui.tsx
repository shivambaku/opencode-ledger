/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { createSignal } from "solid-js"
import { ledgerActionConfigs, ROUTE } from "./constants"
import { registerCommonParsers } from "./parsers"
import { activeLedger, openLedger } from "./runtime"
import { ledgerScope } from "./storage"
import type { LedgerControls } from "./types"
import { LedgerScreen } from "./ui/LedgerScreen"

registerCommonParsers()

function setup(api: Context) {
  const [activeControls, setControls] = createSignal<LedgerControls>()
  let controls: LedgerControls | undefined
  let reconcileTimer: ReturnType<typeof setTimeout> | undefined
  const registerControls = (next?: LedgerControls) => {
    clearTimeout(reconcileTimer)
    controls = next
    setControls(next)
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
    if (!controls) return
    if (!["vcs.branch.updated", "filesystem.changed", "session.idle"].includes(details.type)) return
    const scope = ledgerScope(api)
    if (details.location?.directory !== scope.directory) return
    clearTimeout(reconcileTimer)
    reconcileTimer = setTimeout(() => controls?.reloadDiff(false), 500)
  })

  return () => {
    clearTimeout(reconcileTimer)
    stopEvents()
    unregisterKeys()
    unregisterRoute()
  }
}

export default Plugin.define({
  id: "opencode-ledger",
  setup,
})
