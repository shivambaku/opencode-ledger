import { parseHunk } from "./git"
import type { LedgerBlock, LedgerFile, VisibleDiffLine } from "./types"
import { clip, fileLines } from "./utils"

export function blockHunkStart(block: LedgerBlock) {
  const hunk = parseHunk(block.patch.split("\n")[0] ?? "")
  const start = hunk?.newStart ?? block.newStart
  return Math.max(1, start || 1)
}

function firstChangedDiffLineForBlock(block: LedgerBlock) {
  const lines = block.patch.split("\n")
  const changed = lines.findIndex((line) => (line.startsWith("+") && !line.startsWith("+++ ")) || (line.startsWith("-") && !line.startsWith("--- ")))
  return block.diffStartLine + Math.max(0, changed)
}

function deletionAnchorFileLine(block: LedgerBlock, totalLines: number) {
  if (totalLines <= 0) return undefined
  return clip(blockHunkStart(block), 1, totalLines)
}

function walkBlockPatch(block: LedgerBlock, visit: (line: string, newLine: number, diffLineIndex: number) => void) {
  let newLine = blockHunkStart(block)
  const lines = block.patch.split("\n")

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const hunk = parseHunk(line)
    if (hunk) {
      newLine = Math.max(1, hunk.newStart)
      continue
    }
    if (line.startsWith("\\")) continue

    visit(line, newLine, block.diffStartLine + index)
    if (line.startsWith("+") || line.startsWith(" ")) newLine++
  }

  return newLine
}

function blockFileLines(block: LedgerBlock, totalLines: number) {
  const result: number[] = []
  walkBlockPatch(block, (line, newLine) => {
    if (line.startsWith("+") || line.startsWith(" ")) {
      if (newLine >= 1) result.push(newLine)
    }
  })

  if (!result.length) {
    const anchor = deletionAnchorFileLine(block, totalLines)
    if (anchor !== undefined) result.push(anchor)
  }
  return result
}

export function blockContainsFileLine(block: LedgerBlock, fileLine: number, totalLines: number) {
  return blockFileLines(block, totalLines).includes(fileLine)
}

export function blockForFileLine(file: LedgerFile | undefined, fileLine: number | undefined) {
  if (!file || fileLine === undefined) return undefined
  const totalLines = fileLines(file.content).length
  return file.blocks.find((block) => blockContainsFileLine(block, fileLine, totalLines))
}

export function diffLineForFileLine(block: LedgerBlock, fileLine: number | undefined) {
  if (fileLine === undefined) return firstChangedDiffLineForBlock(block)

  let match: number | undefined
  walkBlockPatch(block, (line, newLine, diffLineIndex) => {
    if (match === undefined && (line.startsWith("+") || line.startsWith(" ")) && newLine === fileLine) match = diffLineIndex
  })

  return match ?? firstChangedDiffLineForBlock(block)
}

export function buildDisplayRows(file: LedgerFile, base: string) {
  const content = fileLines(file.content)
  const rows: VisibleDiffLine[] = []
  const blocks = [...file.blocks].sort((a, b) => blockHunkStart(a) - blockHunkStart(b) || a.diffStartLine - b.diffStartLine)
  const blocksByFileLine = new Map<number, LedgerBlock>()
  let nextFileLine = 1

  for (const block of blocks) {
    for (const fileLine of blockFileLines(block, content.length)) {
      if (!blocksByFileLine.has(fileLine)) blocksByFileLine.set(fileLine, block)
    }
  }

  function push(row: Omit<VisibleDiffLine, "rowIndex">) {
    rows.push({ ...row, rowIndex: rows.length })
  }

  function pushFileLine(fileLine: number) {
    const block = blocksByFileLine.get(fileLine)
    push({ key: `${base}:file:${fileLine}`, line: content[fileLine - 1] ?? "", kind: "code", fileLine, blockID: block?.id, diffLineIndex: block ? diffLineForFileLine(block, fileLine) : undefined })
  }

  function pushBlockRows(block: LedgerBlock) {
    return walkBlockPatch(block, (line, newLine, diffLineIndex) => {
      if (line.startsWith("+")) {
        push({ key: `${base}:${block.id}:${diffLineIndex}`, line, kind: "add", blockID: block.id, diffLineIndex, fileLine: newLine })
      } else if (line.startsWith("-")) {
        push({ key: `${base}:${block.id}:${diffLineIndex}`, line, kind: "delete", blockID: block.id, diffLineIndex })
      } else if (line.startsWith(" ")) {
        push({ key: `${base}:${block.id}:${diffLineIndex}`, line: line.slice(1), kind: "code", blockID: block.id, diffLineIndex, fileLine: newLine })
      }
    })
  }

  for (const block of blocks) {
    if (block.resolved) continue
    const start = blockHunkStart(block)
    while (nextFileLine < start && nextFileLine <= content.length) pushFileLine(nextFileLine++)
    nextFileLine = Math.max(nextFileLine, pushBlockRows(block))
  }

  while (nextFileLine <= content.length) pushFileLine(nextFileLine++)
  return rows
}
