import { RGBA, SyntaxStyle } from "@opentui/core"
import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { createMemo, onCleanup } from "solid-js"
import type { VisibleDiffKind } from "../types"

export function rowColor(theme: TuiThemeCurrent, kind: VisibleDiffKind) {
  if (kind === "add") return theme.diffAdded
  if (kind === "delete") return theme.diffRemoved
  return theme.text
}

export function rowBackground(theme: TuiThemeCurrent, kind: VisibleDiffKind) {
  if (kind === "add") return theme.diffAddedBg
  if (kind === "delete") return theme.diffRemovedBg
  return undefined
}

function tint(base: RGBA, overlay: RGBA, alpha: number) {
  return RGBA.fromValues(
    base.r + (overlay.r - base.r) * alpha,
    base.g + (overlay.g - base.g) * alpha,
    base.b + (overlay.b - base.b) * alpha,
  )
}

export function activeRowBackground(theme: TuiThemeCurrent, kind: VisibleDiffKind) {
  if (kind === "add") return tint(theme.diffAddedBg, theme.diffHighlightAdded, 0.22)
  if (kind === "delete") return tint(theme.diffRemovedBg, theme.diffHighlightRemoved, 0.22)
  return theme.backgroundPanel
}

export function selectedForeground(theme: TuiThemeCurrent) {
  if (theme.selectedListItemText.a > 0) return theme.selectedListItemText
  const { r, g, b } = theme.primary
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
}

function codeSyntax(theme: TuiThemeCurrent) {
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
    "character.special": { fg: theme.syntaxString },
    "markup.heading": { fg: theme.markdownHeading, bold: true },
    "markup.heading.1": { fg: theme.markdownHeading, bold: true, underline: true },
    "markup.heading.2": { fg: theme.markdownHeading, bold: true },
    "markup.heading.3": { fg: theme.markdownHeading, bold: true },
    "markup.heading.4": { fg: theme.markdownHeading, bold: true },
    "markup.heading.5": { fg: theme.markdownHeading, bold: true },
    "markup.heading.6": { fg: theme.markdownHeading, bold: true },
    "markup.bold": { fg: theme.markdownStrong, bold: true },
    "markup.strong": { fg: theme.markdownStrong, bold: true },
    "markup.italic": { fg: theme.markdownEmph, italic: true },
    "markup.strikethrough": { fg: theme.textMuted },
    "markup.list": { fg: theme.markdownListItem },
    "markup.list.checked": { fg: theme.success },
    "markup.list.unchecked": { fg: theme.textMuted },
    "markup.quote": { fg: theme.markdownBlockQuote, italic: true },
    "markup.raw": { fg: theme.markdownCode },
    "markup.raw.inline": { fg: theme.markdownCode },
    "markup.raw.block": { fg: theme.markdownCodeBlock },
    "markup.link": { fg: theme.markdownLink, underline: true },
    "markup.link.label": { fg: theme.markdownLinkText, underline: true },
    "markup.link.url": { fg: theme.markdownLink, underline: true },
    "markup.link.bracket.close": { fg: theme.markdownLink },
    label: { fg: theme.markdownLinkText },
    spell: { fg: theme.markdownText },
    nospell: { fg: theme.markdownText },
    conceal: { fg: theme.textMuted },
  })
}

export function createCodeSyntax(api: TuiPluginApi) {
  const retained = new Set<SyntaxStyle>()
  let current: SyntaxStyle | undefined

  const release = (style: SyntaxStyle) => {
    retained.add(style)
    void api.renderer
      .idle()
      .catch(() => {})
      .finally(() => {
        if (!retained.delete(style)) return
        style.destroy()
      })
  }

  onCleanup(() => {
    if (current) release(current)
  })

  return createMemo(() => {
    const previous = current
    current = codeSyntax(api.theme.current)
    if (previous) release(previous)
    return current
  })
}
