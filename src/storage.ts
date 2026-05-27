import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { impactRank } from "./constants"
import { fileApproved, fileImpact } from "./domain"
import type { BlockExplanation, BlockReview, FileAnalysis, LedgerBlock, LedgerFile, LedgerScope } from "./types"
import { hashString, isImpact, isRecord, normalizePath } from "./utils"

type LedgerState = { scopes: Record<string, LedgerFile[]> }

const STATE_FILE = ".opencode/ledger/state.json"
const OPENCODE_IGNORE_FILE = ".opencode/.gitignore"
const LEDGER_IGNORE_ENTRY = "/ledger/"

function ledgerScopeIDForDirectory(directory: string | undefined) {
  return hashString(normalizePath(directory || "unknown"))
}

export function ledgerScope(api: TuiPluginApi): LedgerScope {
  return ledgerScopeForDirectory(api.state.path.worktree || api.state.path.directory)
}

function ledgerScopeForDirectory(directory: string | undefined): LedgerScope {
  const resolved = directory || "unknown"
  return { id: ledgerScopeIDForDirectory(resolved), directory: resolved }
}

function statePath(scope: LedgerScope) {
  return join(scope.directory, STATE_FILE)
}

function opencodeIgnorePath(scope: LedgerScope) {
  return join(scope.directory, OPENCODE_IGNORE_FILE)
}

function hasLedgerIgnoreEntry(content: string) {
  return content.split(/\r?\n/).some((line) => {
    const entry = line.trim()
    if (!entry || entry.startsWith("#") || entry.startsWith("!")) return false
    const normalized = entry.replace(/\/+$/, "")
    return normalized === "ledger" || normalized === "/ledger"
  })
}

export function ensureLedgerIgnored(scope: LedgerScope) {
  const path = opencodeIgnorePath(scope)
  mkdirSync(dirname(path), { recursive: true })

  if (!existsSync(path)) {
    writeFileSync(path, `${LEDGER_IGNORE_ENTRY}\n`)
    return
  }

  const content = readFileSync(path, "utf8")
  if (hasLedgerIgnoreEntry(content)) return

  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : ""
  writeFileSync(path, `${content}${separator}${LEDGER_IGNORE_ENTRY}\n`)
}

function isLedgerState(value: unknown): value is LedgerState {
  if (!isRecord(value) || !isRecord(value.scopes)) return false
  return Object.values(value.scopes).every((files) => Array.isArray(files) && files.every(isLedgerFile))
}

function readState(scope: LedgerScope): LedgerState {
  const path = statePath(scope)
  if (!existsSync(path)) return { scopes: {} }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
    return isLedgerState(parsed) ? parsed : { scopes: {} }
  } catch {
    return { scopes: {} }
  }
}

function writeState(scope: LedgerScope, state: LedgerState) {
  const path = statePath(scope)
  mkdirSync(dirname(path), { recursive: true })
  ensureLedgerIgnored(scope)

  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`)
    renameSync(tempPath, path)
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
}

export function readFilesForScope(scope: LedgerScope): LedgerFile[] {
  return readState(scope).scopes[scope.id] ?? []
}

function mergeFileState(incoming: LedgerFile, latest: LedgerFile | undefined) {
  if (!latest || latest.hash !== incoming.hash) return incoming

  const latestBlocks = new Map(latest.blocks.map((block) => [block.id, block]))
  const blocks = incoming.blocks.map((block) => {
    const current = latestBlocks.get(block.id)
    if (!current || current.hash !== block.hash) return block
    const review = current.review?.hash === block.hash && (!block.review || current.review.generatedAt > block.review.generatedAt) ? current.review : block.review
    return current.updatedAt > block.updatedAt ? { ...block, resolved: current.resolved, comment: current.comment, updatedAt: current.updatedAt, review } : { ...block, review }
  })

  const analysis = latest.analysis?.hash === incoming.hash && (!incoming.analysis || latest.analysis.generatedAt > incoming.analysis.generatedAt) ? latest.analysis : incoming.analysis
  return { ...incoming, analysis, blocks, updatedAt: Math.max(incoming.updatedAt, latest.updatedAt) }
}

export function writeFilesForScope(scope: LedgerScope, files: LedgerFile[]) {
  const state = readState(scope)
  const latest = new Map((state.scopes[scope.id] ?? []).map((file) => [file.id, file]))
  state.scopes[scope.id] = files.map((file) => mergeFileState(file, latest.get(file.id)))
  writeState(scope, state)
}

export function ledgerStateVersion(scope: LedgerScope) {
  try {
    return statSync(statePath(scope)).mtimeMs
  } catch {
    return 0
  }
}

function isLedgerFile(value: unknown): value is LedgerFile {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.path === "string" &&
    typeof value.content === "string" &&
    typeof value.patch === "string" &&
    typeof value.hash === "string" &&
    (value.status === undefined || value.status === "modified" || value.status === "added" || value.status === "deleted") &&
    typeof value.additions === "number" &&
    typeof value.deletions === "number" &&
    typeof value.updatedAt === "number" &&
    (value.analysis === undefined || isFileAnalysis(value.analysis)) &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isLedgerBlock)
  )
}

function isFileAnalysis(value: unknown): value is FileAnalysis {
  if (!isRecord(value)) return false
  return typeof value.hash === "string" && isImpact(value.impact) && typeof value.generatedAt === "number"
}

function isLedgerBlock(value: unknown): value is LedgerBlock {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.fileID === "string" &&
    typeof value.patch === "string" &&
    typeof value.hash === "string" &&
    typeof value.diffStartLine === "number" &&
    typeof value.diffEndLine === "number" &&
    typeof value.oldStart === "number" &&
    typeof value.oldEnd === "number" &&
    typeof value.newStart === "number" &&
    typeof value.newEnd === "number" &&
    typeof value.additions === "number" &&
    typeof value.deletions === "number" &&
    typeof value.resolved === "boolean" &&
    (value.comment === undefined || typeof value.comment === "string") &&
    typeof value.updatedAt === "number" &&
    (value.review === undefined || isBlockReview(value.review))
  )
}

function isBlockReview(value: unknown): value is BlockReview {
  if (!isRecord(value)) return false
  return (
    typeof value.hash === "string" &&
    typeof value.generatedAt === "number" &&
    Array.isArray(value.explanations) &&
    value.explanations.every(isBlockExplanation)
  )
}

function isBlockExplanation(value: unknown): value is BlockExplanation {
  if (!isRecord(value)) return false
  return typeof value.diffStartLine === "number" && typeof value.diffEndLine === "number" && typeof value.explanation === "string"
}

function orderedFiles(files: LedgerFile[]) {
  return [...files].sort((a, b) => {
    const aApproved = fileApproved(a)
    const bApproved = fileApproved(b)
    if (aApproved !== bApproved) return aApproved ? 1 : -1
    const aImpact = fileImpact(a)
    const bImpact = fileImpact(b)
    if (isImpact(aImpact) && isImpact(bImpact)) return impactRank[aImpact] - impactRank[bImpact]
    if (isImpact(aImpact) !== isImpact(bImpact)) return isImpact(aImpact) ? -1 : 1
    return a.path.localeCompare(b.path) || b.updatedAt - a.updatedAt
  })
}

export function routeScope(api: TuiPluginApi, directory: string | undefined) {
  return directory ? ledgerScopeForDirectory(directory) : ledgerScope(api)
}

export function ledgerFiles(scope: LedgerScope) {
  const files = readFilesForScope(scope)
  return orderedFiles(files)
}

function updateFile(scope: LedgerScope, id: string, update: (file: LedgerFile) => LedgerFile) {
  writeFilesForScope(scope, readFilesForScope(scope).map((file) => (file.id === id ? update(file) : file)))
}

export function setFileAnalysisResult(scope: LedgerScope, id: string, hash: string, analysis: FileAnalysis, reviews: Map<string, BlockReview>) {
  updateFile(scope, id, (file) => {
    if (file.hash !== hash) return file
    const now = Date.now()
    return {
      ...file,
      analysis,
      blocks: file.blocks.map((block) => ({ ...block, review: reviews.get(block.id) ?? block.review, updatedAt: now })),
      updatedAt: now,
    }
  })
}

function updateBlock(scope: LedgerScope, fileID: string, blockID: string, update: (block: LedgerBlock) => LedgerBlock) {
  updateFile(scope, fileID, (file) => ({
    ...file,
    blocks: file.blocks.map((block) => (block.id === blockID ? update(block) : block)),
    updatedAt: Date.now(),
  }))
}

export function currentFile(scope: LedgerScope, id: string) {
  return readFilesForScope(scope).find((file) => file.id === id)
}

export function setBlockResolved(scope: LedgerScope, fileID: string, blockID: string, resolved: boolean) {
  updateBlock(scope, fileID, blockID, (block) => ({ ...block, resolved, updatedAt: Date.now() }))
}

export function setBlockComment(scope: LedgerScope, fileID: string, blockID: string, comment: string | undefined) {
  updateBlock(scope, fileID, blockID, (block) => ({ ...block, comment, updatedAt: Date.now() }))
}

export function setFileResolved(scope: LedgerScope, fileID: string, resolved: boolean) {
  updateFile(scope, fileID, (file) => ({ ...file, blocks: file.blocks.map((block) => ({ ...block, resolved, updatedAt: Date.now() })), updatedAt: Date.now() }))
}
