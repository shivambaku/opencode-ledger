import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { readFilesForScope, writeFilesForScope } from "./storage"
import type { FileDiff, FileStatus, LedgerBlock, LedgerFile, LedgerScope, ParsedBlock } from "./types"
import { isRecord, normalizePath, patchHash, readWorkspaceFile, unifiedDiff } from "./utils"

export function parseHunk(line: string) {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
  if (!match) return undefined
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? 1),
  }
}

function advanceDiffLine(line: string, counters: { oldLine: number; newLine: number }) {
  if (line.startsWith("+")) counters.newLine++
  else if (line.startsWith("-")) counters.oldLine++
  else if (line.startsWith(" ")) {
    counters.oldLine++
    counters.newLine++
  }
}

function parseBlocks(diff: string): ParsedBlock[] {
  const lines = diff.split("\n")
  const blocks: ParsedBlock[] = []
  let current: (Omit<ParsedBlock, "patch"> & { lines: string[]; oldLine: number; newLine: number }) | undefined

  function finishBlock() {
    if (!current) return
    if (current.additions || current.deletions) {
      const oldStart = current.oldStart || current.oldLine
      const oldEnd = current.oldEnd || oldStart
      const newStart = current.newStart || current.newLine
      const newEnd = current.newEnd || newStart
      blocks.push({ id: `b${blocks.length + 1}`, patch: current.lines.join("\n"), diffStartLine: current.diffStartLine, diffEndLine: current.diffEndLine, oldStart, oldEnd, newStart, newEnd, additions: current.additions, deletions: current.deletions })
    }
    current = undefined
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const nextHunk = parseHunk(line)
    if (nextHunk) {
      finishBlock()
      current = { id: `b${blocks.length + 1}`, lines: [line], diffStartLine: index, diffEndLine: index, oldStart: 0, oldEnd: 0, newStart: 0, newEnd: 0, additions: 0, deletions: 0, oldLine: nextHunk.oldStart, newLine: nextHunk.newStart }
      continue
    }

    if (!current) continue

    current.lines.push(line)
    current.diffEndLine = index
    if (line.startsWith("+")) {
      current.newStart ||= current.newLine
      current.newEnd = current.newLine
      current.additions++
    } else if (line.startsWith("-")) {
      current.oldStart ||= current.oldLine
      current.oldEnd = current.oldLine
      current.deletions++
    }
    advanceDiffLine(line, current)
  }

  finishBlock()

  if (blocks.length) return blocks
  return [
    {
      id: "b1",
      patch: diff,
      diffStartLine: 0,
      diffEndLine: Math.max(0, lines.length - 1),
      oldStart: 1,
      oldEnd: 1,
      newStart: 1,
      newEnd: 1,
      additions: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++ ")).length,
      deletions: lines.filter((line) => line.startsWith("-") && !line.startsWith("--- ")).length,
    },
  ]
}

function gitPatchPath(value: string) {
  const path = value.trim().replace(/^"(.*)"$/, "$1")
  if (!path || path === "/dev/null") return ""
  return normalizePath(path.replace(/^[ab]\//, ""))
}

function fileDiffsFromRawPatch(raw: string): FileDiff[] {
  const sections: string[][] = []
  let current: string[] | undefined

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current?.length) sections.push(current)
      current = [line]
    } else if (current) current.push(line)
  }
  if (current?.length) sections.push(current)

  const diffs: FileDiff[] = []
  for (const lines of sections) {
    let oldPath = ""
    let newPath = ""
    let status: string | undefined
    for (const line of lines) {
      if (line.startsWith("--- ")) oldPath = gitPatchPath(line.slice(4))
      else if (line.startsWith("+++ ")) newPath = gitPatchPath(line.slice(4))
      else if (line.startsWith("new file mode")) status = "added"
      else if (line.startsWith("deleted file mode")) status = "deleted"
    }

    const path = newPath || oldPath
    if (!path) continue
    diffs.push({
      file: path,
      patch: lines.join("\n"),
      additions: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++ ")).length,
      deletions: lines.filter((line) => line.startsWith("-") && !line.startsWith("--- ")).length,
      status: status ?? (oldPath ? "modified" : "added"),
    })
  }

  return diffs
}

function existingBlockIndex(existing: LedgerFile | undefined) {
  return {
    byID: new Map(existing?.blocks.map((block) => [block.id, block]) ?? []),
    byHash: new Map(existing?.blocks.map((block) => [block.hash, block]) ?? []),
  }
}

function blockFromParsed(fileID: string, path: string, block: ParsedBlock, index: number, existing: ReturnType<typeof existingBlockIndex>): LedgerBlock {
  const id = `${fileID}:${block.id ?? `b${index + 1}`}`
  const hash = patchHash(path, block.patch)
  const previous = existing.byID.get(id) ?? existing.byHash.get(hash)
  const unchanged = previous?.hash === hash
  const now = Date.now()

  return {
    id,
    fileID,
    patch: block.patch,
    hash,
    diffStartLine: block.diffStartLine,
    diffEndLine: block.diffEndLine,
    oldStart: block.oldStart,
    oldEnd: block.oldEnd,
    newStart: block.newStart,
    newEnd: block.newEnd,
    additions: block.additions,
    deletions: block.deletions,
    resolved: unchanged ? (previous?.resolved ?? false) : false,
    comment: unchanged ? previous?.comment : undefined,
    updatedAt: unchanged ? (previous?.updatedAt ?? now) : now,
    review: unchanged ? previous?.review : undefined,
  }
}

function filePatch(input: FileDiff, path: string, additions: number, deletions: number) {
  if (typeof input.patch === "string" && input.patch.trim()) return input.patch
  const fallback = `${input.status ?? "modified"} ${path}\n+${additions} additions, ${deletions} deletions`
  return unifiedDiff(path, input.before, input.after, fallback)
}

function fileStatus(value: string | undefined): FileStatus {
  if (value === "added" || value === "deleted") return value
  return "modified"
}

function fileFromDiff(input: FileDiff, existing: LedgerFile | undefined, directory: string): LedgerFile | undefined {
  const path = normalizePath(input.file ?? input.path ?? "")
  if (!path) return undefined

  const content = readWorkspaceFile(directory, path)
  const additions = Math.max(0, input.additions ?? 0)
  const deletions = Math.max(0, input.deletions ?? 0)
  const status = fileStatus(input.status)
  const patch = filePatch(input, path, additions, deletions)
  const id = path
  const hash = patchHash(path, patch)

  if (existing?.hash === hash && existing.analysis?.hash === hash && existing.blocks.length) {
    return { ...existing, content, patch, status, additions, deletions }
  }

  const existingBlocks = existingBlockIndex(existing)
  const blocks = parseBlocks(patch).map((block, index) => blockFromParsed(id, path, block, index, existingBlocks))

  return {
    id,
    path,
    content,
    patch,
    hash,
    status,
    additions,
    deletions,
    updatedAt: existing?.hash === hash ? (existing.updatedAt ?? Date.now()) : Date.now(),
    analysis: existing?.hash === hash ? existing.analysis : undefined,
    blocks,
  }
}

async function replaceWorkspaceDiffs(scope: LedgerScope, diffs: unknown[]) {
  const previous = readFilesForScope(scope)
  const filesByID = new Map(previous.map((file) => [file.id, file]))
  const currentIDs = new Set<string>()

  for (const diff of diffs) {
    if (!isRecord(diff)) continue
    const path = normalizePath(String(diff.file ?? diff.path ?? ""))
    const file = fileFromDiff(diff as FileDiff, filesByID.get(path), scope.directory)
    if (file) {
      filesByID.set(file.id, file)
      currentIDs.add(file.id)
    }
  }

  writeFilesForScope(scope, [...filesByID.values()].filter((file) => currentIDs.has(file.id)))
}

export async function reconcileWorkspaceDiff(api: TuiPluginApi, scope: LedgerScope, shouldApply?: () => boolean) {
  const raw = await api.client.vcs.diff2.raw({ directory: scope.directory })
  if (shouldApply && !shouldApply()) return false
  if (!raw.error && typeof raw.data === "string") {
    await replaceWorkspaceDiffs(scope, fileDiffsFromRawPatch(raw.data))
    return true
  }

  const result = await api.client.vcs.diff({ directory: scope.directory, mode: "git" })
  if (result.error || !result.data) throw new Error("Failed to refresh Git diff for Ledger.")
  if (shouldApply && !shouldApply()) return false
  await replaceWorkspaceDiffs(scope, result.data)
  return true
}
