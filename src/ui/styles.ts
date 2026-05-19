import { SyntaxStyle } from "@opentui/core"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { VisibleDiffKind } from "../types"

function lineColor(line: string) {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "#a8b3cf"
  if (line.startsWith("+")) return "#3ee06f"
  if (line.startsWith("-")) return "#ff6572"
  if (line.startsWith("@@")) return "#8fb4ff"
  if (line.startsWith("Index:") || line.startsWith("=")) return "#a8b3cf"
  return "#c8d0e8"
}

export function rowColor(kind: VisibleDiffKind, line: string) {
  if (kind === "code") return "#c8d0e8"
  return lineColor(line)
}

function lineBackground(line: string) {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return undefined
  if (line.startsWith("+")) return "#082813"
  if (line.startsWith("-")) return "#2f1017"
  if (line.startsWith("@@")) return "#111a31"
  return undefined
}

export function rowBackground(kind: VisibleDiffKind, line: string) {
  if (kind === "code") return undefined
  return lineBackground(line)
}

function activeLineBackground(line: string) {
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "#25314a"
  if (line.startsWith("+")) return "#145c2b"
  if (line.startsWith("-")) return "#6b1d26"
  if (line.startsWith("@@")) return "#24395e"
  return "#1b2540"
}

export function activeRowBackground(kind: VisibleDiffKind, line: string) {
  if (kind === "code") return "#1b2540"
  return activeLineBackground(line)
}

export function codeSyntax(api: TuiPluginApi) {
  const theme = api.theme.current
  return SyntaxStyle.fromStyles({
    default: { fg: theme.text },
    comment: { fg: theme.syntaxComment, italic: true },
    string: { fg: theme.syntaxString },
    number: { fg: theme.syntaxNumber },
    boolean: { fg: theme.syntaxNumber },
    keyword: { fg: theme.syntaxKeyword, italic: true },
    operator: { fg: theme.syntaxOperator },
    punctuation: { fg: theme.syntaxPunctuation },
    variable: { fg: theme.syntaxVariable },
    property: { fg: theme.syntaxVariable },
    function: { fg: theme.syntaxFunction },
    "function.call": { fg: theme.syntaxFunction },
    type: { fg: theme.syntaxType },
    module: { fg: theme.syntaxType },
    constant: { fg: theme.syntaxNumber },
  })
}
