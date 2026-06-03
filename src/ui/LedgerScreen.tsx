/** @jsxImportSource @opentui/solid */
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { BoxRenderable, KeyEvent, TextareaOptions, TextareaRenderable } from "@opentui/core"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { abortSession, deleteSession, requestAnalysis, requestCommitMessage } from "../analysis"
import { blockContainsFileLine, blockForFileLine, blockHunkStart, buildDisplayRows, diffLineForFileLine } from "../display"
import { blockApproved, blockComment, blockLabel, blockReviewed, blockStale, codeFiletype, fileApproved, fileImpact, fileNeedsAnalysis, fileNeedsApproval, fileRow, fileStatusMark, lineRangeText, unresolvedCommentCount } from "../domain"
import { openEditor } from "../editor"
import { ledgerAction } from "../keys"
import { closeLedger, writeClipboard, yankBlockToClipboard, yankUnresolvedCommentsToClipboard } from "../runtime"
import { currentFile, ledgerFiles, ledgerStateVersion, routeScope, setBlockComment, setBlockResolved, setFileAnalysisResult, setFileResolved } from "../storage"
import type { InspectFocus, InspectLayout, LedgerAction, LedgerBlock, LedgerControls, LedgerFile, LedgerNotice, LedgerScope, VisibleDiffLine } from "../types"
import { clip, errorMessage, fileLines, filename, parseRouteParams, splitWidths, wrapText } from "../utils"
import { DiffLine } from "./DiffLine"
import { codeSyntax } from "./styles"

type ExplanationRow = { text: string; muted?: boolean; fg?: string }
type HelpRow = { section: string; keys: string; desc: string }
type PanelLayout = { height?: number; flexGrow?: number; flexShrink?: number; flexBasis?: number | "auto"; minHeight?: number }
type LedgerExplanation = NonNullable<LedgerBlock["review"]>["explanations"][number]
type CommentEditorState = { file: LedgerFile; block: LedgerBlock; hadComment: boolean }

function analyzingDots(frame: number) {
  return ".".repeat((frame % 3) + 1)
}

const commentKeyBindings = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "enter", action: "submit" },
  { name: "enter", shift: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
] satisfies NonNullable<TextareaOptions["keyBindings"]>

function CommentDialog(props: { title: string; initialValue: string; onSave(value: string): void; onCancel(): void }) {
  let textarea: TextareaRenderable | undefined
  const dim = useTerminalDimensions()
  const [draft, setDraft] = createSignal(props.initialValue)
  const width = () => Math.min(96, Math.max(44, dim().width - 8))
  const height = () => Math.min(18, Math.max(10, dim().height - 6))
  const innerWidth = () => Math.max(1, width() - 4)
  const bodyHeight = () => Math.max(3, height() - 7)
  const left = () => Math.max(0, Math.floor((dim().width - width()) / 2))
  const top = () => Math.max(1, Math.floor((dim().height - height()) / 2))

  function save() {
    props.onSave(textarea?.plainText ?? draft())
  }

  function handleKey(event: KeyEvent) {
    if (event.name !== "escape") return
    event.preventDefault()
    event.stopPropagation()
    props.onCancel()
  }

  onMount(() => {
    setTimeout(() => {
      if (!textarea) return
      textarea.focus()
      textarea.cursorOffset = textarea.plainText.length
    }, 0)
  })

  return (
    <box position="absolute" zIndex={20} left={left()} top={top()} width={width()} height={height()} border borderColor="#86aef5" backgroundColor="#090d16" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
      <text width={innerWidth()} fg="#f0f4ff" truncate wrapMode="none"><b>{props.title}</b></text>
      <text fg="#8b96b8"> </text>
      <box width={innerWidth()} height={bodyHeight()} overflow="hidden">
        <textarea
          ref={(node) => {
            textarea = node
          }}
          focused
          showCursor
          width={innerWidth()}
          height={bodyHeight()}
          initialValue={props.initialValue}
          wrapMode="word"
          textColor="#d5dcf6"
          focusedTextColor="#f0f4ff"
          backgroundColor="#090d16"
          focusedBackgroundColor="#090d16"
          placeholder="Add a comment for this block..."
          placeholderColor="#5e6a86"
          keyBindings={commentKeyBindings}
          onSubmit={save}
          onContentChange={setDraft}
          onKeyPress={handleKey}
        />
      </box>
      <text fg="#8b96b8"> </text>
      <text width={innerWidth()} fg="#8b96b8" truncate wrapMode="none">enter save   shift+enter newline   esc cancel</text>
    </box>
  )
}

const helpRows: HelpRow[] = [
  { section: "File View", keys: "j / k", desc: "Move file selection" },
  { section: "File View", keys: "enter", desc: "Open selected file diff" },
  { section: "File View", keys: "space", desc: "Toggle selected file approval" },
  { section: "File View", keys: "a", desc: "Analyze selected file" },
  { section: "File View", keys: "A", desc: "Analyze all pending files" },
  { section: "File View", keys: "Y", desc: "Yank unresolved comments" },
  { section: "File View", keys: "x", desc: "Stop analysis" },
  { section: "Diff View", keys: "j / k", desc: "Move diff cursor" },
  { section: "Diff View", keys: "h / l", desc: "Scroll diff horizontally" },
  { section: "Diff View", keys: "ctrl+d / ctrl+u", desc: "Scroll diff by half a page" },
  { section: "Diff View", keys: "J / K, n / N", desc: "Next or previous block" },
  { section: "Diff View", keys: "space", desc: "Toggle active block approval" },
  { section: "Diff View", keys: "tab", desc: "Show or hide explanation" },
  { section: "Diff View", keys: "enter", desc: "Focus explanation when visible" },
  { section: "Diff View", keys: "|", desc: "Toggle explanation layout" },
  { section: "Diff View", keys: "c", desc: "Add or edit active block comment" },
  { section: "Diff View", keys: "y", desc: "Yank active block" },
  { section: "Diff View", keys: "Y", desc: "Yank unresolved comments" },
  { section: "Diff View", keys: "e", desc: "Open editor at active block" },
  { section: "Diff View", keys: "esc", desc: "Return to file view" },
  { section: "Explanation", keys: "j / k", desc: "Scroll explanation" },
  { section: "Explanation", keys: "ctrl+d / ctrl+u", desc: "Page explanation" },
  { section: "Explanation", keys: "enter", desc: "Focus diff" },
  { section: "Explanation", keys: "tab", desc: "Hide explanation" },
  { section: "Explanation", keys: "esc", desc: "Return focus to diff" },
  { section: "General", keys: "] / [", desc: "Next or previous file" },
  { section: "General", keys: "m", desc: "Generate commit message" },
  { section: "General", keys: "?", desc: "Toggle help" },
  { section: "General", keys: "q", desc: "Close ledger" },
]

export function LedgerScreen(props: { api: TuiPluginApi; params?: Record<string, unknown>; analysisModel?: unknown; registerControls(controls?: LedgerControls): void; reconcileWorkspace(directory: string | undefined): Promise<void> }) {
  let root: BoxRenderable | undefined
  const dim = useTerminalDimensions()
  const route = parseRouteParams(props.params)
  const syntaxStyle = codeSyntax(props.api)
  const [cursor, setCursor] = createSignal(route.index)
  const [scroll, setScroll] = createSignal(route.scroll)
  const [diffScroll, setDiffScroll] = createSignal(0)
  const [diffScrollX, setDiffScrollX] = createSignal(0)
  const [diffCursor, setDiffCursor] = createSignal(0)
  const [explanationScroll, setExplanationScroll] = createSignal(0)
  const [inspectFocus, setInspectFocus] = createSignal<InspectFocus>("diff")
  const [inspectLayout, setInspectLayout] = createSignal<InspectLayout>("bottom")
  const [explanationVisible, setExplanationVisible] = createSignal(false)
  const [helpVisible, setHelpVisible] = createSignal(false)
  const [helpCursor, setHelpCursor] = createSignal(0)
  const [helpScroll, setHelpScroll] = createSignal(0)
  const [inspect, setInspect] = createSignal(false)
  const [commentEditor, setCommentEditor] = createSignal<CommentEditorState | undefined>()
  const [revision, setRevision] = createSignal(0)
  const [analyzingIDs, setAnalyzingIDs] = createSignal<Set<string>>(new Set())
  const [generatingCommitMessage, setGeneratingCommitMessage] = createSignal(false)
  const [analyzingFrame, setAnalyzingFrame] = createSignal(0)
  const [notice, setNotice] = createSignal<LedgerNotice | undefined>()
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  const scope = createMemo(() => routeScope(props.api, route.directory))
  const scopeID = () => scope().id
  const files = createMemo(() => {
    revision()
    return ledgerFiles(scope())
  })
  const approvedBlocks = createMemo(() => files().reduce((sum, file) => sum + file.blocks.filter(blockApproved).length, 0))
  const totalBlocks = createMemo(() => files().reduce((sum, file) => sum + file.blocks.length, 0))
  const commentCount = createMemo(() => unresolvedCommentCount(files()))
  const visibleRows = () => Math.max(5, dim().height - 7)
  const inspectRows = () => Math.max(8, dim().height - 7)
  const bottomExplanationHeight = () => clip(Math.floor(inspectRows() * 0.38), 4, Math.max(4, inspectRows() - 5))
  const bottomDiffHeight = () => Math.max(5, inspectRows() - bottomExplanationHeight())
  const bottomExplanationLayout = () => inspect() && explanationVisible() && inspectLayout() === "bottom"
  const diffVisibleRows = () => (bottomExplanationLayout() ? Math.max(1, bottomDiffHeight() - 4) : Math.max(6, dim().height - 7))
  const explanationVisibleRows = () => (bottomExplanationLayout() ? Math.max(1, bottomExplanationHeight() - 2) : Math.max(6, dim().height - 7))
  const index = () => clip(cursor(), 0, Math.max(0, files().length - 1))
  const selected = () => files()[index()]
  const selectedFiletype = createMemo(() => (selected() ? codeFiletype(selected()!.path) : undefined))
  const scrollStart = () => clip(scroll(), 0, Math.max(0, files().length - visibleRows()))
  const shownFiles = () => files().slice(scrollStart(), scrollStart() + visibleRows())
  const displayDiffRows = createMemo(() => {
    const file = selected()
    const base = file ? `${file.id}:${file.hash}` : "none"
    return file ? buildDisplayRows(file, base) : []
  })
  const diffMaxScroll = () => Math.max(0, displayDiffRows().length - diffVisibleRows())
  const diffScrollStart = () => clip(diffScroll(), 0, diffMaxScroll())
  const activeDisplayIndex = () => clip(diffCursor(), 0, Math.max(0, displayDiffRows().length - 1))
  const activeDisplayRow = () => displayDiffRows()[activeDisplayIndex()]
  const activeBlock = createMemo(() => {
    const file = selected()
    const row = activeDisplayRow()
    if (!file || !row) return undefined
    if (row.blockID) return file.blocks.find((block) => block.id === row.blockID)
    return blockForFileLine(file, row.fileLine)
  })
  const activeDiffLine = createMemo(() => {
    const row = activeDisplayRow()
    const block = activeBlock()
    return row?.diffLineIndex ?? (block ? diffLineForFileLine(block, row?.fileLine) : 0)
  })
  const visibleDiffLines = () => displayDiffRows().slice(diffScrollStart(), diffScrollStart() + diffVisibleRows())
  const activeExplanation = createMemo(() => {
    const block = activeBlock()
    if (!explanationVisible()) return undefined
    if (!block?.review?.explanations.length) return undefined
    return explanationForLine(block, activeDiffLine())?.explanation
  })
  const diffPosition = () => {
    const total = displayDiffRows().length
    if (!total) return "0/0"
    const start = diffScrollStart() + 1
    const end = Math.min(total, diffScrollStart() + diffVisibleRows())
    return `${start}-${end}/${total}`
  }
  const fileApprovalPosition = () => {
    const file = selected()
    if (!file?.blocks.length) return "approved 0/0"
    return `approved ${file.blocks.filter(blockApproved).length}/${file.blocks.length}`
  }
  const contentWidth = () => Math.max(1, dim().width - 4)
  const commentCountText = () => (commentCount() ? ` · ${commentCount()} ${commentCount() === 1 ? "comment" : "comments"}` : "")
  const headerTitle = () => `Ledger ${approvedBlocks()}/${totalBlocks()} approved${commentCountText()}`
  const headerWidth = () => Math.max(1, contentWidth() - 2)
  const headerHelpText = () => notice()?.text ?? helpText()
  const headerHelpWidth = () => Math.max(1, headerWidth() - headerTitle().length - 2)
  const headerHelpTextWidth = () => Math.min(headerHelpText().length, headerHelpWidth())
  const normalWidths = () => splitWidths(contentWidth(), 0.38, 28, 30, 52)
  const fileListInnerWidth = () => Math.max(1, normalWidths().left - 4)
  const inspectWidths = () => splitWidths(contentWidth(), 0.62, 35, 28)
  const helpWidth = () => Math.min(96, Math.max(44, contentWidth() - 4))
  const helpHeight = () => Math.min(22, Math.max(10, dim().height - 4))
  const helpBodyRows = () => Math.max(1, helpHeight() - 8)
  const helpLeft = () => Math.max(0, Math.floor((dim().width - helpWidth()) / 2))
  const helpTop = () => Math.max(1, Math.floor((dim().height - helpHeight()) / 2))

  let analysisToken = 0
  let disposed = false
  let statePollTimer: ReturnType<typeof setInterval> | undefined
  let analyzingFrameTimer: ReturnType<typeof setInterval> | undefined
  let lastStateVersion = 0
  let completedFileForBack: { index: number; fileID: string } | undefined
  const activeAnalysisSessions = new Map<string, LedgerScope>()
  const deferredTimers = new Set<ReturnType<typeof setTimeout>>()
  const ANALYSIS_CONCURRENCY = 2

  function analysisActive(token: number) {
    return !disposed && token === analysisToken
  }

  function isAnalyzingFile(file: LedgerFile) {
    return analyzingIDs().has(file.id)
  }

  function isAnalyzing(id: string) {
    return analyzingIDs().has(id)
  }

  function analyzingText() {
    return analyzingDots(analyzingFrame())
  }

  function fixedAnalyzingText() {
    return analyzingText().padEnd(3)
  }

  function fileImpactText(file: LedgerFile) {
    return isAnalyzing(file.id) ? fixedAnalyzingText() : fileImpact(file)
  }

  function fileStatusColor(file: LedgerFile, muted: boolean) {
    if (muted) return "#78839f"
    const mark = fileStatusMark(file)
    if (mark === "A") return "#65f090"
    if (mark === "D") return "#ff7aa8"
    return "#86aef5"
  }

  function setAnalyzing(id: string, analyzing: boolean) {
    if (disposed) return
    setAnalyzingIDs((current) => {
      const next = new Set(current)
      if (analyzing) next.add(id)
      else next.delete(id)
      return next
    })
  }

  createEffect(() => {
    const active = analyzingIDs().size > 0
    if (active && !analyzingFrameTimer) {
      analyzingFrameTimer = setInterval(() => setAnalyzingFrame((frame) => frame + 1), 400)
    } else if (!active && analyzingFrameTimer) {
      clearInterval(analyzingFrameTimer)
      analyzingFrameTimer = undefined
      setAnalyzingFrame(0)
    }
  })

  function showLedgerNotice(text: string, fg = "#8b96b8") {
    if (disposed) return
    if (noticeTimer) clearTimeout(noticeTimer)
    setNotice({ text, fg })
    noticeTimer = setTimeout(() => {
      if (!disposed) setNotice(undefined)
    }, 2200)
  }

  async function deleteAnalysisSession(sessionID: string, sessionScope: LedgerScope) {
    activeAnalysisSessions.delete(sessionID)
    await deleteSession(props.api, sessionScope, sessionID)
  }

  async function abortActiveAnalysisSessions() {
    const sessions = [...activeAnalysisSessions.entries()]
    activeAnalysisSessions.clear()
    await Promise.all(sessions.map(async ([sessionID, sessionScope]) => {
      await abortSession(props.api, sessionScope, sessionID)
      await deleteSession(props.api, sessionScope, sessionID)
    }))
  }

  function helpText() {
    return "? help"
  }

  function keepHelpRowVisible(nextIndex = helpCursor()) {
    const row = clip(nextIndex, 0, helpRows.length - 1)
    const top = clip(helpScroll(), 0, Math.max(0, helpRows.length - helpBodyRows()))
    const bottom = top + helpBodyRows() - 1
    if (row < top) setHelpScroll(row)
    else if (row > bottom) setHelpScroll(clip(row - helpBodyRows() + 1, 0, Math.max(0, helpRows.length - helpBodyRows())))
  }

  function moveHelpCursor(delta: number) {
    const nextIndex = clip(helpCursor() + delta, 0, helpRows.length - 1)
    setHelpCursor(nextIndex)
    keepHelpRowVisible(nextIndex)
  }

  function closeHelp() {
    setHelpVisible(false)
  }

  function toggleHelp() {
    setHelpVisible((visible) => {
      const next = !visible
      if (next) keepHelpRowVisible()
      return next
    })
  }

  function diffPanelWidth() {
    if (!inspect()) return normalWidths().right
    if (!explanationVisible()) return contentWidth()
    return inspectLayout() === "side" ? inspectWidths().left : contentWidth()
  }

  function diffMaxScrollX(innerWidth = Math.max(1, diffPanelWidth() - 6)) {
    const visibleCodeWidth = Math.max(1, innerWidth - 2)
    const longest = displayDiffRows().reduce((max, row) => Math.max(max, diffRowContent(row).length), 0)
    return Math.max(0, longest - visibleCodeWidth)
  }

  function diffRowContent(row: VisibleDiffLine) {
    return row.kind === "add" || row.kind === "delete" ? row.line.slice(1) : row.line
  }

  function clampDiffScrollX(innerWidth?: number) {
    setDiffScrollX((value) => clip(value, 0, diffMaxScrollX(innerWidth)))
  }

  function keepSelectedVisible(nextIndex = index()) {
    const top = scrollStart()
    const bottom = top + visibleRows() - 1
    if (nextIndex < top) setScroll(nextIndex)
    else if (nextIndex > bottom) setScroll(clip(nextIndex - visibleRows() + 1, 0, Math.max(0, files().length - visibleRows())))
  }

  function focusFileIndex(nextIndex: number) {
    const clipped = clip(nextIndex, 0, files().length - 1)
    setCursor(clipped)
    focusDiffLine(files()[clipped])
    keepSelectedVisible(clipped)
  }

  function nearestUnreviewedFileIndex(fromIndex: number) {
    const list = files()
    if (!list.length) return -1
    const start = clip(fromIndex, 0, list.length - 1)
    for (let i = start; i < list.length; i++) if (fileNeedsApproval(list[i])) return i
    for (let i = start - 1; i >= 0; i--) if (fileNeedsApproval(list[i])) return i
    return -1
  }

  function displayRowBelongsToBlock(row: VisibleDiffLine, block: LedgerBlock) {
    if (row.blockID === block.id) return true
    const file = selected()
    if (!file || row.fileLine === undefined) return false
    return blockContainsFileLine(block, row.fileLine, fileLines(file.content).length)
  }

  function displayIndexForBlock(block: LedgerBlock | undefined) {
    const rows = displayDiffRows()
    if (!rows.length || !block) return 0
    const next = rows.findIndex((row) => displayRowBelongsToBlock(row, block))
    return next >= 0 ? next : clip(blockHunkStart(block) - 1, 0, rows.length - 1)
  }

  function keepDisplayRowVisible(rowIndex: number) {
    const row = clip(rowIndex, 0, Math.max(0, displayDiffRows().length - 1))
    const top = diffScrollStart()
    const bottom = top + diffVisibleRows() - 1
    if (row < top) setDiffScroll(row)
    else if (row > bottom) setDiffScroll(clip(row - diffVisibleRows() + 1, 0, diffMaxScroll()))
  }

  function alignDisplayRowTop(rowIndex: number) {
    const row = clip(rowIndex, 0, Math.max(0, displayDiffRows().length - 1))
    setDiffScroll(clip(row, 0, diffMaxScroll()))
  }

  function focusDiffLine(file: LedgerFile | undefined) {
    const nextIndex = displayIndexForBlock(file?.blocks[0])
    setDiffCursor(nextIndex)
    setDiffScroll(clip(nextIndex - 2, 0, diffMaxScroll()))
    setDiffScrollX(0)
    setExplanationScroll(0)
  }

  function focusBlock(block: LedgerBlock) {
    const nextIndex = displayIndexForBlock(block)
    setDiffCursor(nextIndex)
    setExplanationScroll(0)
    alignDisplayRowTop(nextIndex)
  }

  function targetBlockForJump(file: LedgerFile, delta: number) {
    const currentRow = activeDisplayIndex()
    const currentBlock = activeBlock()
    const rows = displayDiffRows()
    const rowByBlockID = new Map<string, number>()
    for (const row of rows) {
      if (row.blockID && !rowByBlockID.has(row.blockID)) rowByBlockID.set(row.blockID, row.rowIndex)
    }

    const targets = file.blocks
      .map((block) => ({ block, rowIndex: rowByBlockID.get(block.id) ?? clip(blockHunkStart(block) - 1, 0, Math.max(0, rows.length - 1)) }))
      .sort((a, b) => a.rowIndex - b.rowIndex || a.block.diffStartLine - b.block.diffStartLine)

    if (!targets.length) return undefined

    if (currentBlock) {
      const currentIndex = targets.findIndex((target) => target.block.id === currentBlock.id)
      const nextIndex = currentIndex >= 0 ? clip(currentIndex + delta, 0, targets.length - 1) : delta > 0 ? 0 : targets.length - 1
      return targets[nextIndex].block
    }

    if (delta > 0) return (targets.find((target) => target.rowIndex > currentRow) ?? targets[targets.length - 1]).block
    return ([...targets].reverse().find((target) => target.rowIndex < currentRow) ?? targets[0]).block
  }

  function cursorAfterRowsChange(previousRow: VisibleDiffLine | undefined, previousIndex: number) {
    const rows = displayDiffRows()
    if (!rows.length) return 0
    if (previousRow?.fileLine !== undefined) {
      const sameFileLine = rows.findIndex((row) => row.fileLine === previousRow.fileLine)
      if (sameFileLine >= 0) return sameFileLine
    }
    return clip(previousIndex, 0, rows.length - 1)
  }

  function explanationBodyRows(file: LedgerFile, block: LedgerBlock, width: number): ExplanationRow[] {
    if (isAnalyzing(file.id)) return [{ text: "Analyzing this file with plan mode..." }]
    if (blockReviewed(block)) {
      const match = explanationForLine(block, activeDiffLine())
      if (match) {
        const position = explanationPosition(block, match.explanation)
        return [{ text: `Explanation ${position}`, muted: true }, ...wrapText(match.explanation.explanation, width).map((text) => ({ text }))]
      }
      return [{ text: "No explanation was returned for this hunk." }]
    }

    if (block.resolved) return [{ text: "Approved without AI analysis. Press a if you still want an explanation for this file." }]
    const message = blockStale(block) ? "This block changed since its last AI analysis. Press a to refresh the file analysis." : "This block needs AI analysis. Press a to analyze this file."
    return wrapText(message, width).map((text) => ({ text }))
  }

  function explanationRows(width: number): ExplanationRow[] {
    const file = selected()
    const block = activeBlock()
    if (!file || !block) return [{ text: "No block selected.", muted: true }]

    const comment = blockComment(block)
    return [
      { text: `Block ${lineRangeText(block)} ${block.resolved ? "approved" : "needs approval"}${comment ? " · commented" : ""}`, fg: block.resolved ? "#3ee06f" : "#86aef5" },
      ...(comment ? [{ text: "Comment", muted: true }, ...wrapText(comment, width).map((text) => ({ text, muted: true }))] : []),
      { text: " " },
      ...explanationBodyRows(file, block, width),
    ]
  }

  function explanationForLine(block: LedgerBlock, line: number) {
    const explanations = block.review?.explanations ?? []
    let nearest: LedgerExplanation | undefined
    let nearestDistance = Infinity
    for (const item of explanations) {
      if (line >= item.diffStartLine && line <= item.diffEndLine) return { explanation: item, exact: true }
      const distance = Math.min(Math.abs(item.diffStartLine - line), Math.abs(item.diffEndLine - line))
      if (distance < nearestDistance) {
        nearest = item
        nearestDistance = distance
      }
    }
    return nearest ? { explanation: nearest, exact: false } : undefined
  }

  function explanationPosition(block: LedgerBlock, explanation: LedgerExplanation) {
    const explanations = block.review?.explanations ?? []
    const index = explanations.indexOf(explanation)
    return `${index >= 0 ? index + 1 : 1}/${Math.max(1, explanations.length)}`
  }

  function diffLineForRow(block: LedgerBlock, row: VisibleDiffLine) {
    return row.diffLineIndex ?? diffLineForFileLine(block, row.fileLine)
  }

  function rowInReviewedExplanationRegion(row: VisibleDiffLine) {
    const block = activeBlock()
    const explanation = activeExplanation()
    if (!block || !explanation) return false
    if (!displayRowBelongsToBlock(row, block)) return false
    return explanationForLine(block, diffLineForRow(block, row))?.explanation === explanation
  }

  function rowHasActiveGutter(row: VisibleDiffLine) {
    const block = activeBlock()
    return !!block && displayRowBelongsToBlock(row, block)
  }

  function explanationMaxScroll() {
    const width = Math.max(20, (inspectLayout() === "bottom" ? contentWidth() : inspectWidths().right) - 6)
    return Math.max(0, explanationRows(width).length - explanationVisibleRows())
  }

  function scrollExplanation(delta: number) {
    setExplanationScroll((value) => clip(value + delta, 0, explanationMaxScroll()))
  }

  function scrollDiffHorizontal(delta: number) {
    if (!inspect() || (explanationVisible() && inspectFocus() === "explanation")) return
    setDiffScrollX((value) => clip(value + delta, 0, diffMaxScrollX()))
  }

  function refresh(preserveID = selected()?.id) {
    setRevision((value) => value + 1)
    if (preserveID) {
      const nextIndex = files().findIndex((file) => file.id === preserveID)
      if (nextIndex >= 0) setCursor(nextIndex)
      keepSelectedVisible(nextIndex >= 0 ? nextIndex : index())
    } else keepSelectedVisible()
  }

  function withActiveBlock(action: (file: LedgerFile, block: LedgerBlock) => void) {
    const file = selected()
    const block = activeBlock()
    if (file && block) action(file, block)
  }

  function openBlockCommentEditor(file: LedgerFile, block: LedgerBlock) {
    root?.blur()
    setCommentEditor({ file, block, hadComment: !!blockComment(block) })
  }

  function saveBlockComment(editor: CommentEditorState, value: string) {
    const comment = value.trim() ? value.trim() : undefined
    setBlockComment(scope(), editor.file.id, editor.block.id, comment)
    setCommentEditor(undefined)
    refresh(editor.file.id)
    showLedgerNotice(comment ? `${editor.hadComment ? "Updated" : "Saved"} comment for ${blockLabel(editor.file, editor.block)}.` : `Cleared comment for ${blockLabel(editor.file, editor.block)}.`, comment ? "#3ee06f" : "#8b96b8")
  }

  async function analyzeFile(fileID: string, token: number) {
    const fileScope = scope()
    const file = currentFile(fileScope, fileID)
    if (!file || isAnalyzing(fileID) || !analysisActive(token)) return

    setAnalyzing(fileID, true)
    let sessionID: string | undefined
    try {
      const result = await requestAnalysis(props.api, fileScope, file, () => token === analysisToken, props.analysisModel, (id) => {
        sessionID = id
        activeAnalysisSessions.set(id, fileScope)
      })
      if (!analysisActive(token)) return
      const preserveID = selected()?.id
      setFileAnalysisResult(fileScope, fileID, file.hash, result.analysis, result.reviews)
      refresh(preserveID)
      showLedgerNotice(`Analyzed ${file.path}.`, "#3ee06f")
    } catch (error) {
      if (analysisActive(token)) showLedgerNotice(errorMessage(error), "#f6b26b")
    } finally {
      if (sessionID) await deleteAnalysisSession(sessionID, fileScope)
      if (analysisActive(token)) setAnalyzing(fileID, false)
    }
  }

  async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
    let next = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++]
        await worker(item)
      }
    })
    await Promise.all(workers)
  }

  async function analyzeAll(token: number) {
    if (!analysisActive(token)) return
    const targets = ledgerFiles(scope()).filter((file) => fileNeedsApproval(file) && fileNeedsAnalysis(file) && !isAnalyzing(file.id)).map((file) => file.id)
    if (!targets.length) {
      showLedgerNotice("Everything needing approval is analyzed.")
      return
    }
    await runWithConcurrency(targets, ANALYSIS_CONCURRENCY, async (fileID) => {
      if (analysisActive(token)) await analyzeFile(fileID, token)
    })
  }

  function commitMessageContextText(result: Awaited<ReturnType<typeof requestCommitMessage>>) {
    if (result.quality === "full") return "full analysis"
    if (result.quality === "partial") return `partial analysis ${result.analyzedFiles}/${result.totalFiles}`
    return "diff only"
  }

  async function generateCommitMessage(token: number) {
    if (!analysisActive(token)) return
    if (generatingCommitMessage()) {
      showLedgerNotice("Commit message is already generating. Press x to stop it.")
      return
    }

    const fileScope = scope()
    setGeneratingCommitMessage(true)
    showLedgerNotice("Generating commit message...")
    let sessionID: string | undefined
    try {
      await props.reconcileWorkspace(route.directory)
      if (!analysisActive(token)) return
      refresh()
      const result = await requestCommitMessage(props.api, fileScope, ledgerFiles(fileScope), () => token === analysisToken, props.analysisModel, (id) => {
        sessionID = id
        activeAnalysisSessions.set(id, fileScope)
      })
      if (!analysisActive(token)) return
      const ok = await writeClipboard(props.api, result.text)
      const context = commitMessageContextText(result)
      showLedgerNotice(ok ? `Yanked commit message (${context}).` : `Generated commit message (${context}), but clipboard unavailable.`, ok ? "#3ee06f" : "#f6b26b")
    } catch (error) {
      if (analysisActive(token)) showLedgerNotice(errorMessage(error), "#f6b26b")
    } finally {
      if (sessionID) await deleteAnalysisSession(sessionID, fileScope)
      if (analysisActive(token)) setGeneratingCommitMessage(false)
    }
  }

  function deferAnalysis(work: () => void) {
    const timer = setTimeout(() => {
      deferredTimers.delete(timer)
      if (!disposed) work()
    }, 25)
    deferredTimers.add(timer)
  }

  async function stopAnalysis() {
    analysisToken++
    setAnalyzingIDs(new Set<string>())
    setGeneratingCommitMessage(false)
    await abortActiveAnalysisSessions()
    showLedgerNotice("Analysis stopped.")
  }

  function renderDiffPanel(width: number, layout: PanelLayout = {}) {
    const file = selected()
    const innerWidth = Math.max(1, width - 6)
    const horizontalScroll = () => clip(diffScrollX(), 0, diffMaxScrollX(innerWidth))
    const showStatus = () => innerWidth > 1
    const activeCommentText = () => {
      const block = activeBlock()
      return inspect() && block && blockComment(block) ? "commented · " : ""
    }
    const statusText = () => (file ? `${activeCommentText()}${fileImpactText(file)} · ${fileApprovalPosition()} · diff ${diffPosition()}` : "")
    const statusWidth = () => (showStatus() ? Math.min(statusText().length, Math.max(1, innerWidth - 1)) : 0)
    const pathWidth = () => Math.max(1, innerWidth - statusWidth())
    return (
      <box width={width} height={layout.height} flexGrow={layout.flexGrow} flexShrink={layout.flexShrink} flexBasis={layout.flexBasis} minHeight={layout.minHeight} overflow="hidden" flexDirection="column" border borderColor={inspect() && inspectFocus() === "diff" ? "#86aef5" : "#263149"} paddingLeft={2} paddingRight={2}>
        {file ? (
          <box flexDirection="column" overflow="hidden" flexGrow={1}>
            <box width={innerWidth} overflow="hidden" flexDirection="row" justifyContent="space-between" paddingBottom={1}>
              <text width={pathWidth()} fg="#f0f4ff" truncate wrapMode="none">{file.path}</text>
              <Show when={showStatus()}>
                <text width={statusWidth()} fg="#8b96b8" truncate wrapMode="none">{statusText()}</text>
              </Show>
            </box>
            <For each={visibleDiffLines()}>{(line) => {
              const active = () => inspect() && line.rowIndex === activeDisplayIndex()
              const explanationRegion = () => inspect() && rowInReviewedExplanationRegion(line)
              return <DiffLine line={line.line} width={innerWidth} scrollX={horizontalScroll()} kind={line.kind} active={active()} blockActive={inspect() && rowHasActiveGutter(line)} explanationActive={explanationRegion()} blockResolved={!!activeBlock()?.resolved} path={file.path} filetype={selectedFiletype()} syntaxStyle={syntaxStyle} />
            }}</For>
          </box>
        ) : <text fg="#8b96b8">No uncommitted Git changes. Make changes, then open Ledger again.</text>}
      </box>
    )
  }

  function renderHelpOverlay() {
    const maxScroll = Math.max(0, helpRows.length - helpBodyRows())
    const start = clip(helpScroll(), 0, maxScroll)
    const visibleRows = helpRows.slice(start, start + helpBodyRows())
    const sectionWidth = 14
    const keyWidth = Math.min(18, Math.max(12, Math.floor(helpWidth() * 0.22)))
    const descWidth = () => Math.max(1, helpWidth() - sectionWidth - keyWidth - 7)
    const footerText = () => `${clip(helpCursor(), 0, helpRows.length - 1) + 1}/${helpRows.length}   j/k move  ctrl+d/u page  ?/esc close`

    return (
      <box position="absolute" zIndex={20} left={helpLeft()} top={helpTop()} width={helpWidth()} height={helpHeight()} border borderColor="#86aef5" backgroundColor="#090d16" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column">
        <text fg="#f0f4ff"><b>Ledger Help</b></text>
        <text fg="#8b96b8"> </text>
        <For each={visibleRows}>{(row, offset) => {
          const rowIndex = () => start + offset()
          const active = () => rowIndex() === helpCursor()
          return (
          <box flexDirection="row" overflow="hidden" backgroundColor={active() ? "#86aef5" : undefined}>
            <text width={sectionWidth} fg={active() ? "#07101f" : "#86aef5"} truncate wrapMode="none">{row.section}</text>
            <text width={keyWidth} fg={active() ? "#07101f" : "#f0f4ff"} truncate wrapMode="none">{row.keys}</text>
            <text width={descWidth()} fg={active() ? "#07101f" : "#d5dcf6"} truncate wrapMode="none">{row.desc}</text>
          </box>
          )
        }}</For>
        <text fg="#8b96b8"> </text>
        <text fg="#8b96b8" truncate wrapMode="none">{footerText()}</text>
      </box>
    )
  }

  function renderReviewPanel(width: number, layout: PanelLayout = {}) {
    const innerWidth = Math.max(20, width - 6)
    const rows = explanationRows(innerWidth)
    const start = clip(explanationScroll(), 0, Math.max(0, rows.length - explanationVisibleRows()))
    return (
      <box width={width} height={layout.height} flexGrow={layout.flexGrow} flexShrink={layout.flexShrink} flexBasis={layout.flexBasis} minHeight={layout.minHeight} overflow="hidden" flexDirection="column" border borderColor={inspectFocus() === "explanation" ? "#86aef5" : "#263149"} paddingLeft={2} paddingRight={2}>
        <For each={rows.slice(start, start + explanationVisibleRows())}>{(row) => <text fg={row.fg ?? (row.muted ? "#8b96b8" : "#d5dcf6")}>{row.text}</text>}</For>
      </box>
    )
  }

  let lastHandledKey = ""
  let lastHandledAt = 0

  function runAction(action: LedgerAction) {
    const explanationFocused = () => inspect() && explanationVisible() && inspectFocus() === "explanation"
    const page = Math.max(1, Math.floor((explanationFocused() ? explanationVisibleRows() : diffVisibleRows()) / 2))
    const handlers: Record<LedgerAction, () => void> = {
      down: () => (inspect() ? (explanationFocused() ? controls.scrollExplanation(1) : controls.scrollDiff(1)) : controls.move(1)),
      up: () => (inspect() ? (explanationFocused() ? controls.scrollExplanation(-1) : controls.scrollDiff(-1)) : controls.move(-1)),
      nextFile: () => controls.move(1),
      prevFile: () => controls.move(-1),
      diffLeft: () => controls.scrollDiffHorizontal(-4),
      diffRight: () => controls.scrollDiffHorizontal(4),
      diffDown: () => (explanationFocused() ? controls.scrollExplanation(page) : controls.scrollDiff(page)),
      diffUp: () => (explanationFocused() ? controls.scrollExplanation(-page) : controls.scrollDiff(-page)),
      prevBlock: () => controls.jumpBlock(-1),
      nextBlock: () => controls.jumpBlock(1),
      help: toggleHelp,
      yank: controls.yank,
      yankComments: controls.yankComments,
      comment: controls.comment,
      approve: controls.approve,
      editor: controls.editor,
      inspect: controls.inspect,
      explanation: controls.explanation,
      layout: controls.layout,
      analyze: controls.analyze,
      analyzeAll: controls.analyzeAll,
      commitMessage: controls.commitMessage,
      stop: controls.stop,
      back: controls.back,
      close: controls.close,
    }
    handlers[action]()
  }

  const controls: LedgerControls = {
    scopeID,
    commentEditing: () => !!commentEditor(),
    cancelComment: () => setCommentEditor(undefined),
    move(delta) {
      if (!files().length) return
      completedFileForBack = undefined
      focusFileIndex(index() + delta)
    },
    scrollDiff(delta) {
      const rows = displayDiffRows()
      if (!rows.length) return
      const nextIndex = clip(activeDisplayIndex() + delta, 0, rows.length - 1)
      setDiffCursor(nextIndex)
      setExplanationScroll(0)
      keepDisplayRowVisible(nextIndex)
    },
    scrollDiffHorizontal,
    scrollExplanation,
    jumpBlock(delta) {
      if (!inspect()) return
      const file = selected()
      if (!file?.blocks.length) return
      const nextBlock = targetBlockForJump(file, delta)
      if (nextBlock) focusBlock(nextBlock)
    },
    yank() {
      if (!inspect()) {
        showLedgerNotice("Enter inspect mode to yank a block.")
        return
      }
      withActiveBlock((file, block) => {
        void yankBlockToClipboard(props.api, file, block)
          .then((ok) => {
            showLedgerNotice(ok ? `Yanked ${blockLabel(file, block)}.` : "Clipboard unavailable.", ok ? "#3ee06f" : "#f6b26b")
          })
          .catch((error) => showLedgerNotice(errorMessage(error), "#f6b26b"))
      })
    },
    yankComments() {
      const count = commentCount()
      if (!count) {
        showLedgerNotice("No unresolved blocks with comments.")
        return
      }
      void yankUnresolvedCommentsToClipboard(props.api, files())
        .then((result) => {
          showLedgerNotice(result.ok ? `Yanked ${result.count} unresolved commented ${result.count === 1 ? "block" : "blocks"}.` : "Clipboard unavailable.", result.ok ? "#3ee06f" : "#f6b26b")
        })
        .catch((error) => showLedgerNotice(errorMessage(error), "#f6b26b"))
    },
    comment() {
      if (!inspect()) {
        showLedgerNotice("Enter inspect mode to add a comment.")
        return
      }
      withActiveBlock(openBlockCommentEditor)
    },
    approve() {
      const file = selected()
      const block = activeBlock()
      if (!file) return
      if (inspect()) {
        if (!block) return
        const previousRow = activeDisplayRow()
        const previousIndex = activeDisplayIndex()
        const previousFileIndex = index()
        const nextResolved = !block.resolved
        const completesFile = nextResolved && file.blocks.every((item) => (item.id === block.id ? true : blockApproved(item)))
        setBlockResolved(scope(), file.id, block.id, nextResolved)
        if (completesFile) completedFileForBack = { index: previousFileIndex, fileID: file.id }
        else if (!nextResolved) completedFileForBack = undefined
        refresh(file.id)
        const nextCursor = cursorAfterRowsChange(previousRow, previousIndex)
        setDiffCursor(nextCursor)
        keepDisplayRowVisible(nextCursor)
        return
      }
      setFileResolved(scope(), file.id, !fileApproved(file))
      refresh(file.id)
    },
    editor() {
      withActiveBlock((file, block) => {
        void openEditor(props.api, scope(), file, block).then((result) => showLedgerNotice(result.text, result.fg))
      })
    },
    inspect() {
      if (!selected()) return
      if (!inspect()) {
        setInspect(true)
        setInspectFocus("diff")
        setExplanationVisible(false)
        keepDisplayRowVisible(activeDisplayIndex())
      } else {
        if (!explanationVisible()) return
        setInspectFocus((focus) => (focus === "diff" ? "explanation" : "diff"))
      }
    },
    explanation() {
      if (!inspect()) return
      const next = !explanationVisible()
      setExplanationVisible(next)
      setExplanationScroll(0)
      if (!next) setInspectFocus("diff")
      keepDisplayRowVisible(activeDisplayIndex())
      clampDiffScrollX()
    },
    layout() {
      if (!inspect() || !explanationVisible()) return
      setInspectLayout((layout) => (layout === "side" ? "bottom" : "side"))
      setExplanationScroll(0)
      keepDisplayRowVisible(activeDisplayIndex())
      clampDiffScrollX()
    },
    analyze() {
      const file = selected()
      if (file) {
        if (isAnalyzing(file.id)) {
          showLedgerNotice("This file is already analyzing. Press x to stop it.")
          return
        }
        const token = analysisToken
        deferAnalysis(() => void analyzeFile(file.id, token))
      }
    },
    analyzeAll() {
      if (inspect()) return
      const token = analysisToken
      deferAnalysis(() => void analyzeAll(token))
    },
    commitMessage() {
      const token = analysisToken
      deferAnalysis(() => void generateCommitMessage(token))
    },
    stop() {
      void stopAnalysis()
    },
    back() {
      if (inspect()) {
        if (inspectFocus() === "explanation") {
          setInspectFocus("diff")
          return
        }
        const completedFile = completedFileForBack
        const fallbackFile = selected()
        const fallbackID = fallbackFile?.id
        setInspect(false)
        setInspectFocus("diff")
        setExplanationVisible(false)
        completedFileForBack = undefined
        if (completedFile && fallbackFile?.id === completedFile.fileID && fileApproved(fallbackFile)) {
          const nextIndex = nearestUnreviewedFileIndex(completedFile.index)
          const fallbackIndex = fallbackID ? files().findIndex((file) => file.id === fallbackID) : -1
          const targetIndex = nextIndex >= 0 ? nextIndex : fallbackIndex
          if (targetIndex >= 0) focusFileIndex(targetIndex)
        }
      }
      else closeLedger(props.api)
    },
    close() {
      closeLedger(props.api)
    },
    refresh,
    notice: showLedgerNotice,
    handleKey(key) {
      if (props.api.ui.dialog.open) return false

      const action = ledgerAction(key)
      if (!action) return false

      if (helpVisible() && action !== "help") {
        if (action === "down") moveHelpCursor(1)
        else if (action === "up") moveHelpCursor(-1)
        else if (action === "diffDown") moveHelpCursor(helpBodyRows())
        else if (action === "diffUp") moveHelpCursor(-helpBodyRows())
        else if (action === "back" || action === "close" || action === "inspect") closeHelp()
        key.preventDefault?.()
        key.stopPropagation?.()
        return true
      }

      const now = Date.now()
      if (action === lastHandledKey && now - lastHandledAt < 25) {
        key.preventDefault?.()
        key.stopPropagation?.()
        return true
      }
      lastHandledKey = action
      lastHandledAt = now

      runAction(action)
      lastStateVersion = ledgerStateVersion(scope())

      key.preventDefault?.()
      key.stopPropagation?.()
      return true
    },
  }

  onMount(() => {
    lastStateVersion = ledgerStateVersion(scope())
    statePollTimer = setInterval(() => {
      const nextVersion = ledgerStateVersion(scope())
      if (nextVersion !== lastStateVersion) {
        lastStateVersion = nextVersion
        refresh()
      }
    }, 1000)
    focusDiffLine(selected())
    props.registerControls(controls)
    void props.reconcileWorkspace(route.directory).then(() => refresh()).catch((error) => showLedgerNotice(errorMessage(error), "#f6b26b"))
    setTimeout(() => root?.focus(), 0)
  })

  onCleanup(() => {
    disposed = true
    analysisToken++
    for (const timer of deferredTimers) clearTimeout(timer)
    deferredTimers.clear()
    if (statePollTimer) clearInterval(statePollTimer)
    if (analyzingFrameTimer) clearInterval(analyzingFrameTimer)
    if (noticeTimer) clearTimeout(noticeTimer)
    void abortActiveAnalysisSessions()
    props.registerControls(undefined)
  })

  return (
    <box
      ref={(node) => {
        root = node
      }}
      focused
      focusable
      renderAfter={() => {
        if (commentEditor()) return
        if (!props.api.ui.dialog.open && !root?.focused) root?.focus()
      }}
      width={dim().width}
      height={dim().height}
      position="relative"
      flexDirection="column"
      paddingTop={1}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor="#070a10"
    >
      <box width={headerWidth()} height={1} marginLeft={1} marginRight={1} flexDirection="row" alignItems="flex-start" justifyContent="space-between" paddingBottom={0}>
        <box height={1} flexDirection="row">
          <text fg="#d9e2ff"><b>Ledger</b> <span style={{ fg: "#8b96b8" }}>{approvedBlocks()}/{totalBlocks()} approved{commentCountText()}</span></text>
        </box>
        <box height={1} width={headerHelpWidth()} flexDirection="row" alignItems="flex-start" justifyContent="flex-end" overflow="hidden">
          <text width={headerHelpTextWidth()} fg={notice()?.fg ?? "#8b96b8"} truncate wrapMode="none">{headerHelpText()}</text>
        </box>
      </box>
      {inspect() ? (
        !explanationVisible() ? (
          renderDiffPanel(contentWidth(), { flexGrow: 1, flexShrink: 1 })
        ) : inspectLayout() === "side" ? (
          <box flexDirection="row" gap={1} flexGrow={1} overflow="hidden">
            {renderDiffPanel(inspectWidths().left, { flexGrow: 1, flexShrink: 1 })}
            {renderReviewPanel(inspectWidths().right, { flexGrow: 1, flexShrink: 1 })}
          </box>
        ) : (
          <box flexDirection="column" flexGrow={1} overflow="hidden">
            {renderDiffPanel(contentWidth(), { flexGrow: bottomDiffHeight(), flexShrink: 1, flexBasis: bottomDiffHeight(), minHeight: 5 })}
            {renderReviewPanel(contentWidth(), { flexGrow: bottomExplanationHeight(), flexShrink: 1, flexBasis: bottomExplanationHeight(), minHeight: 4 })}
          </box>
        )
      ) : (
        <box flexDirection="row" gap={1} flexGrow={1}>
          <box width={normalWidths().left} flexDirection="column" border borderColor="#86aef5" paddingLeft={1} paddingRight={1}>
            <For each={shownFiles()}>{(file) => {
              const on = () => file.id === selected()?.id
              const approved = () => fileApproved(file)
              const muted = () => approved()
              const additions = () => `+${file.additions}`
              const deletions = () => `-${file.deletions}`
              const status = () => fileStatusMark(file)
              const baseText = () => fileRow(file, isAnalyzingFile(file), analyzingText())
              const name = () => filename(file.path)
              const fixedWidth = () => baseText().length + additions().length + deletions().length + 5
              const nameWidth = () => Math.max(1, fileListInnerWidth() - fixedWidth())
              const textColor = () => (muted() ? "#78839f" : "#d5dcf6")
              const addColor = () => (muted() ? "#78839f" : "#65f090")
              const deleteColor = () => (muted() ? "#78839f" : "#ff7aa8")
              return (
                <box flexDirection="row" overflow="hidden" backgroundColor={on() ? "#1b2540" : undefined}>
                  <text width={baseText().length + 1} flexShrink={0} fg={muted() ? "#78839f" : "#d5dcf6"} truncate wrapMode="none">{baseText()} </text>
                  <text width={2} flexShrink={0} fg={fileStatusColor(file, muted())} truncate wrapMode="none">{status()} </text>
                  <text width={nameWidth()} fg={textColor()} truncate wrapMode="none">{name()}</text>
                  <text width={additions().length + 1} flexShrink={0} fg={addColor()} truncate wrapMode="none"> {additions()}</text>
                  <text width={deletions().length + 1} flexShrink={0} fg={deleteColor()} truncate wrapMode="none"> {deletions()}</text>
                </box>
              )
            }}</For>
          </box>
          {renderDiffPanel(normalWidths().right)}
        </box>
      )}
      <Show when={helpVisible()}>{renderHelpOverlay()}</Show>
      <Show when={commentEditor()}>{(editor) => (
        <CommentDialog
          title={`Comment for ${blockLabel(editor().file, editor().block)}`}
          initialValue={editor().block.comment ?? ""}
          onSave={(value) => saveBlockComment(editor(), value)}
          onCancel={() => setCommentEditor(undefined)}
        />
      )}</Show>
    </box>
  )
}
