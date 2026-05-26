import solidPlugin from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["./src/tui.tsx"],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  splitting: false,
  minify: false,
  sourcemap: "external",
  plugins: [solidPlugin],
  external: ["@opencode-ai/plugin", "@opencode-ai/plugin/tui", "@opentui/core", "@opentui/keymap", "@opentui/solid", "solid-js", "solid-js/store", "node:*"],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
