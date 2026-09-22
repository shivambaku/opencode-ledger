import { RGBA, SyntaxStyle } from "@opentui/core"
import type { Context as TuiPluginApi } from "@opencode/plugin/tui/context"
import type { ResolvedTheme as TuiThemeCurrent } from "@opencode/theme/tui"
import { createMemo, onCleanup } from "solid-js"
import type { VisibleDiffKind } from "../types"

export function rowColor(theme: TuiThemeCurrent, kind: VisibleDiffKind) {
  if (kind === "add") return theme.diff.text.added
  if (kind === "delete") return theme.diff.text.removed
  return theme.text.base
}

export function rowBackground(theme: TuiThemeCurrent, kind: VisibleDiffKind) {
  if (kind === "add") return theme.diff.background.added
  if (kind === "delete") return theme.diff.background.removed
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
  if (kind === "add") return tint(theme.diff.background.added, theme.diff.highlight.added, 0.22)
  if (kind === "delete") return tint(theme.diff.background.removed, theme.diff.highlight.removed, 0.22)
  return theme.background.raised.base
}

export function selectedForeground(theme: TuiThemeCurrent) {
  // V2's selected state can be transparent; the keyboard cursor uses the
  // focused pair so the active row has a solid fill and matching foreground.
  if (theme.text.action.primary.focused.a > 0) return theme.text.action.primary.focused
  const { r, g, b } = theme.background.action.primary.focused
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
}

function codeSyntax(theme: TuiThemeCurrent) {
  return SyntaxStyle.fromStyles({
    default: { fg: theme.text.base },
    comment: { fg: theme.syntax.comment, italic: true },
    string: { fg: theme.syntax.string },
    number: { fg: theme.syntax.number },
    boolean: { fg: theme.syntax.number },
    keyword: { fg: theme.syntax.keyword, italic: true },
    operator: { fg: theme.syntax.operator },
    punctuation: { fg: theme.syntax.punctuation },
    variable: { fg: theme.syntax.variable },
    property: { fg: theme.syntax.variable },
    function: { fg: theme.syntax.function },
    "function.call": { fg: theme.syntax.function },
    type: { fg: theme.syntax.type },
    module: { fg: theme.syntax.type },
    constant: { fg: theme.syntax.number },
    "character.special": { fg: theme.syntax.string },
    "markup.heading": { fg: theme.markdown.heading, bold: true },
    "markup.heading.1": { fg: theme.markdown.heading, bold: true, underline: true },
    "markup.heading.2": { fg: theme.markdown.heading, bold: true },
    "markup.heading.3": { fg: theme.markdown.heading, bold: true },
    "markup.heading.4": { fg: theme.markdown.heading, bold: true },
    "markup.heading.5": { fg: theme.markdown.heading, bold: true },
    "markup.heading.6": { fg: theme.markdown.heading, bold: true },
    "markup.bold": { fg: theme.markdown.strong, bold: true },
    "markup.strong": { fg: theme.markdown.strong, bold: true },
    "markup.italic": { fg: theme.markdown.emphasis, italic: true },
    "markup.strikethrough": { fg: theme.text.muted },
    "markup.list": { fg: theme.markdown.listItem },
    "markup.list.checked": { fg: theme.text.feedback.success.base },
    "markup.list.unchecked": { fg: theme.text.muted },
    "markup.quote": { fg: theme.markdown.blockQuote, italic: true },
    "markup.raw": { fg: theme.markdown.code },
    "markup.raw.inline": { fg: theme.markdown.code },
    "markup.raw.block": { fg: theme.markdown.codeBlock },
    "markup.link": { fg: theme.markdown.link, underline: true },
    "markup.link.label": { fg: theme.markdown.linkText, underline: true },
    "markup.link.url": { fg: theme.markdown.link, underline: true },
    "markup.link.bracket.close": { fg: theme.markdown.link },
    label: { fg: theme.markdown.linkText },
    spell: { fg: theme.markdown.text },
    nospell: { fg: theme.markdown.text },
    conceal: { fg: theme.text.muted },
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
    current = codeSyntax(api.theme)
    if (previous) release(previous)
    return current
  })
}
