import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

let preloaded: Promise<unknown> | undefined
let loaded: Promise<TuiPluginModule & { id: string }> | undefined
const solidPreload = "@opentui/solid/preload"

const loadPlugin = async () => {
  preloaded ??= import(solidPreload)
  await preloaded
  loaded ??= import("./tui").then((mod) => mod.default)
  return loaded
}

const tui: TuiPlugin = async (...args) => {
  const plugin = await loadPlugin()
  await plugin.tui(...args)
}

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-ledger",
  tui,
}

export default plugin
