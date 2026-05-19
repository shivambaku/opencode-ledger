/** @jsxImportSource @opentui/solid */
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { BoxRenderable } from "@opentui/core"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { abortSession, requestAnalysis } from "../analysis"
import { blockContainsFileLine, blockForFileLine, blockHunkStart, buildDisplayRows, diffLineForFileLine } from "../display"
import { blockApproved, blockLabel, blockReviewed, blockStale, codeFiletype, fileApproved, fileImpact, fileNeedsAnalysis, fileNeedsApproval, fileRow, lineRangeText } from "../domain"
import { openEditor } from "../editor"
import { ledgerAction } from "../keys"
import { closeLedger, yankBlockToClipboard } from "../runtime"
import { currentFile, ledgerFiles, ledgerStateVersion, routeScope, setBlockResolved, setFileAnalysisResult, setFileResolved } from "../storage"
import type { InspectFocus, InspectLayout, LedgerAction, LedgerBlock, LedgerControls, LedgerFile, LedgerNotice, VisibleDiffLine } from "../types"
import { clip, errorMessage, fileLines, parseRouteParams, splitWidths, wrapText } from "../utils"
import { DiffLine } from "./DiffLine"
import { codeSyntax } from "./styles"

type ExplanationRow = { text: string; muted?: boolean; fg?: string }
type PanelLayout = { height?: number; flexGrow?: number; flexShrink?: number; flexBasis?: number | "auto"; minHeight?: number }
type LedgerExplanation = NonNullable<LedgerBlock["review"]>["explanations"][number]

export function LedgerScreen(props: { api: TuiPluginApi; params?: Record<string, unknown>; registerControls(controls?: LedgerControls): void; reconcileWorkspace(directory: string | undefined): Promise<void> }) {
  let root: BoxRenderable | undefined
  const dim = useTerminalDimensions()
  const route = parseRouteParams(props.params)
  const syntaxStyle = codeSyntax(props.api)
  const [cursor, setCursor] = createSignal(route.index)
  const [scroll, setScroll] = createSignal(route.scroll)
  const [diffScroll, setDiffScroll] = createSignal(0)
  const [diffCursor, setDiffCursor] = createSignal(0)
  const [explanationScroll, setExplanationScroll] = createSignal(0)
  const [inspectFocus, setInspectFocus] = createSignal<InspectFocus>("diff")
  const [inspectLayout, setInspectLayout] = createSignal<InspectLayout>("bottom")
  const [explanationVisible, setExplanationVisible] = createSignal(false)
  const [inspect, setInspect] = createSignal(false)
  const [revision, setRevision] = createSignal(0)
  const [analyzingIDs, setAnalyzingIDs] = createSignal<Set<string>>(new Set())
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
  const activeBlock = () => {
    const file = selected()
    const row = activeDisplayRow()
    if (!file || !row) return undefined
    if (row.blockID) return file.blocks.find((block) => block.id === row.blockID)
    return blockForFileLine(file, row.fileLine)
  }
  const activeDiffLine = () => {
    const row = activeDisplayRow()
    const block = activeBlock()
    return row?.diffLineIndex ?? (block ? diffLineForFileLine(block, row?.fileLine) : 0)
  }
  const visibleDiffLines = () => displayDiffRows().slice(diffScrollStart(), diffScrollStart() + diffVisibleRows())
  const activeExplanation = createMemo(() => {
    const block = activeBlock()
    if (!explanationVisible()) return undefined
    if (!block?.review?.explanations.length) return undefined
    return explanationForLine(block, activeDiffLine())?.explanation
  })
  const activeExplanationGutterRows = createMemo(() => {
    const block = activeBlock()
    const explanation = activeExplanation()
    const result = new Set<number>()
    if (!block || !explanation) return result

    for (const row of displayDiffRows()) {
      if (!displayRowBelongsToBlock(row, block)) continue
      if (explanationForLine(block, diffLineForRow(block, row))?.explanation === explanation) result.add(row.rowIndex)
    }

    return result
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
  const headerTitle = () => `Ledger ${approvedBlocks()}/${totalBlocks()} approved`
  const headerHelpText = () => notice()?.text ?? helpText()
  const headerHelpWidth = () => Math.max(1, contentWidth() - headerTitle().length - 2)
  const headerHelpTextWidth = () => Math.min(headerHelpText().length, headerHelpWidth())
  const normalWidths = () => splitWidths(contentWidth(), 0.38, 28, 30, 52)
  const inspectWidths = () => splitWidths(contentWidth(), 0.62, 35, 28)

  let analysisToken = 0
  let statePollTimer: ReturnType<typeof setInterval> | undefined
  let lastStateVersion = 0
  const activeAnalysisSessions = new Set<string>()
  const ANALYSIS_CONCURRENCY = 2

  function isAnalyzingFile(file: LedgerFile) {
    return analyzingIDs().has(file.id)
  }

  function isAnalyzing(id: string) {
    return analyzingIDs().has(id)
  }

  function fileImpactText(file: LedgerFile) {
    return isAnalyzing(file.id) ? "..." : fileImpact(file)
  }

  function setAnalyzing(id: string, analyzing: boolean) {
    setAnalyzingIDs((current) => {
      const next = new Set(current)
      if (analyzing) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function showLedgerNotice(text: string, fg = "#8b96b8") {
    if (noticeTimer) clearTimeout(noticeTimer)
    setNotice({ text, fg })
    noticeTimer = setTimeout(() => setNotice(undefined), 2200)
  }

  function helpText() {
    if (!inspect()) return "j/k move  enter inspect  a analyze  A analyze pending  x stop  space approve  e editor  q close"
    if (!explanationVisible()) return "j/k move  n/N block  tab show  space approve  y yank  esc back"
    if (inspectFocus() === "explanation") return "j/k scroll  n/N block  enter diff  tab hide  | layout  space approve  y yank  esc back"
    return "j/k move  n/N block  enter explanation  tab hide  | layout  space approve  y yank  esc back"
  }

  function keepSelectedVisible(nextIndex = index()) {
    const top = scrollStart()
    const bottom = top + visibleRows() - 1
    if (nextIndex < top) setScroll(nextIndex)
    else if (nextIndex > bottom) setScroll(clip(nextIndex - visibleRows() + 1, 0, Math.max(0, files().length - visibleRows())))
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
    const targets = file.blocks
      .map((block) => ({ block, rowIndex: displayIndexForBlock(block) }))
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

    return [
      { text: `Block ${lineRangeText(block)} ${block.resolved ? "approved" : "needs approval"}`, fg: block.resolved ? "#3ee06f" : "#86aef5" },
      { text: " " },
      ...explanationBodyRows(file, block, width),
    ]
  }

  function explanationForLine(block: LedgerBlock, line: number) {
    const explanations = block.review?.explanations ?? []
    const containing = explanations.find((item) => line >= item.diffStartLine && line <= item.diffEndLine)
    if (containing) return { explanation: containing, exact: true }
    const nearest = [...explanations].sort((a, b) => Math.min(Math.abs(a.diffStartLine - line), Math.abs(a.diffEndLine - line)) - Math.min(Math.abs(b.diffStartLine - line), Math.abs(b.diffEndLine - line)))[0]
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
    return activeExplanationGutterRows().has(row.rowIndex)
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

  function refresh(preserveID = selected()?.id) {
    setRevision((value) => value + 1)
    if (preserveID) {
      const nextIndex = files().findIndex((file) => file.id === preserveID)
      if (nextIndex >= 0) setCursor(nextIndex)
      keepSelectedVisible(nextIndex >= 0 ? nextIndex : index())
    } else keepSelectedVisible()
  }

  function refreshAtIndex(nextIndex: number) {
    setRevision((value) => value + 1)
    const clipped = clip(nextIndex, 0, Math.max(0, files().length - 1))
    setCursor(clipped)
    keepSelectedVisible(clipped)
  }

  function withActiveBlock(action: (file: LedgerFile, block: LedgerBlock) => void) {
    const file = selected()
    const block = activeBlock()
    if (file && block) action(file, block)
  }

  async function analyzeFile(fileID: string, token: number) {
    const fileScope = scope()
    const file = currentFile(fileScope, fileID)
    if (!file || isAnalyzing(fileID)) return

    setAnalyzing(fileID, true)
    let sessionID: string | undefined
    try {
      const result = await requestAnalysis(props.api, fileScope, file, () => token === analysisToken, (id) => {
        sessionID = id
        activeAnalysisSessions.add(id)
      })
      if (token !== analysisToken) return
      const preserveID = selected()?.id
      setFileAnalysisResult(fileScope, fileID, file.hash, result.analysis, result.reviews)
      refresh(preserveID)
      showLedgerNotice(`Analyzed ${file.path}.`, "#3ee06f")
    } catch (error) {
      if (token === analysisToken) showLedgerNotice(errorMessage(error), "#f6b26b")
    } finally {
      if (sessionID) activeAnalysisSessions.delete(sessionID)
      setAnalyzing(fileID, false)
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
    const targets = ledgerFiles(scope()).filter((file) => fileNeedsApproval(file) && fileNeedsAnalysis(file) && !isAnalyzing(file.id)).map((file) => file.id)
    if (!targets.length) {
      showLedgerNotice("Everything needing approval is analyzed.")
      return
    }
    await runWithConcurrency(targets, ANALYSIS_CONCURRENCY, async (fileID) => {
      if (token === analysisToken) await analyzeFile(fileID, token)
    })
  }

  function deferAnalysis(work: () => void) {
    setTimeout(work, 25)
  }

  async function stopAnalysis() {
    analysisToken++
    const currentScope = scope()
    const sessions = [...activeAnalysisSessions]
    activeAnalysisSessions.clear()
    setAnalyzingIDs(new Set<string>())
    await Promise.all(sessions.map((sessionID) => abortSession(props.api, currentScope, sessionID)))
    showLedgerNotice("Analysis stopped.")
  }

  function renderDiffPanel(width: number, layout: PanelLayout = {}) {
    const file = selected()
    const innerWidth = Math.max(1, width - 6)
    const showStatus = () => innerWidth > 1
    const statusText = () => (file ? `${fileImpactText(file)} · ${fileApprovalPosition()} · diff ${diffPosition()}` : "")
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
              return <DiffLine line={line.line} width={innerWidth} kind={line.kind} active={active()} blockActive={inspect() && rowHasActiveGutter(line)} explanationActive={explanationRegion()} blockResolved={!!activeBlock()?.resolved} path={file.path} filetype={selectedFiletype()} syntaxStyle={syntaxStyle} />
            }}</For>
          </box>
        ) : <text fg="#8b96b8">No uncommitted Git changes. Make changes, then open Ledger again.</text>}
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
      diffDown: () => (explanationFocused() ? controls.scrollExplanation(page) : controls.scrollDiff(page)),
      diffUp: () => (explanationFocused() ? controls.scrollExplanation(-page) : controls.scrollDiff(-page)),
      prevBlock: () => controls.jumpBlock(-1),
      nextBlock: () => controls.jumpBlock(1),
      yank: controls.yank,
      approve: controls.approve,
      editor: controls.editor,
      inspect: controls.inspect,
      explanation: controls.explanation,
      layout: controls.layout,
      analyze: controls.analyze,
      analyzeAll: controls.analyzeAll,
      stop: controls.stop,
      back: controls.back,
      close: controls.close,
    }
    handlers[action]()
  }

  const controls: LedgerControls = {
    scopeID,
    move(delta) {
      if (!files().length) return
      const nextIndex = clip(index() + delta, 0, files().length - 1)
      setCursor(nextIndex)
      focusDiffLine(files()[nextIndex])
      keepSelectedVisible(nextIndex)
    },
    scrollDiff(delta) {
      const rows = displayDiffRows()
      if (!rows.length) return
      const nextIndex = clip(activeDisplayIndex() + delta, 0, rows.length - 1)
      setDiffCursor(nextIndex)
      setExplanationScroll(0)
      keepDisplayRowVisible(nextIndex)
    },
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
        const ok = yankBlockToClipboard(props.api, block)
        showLedgerNotice(ok ? `Yanked ${blockLabel(file, block)}.` : "Clipboard unavailable. Enable OSC 52.", ok ? "#3ee06f" : "#f6b26b")
      })
    },
    approve() {
      const file = selected()
      const block = activeBlock()
      if (!file) return
      if (inspect() && block) {
        const previousRow = activeDisplayRow()
        const previousIndex = activeDisplayIndex()
        const nextResolved = !block.resolved
        setBlockResolved(scope(), file.id, block.id, nextResolved)
        refresh(file.id)
        const nextCursor = cursorAfterRowsChange(previousRow, previousIndex)
        setDiffCursor(nextCursor)
        keepDisplayRowVisible(nextCursor)
        return
      }
      const nextIndex = index()
      setFileResolved(scope(), file.id, !fileApproved(file))
      refreshAtIndex(nextIndex)
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
    },
    layout() {
      if (!inspect() || !explanationVisible()) return
      setInspectLayout((layout) => (layout === "side" ? "bottom" : "side"))
      setExplanationScroll(0)
      keepDisplayRowVisible(activeDisplayIndex())
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
    stop() {
      void stopAnalysis()
    },
    back() {
      if (inspect()) {
        if (inspectFocus() === "explanation") {
          setInspectFocus("diff")
          return
        }
        setInspect(false)
        setInspectFocus("diff")
        setExplanationVisible(false)
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
    if (statePollTimer) clearInterval(statePollTimer)
    if (noticeTimer) clearTimeout(noticeTimer)
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
        if (!props.api.ui.dialog.open && !root?.focused) root?.focus()
      }}
      width={dim().width}
      height={dim().height}
      flexDirection="column"
      paddingTop={1}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor="#070a10"
    >
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <text fg="#d9e2ff"><b>Ledger</b> <span style={{ fg: "#8b96b8" }}>{approvedBlocks()}/{totalBlocks()} approved</span></text>
        <box width={headerHelpWidth()} flexDirection="row" justifyContent="flex-end" overflow="hidden">
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
              return (
                <box backgroundColor={on() ? "#86aef5" : undefined}>
                  <text fg={on() ? "#07101f" : fileApproved(file) ? "#78839f" : "#d5dcf6"}>{fileRow(file, isAnalyzingFile(file))}</text>
                </box>
              )
            }}</For>
          </box>
          {renderDiffPanel(normalWidths().right)}
        </box>
      )}
    </box>
  )
}
