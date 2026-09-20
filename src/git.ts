import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { execFile } from "node:child_process"
import { copyFile, lstat, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureLedgerIgnored, ledgerScopeForDirectory, readFilesForScope, writeFilesForScope } from "./storage"
import type { BranchComparison, FileDiff, FileStatus, LedgerBlock, LedgerFile, LedgerScope, ParsedBlock } from "./types"
import { isRecord, normalizePath, patchHash, readWorkspaceFile, unifiedDiff } from "./utils"

function runGit(directory: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", ["--no-pager", "--no-replace-objects", "-c", "core.quotePath=true", "-c", "diff.renames=true", ...args], {
      cwd: directory,
      encoding: "buffer",
      timeout: 30_000,
      maxBuffer: 128 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_OPTIONAL_LOCKS: "0", GIT_DIFF_OPTS: "", ...env },
    }, (error, stdout) => error ? reject(error) : resolve(stdout))
    child.stdin?.on("error", reject)
    child.stdin?.end(input)
  })
}

export async function resolveBranchScope(directory: string): Promise<LedgerScope> {
  let root: string
  try {
    root = (await runGit(directory, ["rev-parse", "--show-toplevel"])).toString("utf8").replace(/\r?\n$/, "")
  } catch (cause) {
    throw new Error("Cannot compare branches here. Open Ledger in a Git working tree.", { cause })
  }

  let ref: string | undefined
  try {
    ref = (await runGit(root, ["symbolic-ref", "--quiet", "HEAD"])).toString("utf8").trim()
  } catch (error) {
    if (!isRecord(error) || error.code !== 1) throw error
  }

  let head: string
  try {
    head = (await runGit(root, ["rev-parse", "--verify", `${ref ?? "HEAD"}^{commit}`])).toString("utf8").trim()
  } catch (cause) {
    throw new Error("Cannot resolve the current Git commit. Commit on this branch before comparing it in Ledger.", { cause })
  }

  let baseRef: BranchComparison["baseRef"] = "main"
  let base: string
  try {
    base = (await runGit(root, ["rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"])).toString("utf8").trim()
  } catch (error) {
    if (!isRecord(error) || error.code !== 1) throw error
    baseRef = "origin/main"
    try {
      base = (await runGit(root, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main^{commit}"])).toString("utf8").trim()
    } catch (cause) {
      if (!isRecord(cause) || cause.code !== 1) throw cause
      throw new Error("Branch comparison requires main or origin/main. Create a local main branch or fetch origin/main, then refresh Ledger. No fetch was attempted.", { cause })
    }
  }

  let mergeBase: string
  try {
    mergeBase = (await runGit(root, ["merge-base", base, head])).toString("utf8").trim()
  } catch (cause) {
    if (!isRecord(cause) || cause.code !== 1) throw cause
    throw new Error(`The current branch and ${baseRef} have no common ancestor. Compare a branch that shares history with ${baseRef}.`, { cause })
  }

  const name = ref ? ref.replace(/^refs\/heads\//, "") : `HEAD (${head})`
  return ledgerScopeForDirectory(root, "branch", { name, baseRef, head, base, mergeBase })
}

async function branchDiffs(scope: LedgerScope): Promise<FileDiff[]> {
  if (!scope.comparison) throw new Error("The branch comparison is missing. Refresh Ledger to resolve it again.")
  const { mergeBase, head } = scope.comparison
  ensureLedgerIgnored(scope)
  const temporary = await mkdtemp(join(tmpdir(), "ledger-index-"))
  let tree: string
  try {
    const index = join(temporary, "index")
    const env = { GIT_INDEX_FILE: index }
    const source = (await runGit(scope.directory, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).toString("utf8").replace(/\r?\n$/, "")
    try {
      await copyFile(source, index)
    } catch (error) {
      if (!isRecord(error) || error.code !== "ENOENT") throw error
      await runGit(scope.directory, ["read-tree", head], undefined, env)
    }
    const flags = (await runGit(scope.directory, ["ls-files", "-v", "-z"], undefined, env)).toString("utf8").split("\0").filter(Boolean)
    const assumed = flags.filter((entry) => /^[a-z]/.test(entry)).map((entry) => entry.slice(2))
    if (assumed.length) await runGit(scope.directory, ["update-index", "--no-assume-unchanged", "-z", "--stdin"], `${assumed.join("\0")}\0`, env)
    const materialized: string[] = []
    for (const entry of flags.filter((entry) => /^[Ss] /.test(entry))) {
      const path = entry.slice(2)
      try {
        await lstat(join(scope.directory, path))
        materialized.push(path)
      } catch (error) {
        if (!isRecord(error) || error.code !== "ENOENT") throw error
      }
    }
    // Reread materialized skip-worktree files without treating absent sparse
    // checkout entries as deletions. All flag changes stay in the private index.
    if (materialized.length) await runGit(scope.directory, ["update-index", "--no-skip-worktree", "-z", "--stdin"], `${materialized.join("\0")}\0`, env)
    // Stage only into a private index: capture the net working state, including
    // untracked files, while preserving the user's real staging area.
    await runGit(scope.directory, ["-c", "core.splitIndex=false", "-c", "core.fsmonitor=false", "add", "--all", "--sparse", "--", "."], undefined, env)
    tree = (await runGit(scope.directory, ["write-tree"], undefined, env)).toString("utf8").trim()
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  // Read both diff attributes and file context from the captured working state.
  const raw = (await runGit(scope.directory, [
    `--attr-source=${tree}`, "diff", "--raw", "--patch", "-z", "--no-abbrev", "--full-index",
    "--no-ext-diff", "--no-textconv", "--no-color", "--no-relative",
    "--src-prefix=a/", "--dst-prefix=b/", "--line-prefix=",
    "--output-indicator-new=+", "--output-indicator-old=-", "--output-indicator-context= ",
    "--find-renames=50%", "--diff-algorithm=myers", "--no-indent-heuristic",
    "--unified=3", "--inter-hunk-context=0", "--ignore-submodules=none", "--submodule=short",
    mergeBase, tree, "--",
  ])).toString("utf8")
  if (!raw) return []

  // With -z, raw records end at the double NUL before the textual patch.
  // Their literal paths and object IDs avoid parsing Git's quoted patch paths.
  const boundary = raw.indexOf("\0\0")
  if (boundary < 0) throw new Error("Git returned an invalid branch diff. Refresh Ledger to try again.")
  const records = raw.slice(0, boundary).split("\0")
  const entries: FileDiff[] = []
  const objects: (string | undefined)[] = []
  for (let index = 0; index < records.length; index++) {
    const header = records[index].match(/^:\d+ (\d+) [a-f0-9]+ ([a-f0-9]+) ([A-Z])\d*$/)
    if (!header) throw new Error("Git returned an invalid branch diff record.")
    const [, mode, object, status] = header
    let path = records[++index]
    if (status === "R" || status === "C") path = records[++index]
    if (!path) throw new Error("Git returned a branch diff without a file path.")
    entries.push({ file: path, status: status === "A" ? "added" : status === "D" ? "deleted" : "modified" })
    objects.push(status === "D" || mode === "160000" ? undefined : object)
  }

  const diffs = fileDiffsFromRawPatch(raw.slice(boundary + 2), entries)
  const objectIDs = [...new Set(objects.filter((object): object is string => !!object))]
  const contents = new Map<string, string>()
  if (objectIDs.length) {
    // Batch by object ID, not path: this also supports tabs/newlines in filenames
    // and skips gitlinks, whose objects need not exist in the parent repository.
    const batch = await runGit(scope.directory, ["cat-file", "--batch"], `${objectIDs.join("\n")}\n`)
    let offset = 0
    for (const object of objectIDs) {
      const end = batch.indexOf(10, offset)
      const header = batch.subarray(offset, end).toString("ascii").match(/^([a-f0-9]+) blob (\d+)$/)
      if (end < 0 || !header || header[1] !== object) throw new Error(`Cannot read Git snapshot content for ${object}. Ensure the snapshot objects are available locally.`)
      const size = Number(header[2])
      offset = end + 1
      if (!Number.isSafeInteger(size) || offset + size >= batch.length || batch[offset + size] !== 10) throw new Error("Git returned incomplete snapshot file content.")
      const content = batch.subarray(offset, offset + size)
      contents.set(object, content.includes(0) ? "" : content.toString("utf8"))
      offset += size + 1
    }
  }
  return diffs.map((diff, index) => ({ ...diff, after: contents.get(objects[index] ?? "") ?? "" }))
}

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
    if (line.startsWith("diff --git ")) {
      finishBlock()
      continue
    }
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

function gitDiffPaths(line: string) {
  const parts = line.slice("diff --git ".length).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  return {
    oldPath: parts[0] ? gitPatchPath(parts[0]) : "",
    newPath: parts[1] ? gitPatchPath(parts[1]) : "",
  }
}

function fileDiffsFromRawPatch(raw: string, entries?: FileDiff[]): FileDiff[] {
  const sections: string[][] = []
  let current: string[] | undefined

  for (const line of raw.split("\n")) {
    // A type change (for example, a symlink becoming a file) has two patch
    // sections with the same header, but only one raw record.
    if (line.startsWith("diff --git ") && !(entries && current?.[0] === line)) {
      if (current?.length) sections.push(current)
      current = [line]
    } else if (current) current.push(line)
  }
  if (current?.length) sections.push(current)
  if (entries && entries.length !== sections.length) throw new Error("Git branch diff paths and patches do not match.")

  const diffs: FileDiff[] = []
  for (const [index, lines] of sections.entries()) {
    const entry = entries?.[index]
    let oldPath = ""
    let newPath = ""
    let status: string | undefined
    if (!entry) {
      for (const line of lines) {
        if (line.startsWith("diff --git ")) {
          const paths = gitDiffPaths(line)
          oldPath ||= paths.oldPath
          newPath ||= paths.newPath
        } else if (line.startsWith("--- ")) oldPath = gitPatchPath(line.slice(4))
        else if (line.startsWith("+++ ")) newPath = gitPatchPath(line.slice(4))
        else if (line.startsWith("new file mode")) status = "added"
        else if (line.startsWith("deleted file mode")) status = "deleted"
        else if (line.startsWith("rename from ")) oldPath = gitPatchPath(line.slice("rename from ".length))
        else if (line.startsWith("rename to ")) newPath = gitPatchPath(line.slice("rename to ".length))
      }
    }

    const path = entry?.file ?? (status === "deleted" ? oldPath || newPath : newPath || oldPath)
    if (!path) continue
    // The final section alone retains the output's trailing newline. Do not let
    // adding another file change an otherwise identical branch hunk's hash.
    diffs.push({
      file: path,
      patch: entries ? lines.join("\n").replace(/\n$/, "") : lines.join("\n"),
      additions: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++ ")).length,
      deletions: lines.filter((line) => line.startsWith("-") && !line.startsWith("--- ")).length,
      status: entry?.status ?? status ?? (oldPath ? "modified" : "added"),
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
  const byID = existing.byID.get(id)
  const previous = byID?.hash === hash ? byID : existing.byHash.get(hash)
  const unchanged = previous?.hash === hash
  const now = Date.now()
  let review = unchanged ? previous?.review : undefined
  if (review && previous) {
    const offset = block.diffStartLine - previous.diffStartLine
    review = {
      ...review,
      explanations: review.explanations.map((explanation) => ({
        ...explanation,
        diffStartLine: explanation.diffStartLine + offset,
        diffEndLine: explanation.diffEndLine + offset,
      })),
    }
  }

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
    review,
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

function fileFromDiff(input: FileDiff, existing: LedgerFile | undefined, scope: LedgerScope): LedgerFile | undefined {
  const rawPath = input.file ?? input.path ?? ""
  const path = scope.mode === "branch" ? rawPath : normalizePath(rawPath)
  if (!path) return undefined

  const content = scope.mode === "branch" ? (input.after ?? "") : readWorkspaceFile(scope.directory, path)
  const additions = Math.max(0, input.additions ?? 0)
  const deletions = Math.max(0, input.deletions ?? 0)
  const status = fileStatus(input.status)
  const patch = filePatch(input, path, additions, deletions)
  const id = path
  const hash = patchHash(path, patch)

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
    const rawPath = String(diff.file ?? diff.path ?? "")
    const path = scope.mode === "branch" ? rawPath : normalizePath(rawPath)
    const file = fileFromDiff(diff as FileDiff, filesByID.get(path), scope)
    if (file) {
      filesByID.set(file.id, file)
      currentIDs.add(file.id)
    }
  }

  const files = [...filesByID.values()].filter((file) => currentIDs.has(file.id))
  if (JSON.stringify(files) !== JSON.stringify(previous)) writeFilesForScope(scope, files)
}

export async function reconcileWorkspaceDiff(api: TuiPluginApi, scope: LedgerScope, shouldApply?: () => boolean) {
  if (scope.mode === "branch") {
    const diffs = await branchDiffs(scope)
    const current = await resolveBranchScope(scope.directory)
    if (current.id !== scope.id || JSON.stringify(current.comparison) !== JSON.stringify(scope.comparison)) {
      throw new Error("The branch or comparison base changed while capturing local changes. Refresh Ledger to try again.")
    }
    if (shouldApply && !shouldApply()) return false
    await replaceWorkspaceDiffs(scope, diffs)
    return true
  }

  const raw = await api.client.vcs.diff2.raw({ directory: scope.directory })
  if (!raw.error && typeof raw.data === "string") {
    if (shouldApply && !shouldApply()) return false
    const diffs = fileDiffsFromRawPatch(raw.data)
    if (diffs.length) {
      await replaceWorkspaceDiffs(scope, diffs)
      return true
    }
  }
  if (shouldApply && !shouldApply()) return false

  const result = await api.client.vcs.diff({ directory: scope.directory, mode: "git" })
  if (result.error || !result.data) throw new Error("Failed to refresh Git diff for Ledger.")
  if (shouldApply && !shouldApply()) return false
  await replaceWorkspaceDiffs(scope, result.data)
  return true
}
