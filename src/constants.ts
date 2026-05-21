import type { Impact, LedgerAction } from "./types"

export const ROUTE = "ledger"
export const MAX_EXPLANATIONS_PER_HUNK = 8

export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    impact: { type: "string", enum: ["high", "medium", "low"] },
    hunks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          explanations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                startLine: { type: "number" },
                endLine: { type: "number" },
                explanation: { type: "string" },
              },
              required: ["startLine", "endLine", "explanation"],
            },
          },
        },
        required: ["id", "explanations"],
      },
    },
  },
  required: ["impact", "hunks"],
}

export const impactRank: Record<Impact, number> = { high: 0, medium: 1, low: 2 }

type LedgerActionConfig = {
  action: LedgerAction
  command: string
  commandKey: string
  desc: string
  keys: readonly string[]
  aliases?: readonly string[]
}

export const ledgerActionConfigs = [
  { action: "down", command: "ledger.down", commandKey: "down", desc: "Move", keys: ["j", "down"] },
  { action: "up", command: "ledger.up", commandKey: "up", desc: "Move", keys: ["k", "up"] },
  { action: "nextFile", command: "ledger.nextFile", commandKey: "shift+j", desc: "Next file", keys: ["shift+j"], aliases: ["J"] },
  { action: "prevFile", command: "ledger.prevFile", commandKey: "shift+k", desc: "Previous file", keys: ["shift+k"], aliases: ["K"] },
  { action: "diffLeft", command: "ledger.diffLeft", commandKey: "h", desc: "Scroll left", keys: ["h"] },
  { action: "diffRight", command: "ledger.diffRight", commandKey: "l", desc: "Scroll right", keys: ["l"] },
  { action: "yank", command: "ledger.yank", commandKey: "y", desc: "Yank diff block", keys: ["y"] },
  { action: "yankComments", command: "ledger.yankComments", commandKey: "shift+y", desc: "Yank unresolved comments", keys: ["shift+y"], aliases: ["Y"] },
  { action: "comment", command: "ledger.comment", commandKey: "c", desc: "Add or edit comment", keys: ["c"] },
  { action: "approve", command: "ledger.approve", commandKey: "space", desc: "Toggle approval", keys: ["space"], aliases: [" "] },
  { action: "editor", command: "ledger.editor", commandKey: "e", desc: "Open editor", keys: ["e"] },
  { action: "inspect", command: "ledger.inspect", commandKey: "enter", desc: "Toggle inspect/focus", keys: ["enter"], aliases: ["return"] },
  { action: "explanation", command: "ledger.explanation", commandKey: "tab", desc: "Toggle explanation", keys: ["tab"], aliases: ["\t"] },
  { action: "layout", command: "ledger.layout", commandKey: "|", desc: "Toggle layout", keys: ["|"] },
  { action: "analyze", command: "ledger.analyze", commandKey: "a", desc: "Analyze file", keys: ["a"] },
  { action: "analyzeAll", command: "ledger.analyzeAll", commandKey: "shift+a", desc: "Analyze pending files", keys: ["shift+a"], aliases: ["A"] },
  { action: "stop", command: "ledger.stop", commandKey: "x", desc: "Stop analysis", keys: ["x"] },
  { action: "diffDown", command: "ledger.diffDown", commandKey: "ctrl+d", desc: "Scroll down", keys: ["ctrl+d"], aliases: ["\u0004"] },
  { action: "diffUp", command: "ledger.diffUp", commandKey: "ctrl+u", desc: "Scroll up", keys: ["ctrl+u"], aliases: ["\u0015"] },
  { action: "prevBlock", command: "ledger.prevBlock", commandKey: "shift+n", desc: "Previous block", keys: ["shift+n"], aliases: ["N"] },
  { action: "nextBlock", command: "ledger.nextBlock", commandKey: "n", desc: "Next block", keys: ["n"] },
  { action: "help", command: "ledger.help", commandKey: "?", desc: "Show help", keys: ["?"], aliases: ["shift+/"] },
  { action: "back", command: "ledger.back", commandKey: "escape", desc: "Back or close ledger", keys: ["escape"] },
  { action: "close", command: "ledger.close", commandKey: "q", desc: "Close ledger", keys: ["q"] },
] satisfies readonly LedgerActionConfig[]

export const command = Object.fromEntries(ledgerActionConfigs.map((item) => [item.action, item.command])) as Record<LedgerAction, string>

export const ledgerKeyBindings = ledgerActionConfigs.flatMap((item) => item.keys.map((key) => ({ key, action: item.action, desc: item.desc })))
