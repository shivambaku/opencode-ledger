/** @jsxImportSource @opentui/solid */
import { Show } from "solid-js"
import type { SyntaxStyle } from "@opentui/core"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { VisibleDiffKind } from "../types"
import { activeRowBackground, rowBackground, rowColor } from "./styles"

export function DiffLine(props: { line: string; width: number; scrollX: number; kind: VisibleDiffKind; active: boolean; blockActive: boolean; explanationActive: boolean; blockResolved: boolean; path?: string; filetype?: string; syntaxStyle: SyntaxStyle; theme: TuiThemeCurrent }) {
  const line = () => props.line
  const codeLine = () => !!props.path
  const backgroundColor = () => {
    if (props.active) return activeRowBackground(props.theme, props.kind)
    return rowBackground(props.theme, props.kind)
  }
  const gutter = () => (props.blockActive ? "▌ " : "  ")
  const gutterColor = () => {
    if (!props.blockActive) return props.theme.borderSubtle
    if (props.active) return props.theme.primary
    if (props.blockResolved) return props.theme.success
    return props.explanationActive ? props.theme.accent : props.theme.secondary
  }
  const width = () => Math.max(1, props.width)
  const contentWidth = () => Math.max(1, width() - 2)
  const codeContent = () => (props.kind === "add" || props.kind === "delete" ? line().slice(1) : line()) || " "
  const visibleContent = () => codeContent().slice(props.scrollX) || " "
  const textColor = () => rowColor(props.theme, props.kind)

  return (
    <box width={width()} overflow="hidden" flexDirection="row" backgroundColor={backgroundColor()}>
      <text width={2} fg={gutterColor()} truncate wrapMode="none">{gutter()}</text>
      <Show when={codeLine()} fallback={<text width={contentWidth()} fg={textColor()} wrapMode="none">{visibleContent()}</text>}>
        <code width={contentWidth()} content={visibleContent()} filetype={props.filetype} syntaxStyle={props.syntaxStyle} conceal={false} drawUnstyledText={true} wrapMode="none" />
      </Show>
    </box>
  )
}
