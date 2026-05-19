/** @jsxImportSource @opentui/solid */
import { Show } from "solid-js"
import type { SyntaxStyle } from "@opentui/core"
import type { VisibleDiffKind } from "../types"
import { activeRowBackground, rowBackground, rowColor } from "./styles"

export function DiffLine(props: { line: string; width: number; kind: VisibleDiffKind; active: boolean; blockActive: boolean; explanationActive: boolean; blockResolved: boolean; path?: string; filetype?: string; syntaxStyle: SyntaxStyle }) {
  const line = () => props.line
  const codeLine = () => !!props.path
  const backgroundColor = () => {
    if (props.active) return activeRowBackground(props.kind, line())
    return rowBackground(props.kind, line())
  }
  const gutter = () => (props.blockActive ? "▌ " : "  ")
  const gutterColor = () => {
    if (!props.blockActive) return "#263149"
    if (props.blockResolved) {
      if (props.active) return "#3ee06f"
      return props.explanationActive ? "#65f090" : "#2f8f4e"
    }
    if (props.active) return "#86aef5"
    return props.explanationActive ? "#b8d0ff" : "#3e5f99"
  }
  const width = () => Math.max(1, props.width)
  const contentWidth = () => Math.max(1, width() - 2)
  const codeContent = () => (props.kind === "add" || props.kind === "delete" ? line().slice(1) : line()) || " "
  const textColor = () => rowColor(props.kind, line())

  return (
    <box width={width()} overflow="hidden" flexDirection="row" backgroundColor={backgroundColor()}>
      <text width={2} fg={gutterColor()} truncate wrapMode="none">{gutter()}</text>
      <Show when={codeLine()} fallback={<text width={contentWidth()} fg={textColor()} truncate wrapMode="none">{line() || " "}</text>}>
        <code width={contentWidth()} content={codeContent()} filetype={props.filetype} syntaxStyle={props.syntaxStyle} drawUnstyledText={true} truncate wrapMode="none" />
      </Show>
    </box>
  )
}
