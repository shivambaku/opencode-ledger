import type { FileStatus, LedgerBlock, LedgerFile } from "./types"
import { pathToFiletype } from "@opentui/core"

export function blockReviewed(block: LedgerBlock) {
  return block.review?.hash === block.hash
}

export function blockStale(block: LedgerBlock) {
  return !!block.review && block.review.hash !== block.hash
}

export function blockApproved(block: LedgerBlock) {
  return block.resolved
}

export function blockComment(block: LedgerBlock) {
  const comment = block.comment?.trim()
  return comment || undefined
}

export function blockHasUnresolvedComment(block: LedgerBlock) {
  return !block.resolved && !!blockComment(block)
}

function fileAnalyzed(file: LedgerFile) {
  return file.analysis?.hash === file.hash && file.blocks.every(blockReviewed)
}

export function fileNeedsAnalysis(file: LedgerFile) {
  return !fileAnalyzed(file)
}

export function fileNeedsApproval(file: LedgerFile) {
  return file.blocks.some((block) => !blockApproved(block))
}

export function fileApproved(file: LedgerFile) {
  return !fileNeedsApproval(file)
}

export function unresolvedCommentCount(files: LedgerFile[]) {
  return files.reduce((sum, file) => sum + file.blocks.filter(blockHasUnresolvedComment).length, 0)
}

export function fileImpact(file: LedgerFile) {
  if (fileAnalyzed(file)) return file.analysis!.impact
  return "?"
}

function approvalProgress(file: LedgerFile) {
  const complete = file.blocks.filter(blockApproved).length
  return `${complete}/${file.blocks.length || 1}`
}

function fileStatus(file: LedgerFile): FileStatus {
  return file.status ?? "modified"
}

export function fileStatusMark(file: LedgerFile) {
  const status = fileStatus(file)
  if (status === "added") return "A"
  if (status === "deleted") return "D"
  return "M"
}

export function lineRangeText(block: LedgerBlock) {
  const start = block.newStart || block.oldStart || 1
  const end = block.newEnd || block.oldEnd || start
  return `${start}-${Math.max(start, end)}`
}

export function fileRow(file: LedgerFile, analyzing: boolean, analyzingText = "...") {
  const impact = analyzing ? analyzingText : fileImpact(file)
  return `${approvalProgress(file).padEnd(5)} ${impact.padEnd(6)}`
}

export function blockLabel(file: LedgerFile, block: LedgerBlock) {
  return `${file.path}:${lineRangeText(block)}`
}

export function codeFiletype(path: string) {
  if (path.toLowerCase().endsWith(".vue")) return "typescript"
  return pathToFiletype(path)
}
