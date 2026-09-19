import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { test, type TestContext } from "node:test"
import { promisify } from "node:util"
import { reconcileWorkspaceDiff, resolveBranchScope } from "../src/git.ts"
import { ledgerScopeForDirectory, readFilesForScope, setBlockComment, setBlockResolved, writeFilesForScope } from "../src/storage.ts"

const execute = promisify(execFile)
const noSDK = {
  get client() {
    return assert.fail("Branch comparisons must never call the SDK's uncommitted diff APIs")
  },
} as unknown as TuiPluginApi

async function git(directory: string, ...args: string[]) {
  const { stdout } = await execute("git", [
    "-c", "user.name=Ledger Test", "-c", "user.email=ledger@example.test",
    "-c", "commit.gpgSign=false", "-c", "core.hooksPath=/dev/null", ...args,
  ], {
    cwd: directory,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  })
  return stdout.trimEnd()
}

async function temporaryDirectory(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "ledger-git-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function put(directory: string, path: string, content: string | Uint8Array) {
  await mkdir(dirname(join(directory, path)), { recursive: true })
  await writeFile(join(directory, path), content)
}

async function commit(directory: string, message = "fixture change") {
  await git(directory, "add", "--all")
  await git(directory, "commit", "-m", message)
  return git(directory, "rev-parse", "HEAD")
}

async function repository(t: TestContext, files: Record<string, string | Uint8Array> = { "shared.txt": "base\n" }) {
  const directory = await temporaryDirectory(t)
  await git(directory, "init", "--initial-branch=main", "--template=")
  await put(directory, ".gitignore", ".opencode/\n")
  for (const [path, content] of Object.entries(files)) await put(directory, path, content)
  await commit(directory, "base")
  return directory
}

test("branch diffs exclude main-only commits and every kind of dirty worktree change", async (t) => {
  const directory = await repository(t, {
    "shared.txt": "base\n",
    "local-delete.txt": "old local-delete\n",
    "removed.txt": "remove this\n",
    "staged-only.txt": "unchanged in branch\n",
  })
  const mergeBase = await git(directory, "rev-parse", "HEAD")
  await git(directory, "checkout", "-b", "feature")
  await put(directory, "shared.txt", "committed feature\n")
  await put(directory, "local-delete.txt", "committed but deleted locally\n")
  await put(directory, "nested/added.txt", "committed addition\n")
  await rm(join(directory, "removed.txt"))
  const head = await commit(directory)

  await git(directory, "checkout", "main")
  await put(directory, "shared.txt", "main-only conflicting change\n")
  await put(directory, "main-only.txt", "not a feature change\n")
  const base = await commit(directory)
  await git(directory, "checkout", "feature")
  await put(directory, "shared.txt", "staged feature edit\n")
  await put(directory, "staged-only.txt", "staged-only edit\n")
  await git(directory, "add", "shared.txt", "staged-only.txt")
  await put(directory, "shared.txt", "unstaged feature edit\n")
  await put(directory, "untracked.txt", "untracked addition\n")
  await put(directory, "removed.txt", "locally resurrected deletion\n")
  await rm(join(directory, "local-delete.txt"))

  const scope = await resolveBranchScope(join(directory, "nested"))
  assert.equal(scope.directory, directory)
  assert.equal(scope.mode, "branch")
  assert.deepEqual(scope.comparison, { name: "feature", baseRef: "main", head, base, mergeBase })
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const files = new Map(readFilesForScope(scope).map((file) => [file.path, file]))
  assert.deepEqual([...files.keys()].sort(), ["local-delete.txt", "nested/added.txt", "removed.txt", "shared.txt"])
  assert.equal(files.get("shared.txt")?.content, "committed feature\n")
  assert.match(files.get("shared.txt")!.patch, /-base\n\+committed feature/)
  assert.doesNotMatch(files.get("shared.txt")!.patch, /main-only|staged|unstaged/)
  assert.equal(files.get("local-delete.txt")?.content, "committed but deleted locally\n")
  assert.equal(files.get("nested/added.txt")?.content, "committed addition\n")
  assert.equal(files.get("nested/added.txt")?.status, "added")
  assert.equal(files.get("removed.txt")?.status, "deleted")
  assert.equal(files.get("removed.txt")?.content, "")
  assert.equal(files.get("shared.txt")?.additions, 1)
  assert.equal(files.get("shared.txt")?.deletions, 1)
})

test("an empty branch comparison clears old files without SDK fallback", async (t) => {
  const directory = await repository(t, { "shared.txt": "base\n", "empty.txt": "" })
  await git(directory, "checkout", "-b", "feature")
  await put(directory, "shared.txt", "feature\n")
  await rm(join(directory, "empty.txt"))
  await commit(directory)
  const previous = await resolveBranchScope(directory)
  await reconcileWorkspaceDiff(noSDK, previous)
  assert.equal(readFilesForScope(previous).length, 2)
  const deleted = readFilesForScope(previous).find((file) => file.path === "empty.txt")!
  assert.equal(deleted.status, "deleted")
  assert.equal(deleted.content, "")

  await git(directory, "revert", "--no-edit", "HEAD")
  await put(directory, "shared.txt", "staged but not committed\n")
  await git(directory, "add", "shared.txt")
  await put(directory, "untracked.txt", "untracked\n")
  const scope = await resolveBranchScope(directory)
  assert.equal(scope.id, previous.id)
  assert.notEqual(scope.comparison?.head, previous.comparison?.head)
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  assert.deepEqual(readFilesForScope(scope), [])
})

test("base resolution ignores tags, falls back to origin/main, and prefers local main", async (t) => {
  const directory = await repository(t)
  const ancestor = await git(directory, "rev-parse", "HEAD")
  await git(directory, "checkout", "-b", "feature")
  await put(directory, "shared.txt", "feature\n")
  const head = await commit(directory)
  await git(directory, "branch", "-D", "main")
  await git(directory, "tag", "main", head)
  await git(directory, "tag", "origin/main", head)
  await assert.rejects(resolveBranchScope(directory), /requires main or origin\/main.*[Cc]reate.*fetch.*No fetch was attempted/)

  await git(directory, "update-ref", "refs/remotes/origin/main", ancestor)
  const remote = await resolveBranchScope(directory)
  assert.equal(remote.comparison?.baseRef, "origin/main")
  assert.equal(remote.comparison?.base, ancestor)
  assert.equal(remote.comparison?.mergeBase, ancestor)
  await reconcileWorkspaceDiff(noSDK, remote)
  assert.equal(readFilesForScope(remote)[0]?.content, "feature\n")

  await git(directory, "branch", "main", head)
  const local = await resolveBranchScope(directory)
  assert.equal(local.comparison?.baseRef, "main")
  assert.equal(local.comparison?.base, head)
  assert.notEqual(local.id, remote.id)
  await reconcileWorkspaceDiff(noSDK, local)
  assert.deepEqual(readFilesForScope(local), [])
})

test("resolution reports actionable non-repository, unborn HEAD, and unrelated-history errors", async (t) => {
  const empty = await temporaryDirectory(t)
  await assert.rejects(resolveBranchScope(empty), /Git working tree/)
  await git(empty, "init", "--initial-branch=main", "--template=")
  await assert.rejects(resolveBranchScope(empty), /Commit on this branch/)

  const directory = await repository(t)
  await git(directory, "checkout", "--orphan", "unrelated")
  await git(directory, "commit", "--allow-empty", "-m", "unrelated root")
  await assert.rejects(resolveBranchScope(directory), /no common ancestor.*shares history/)
})

test("a resolved snapshot stays exact after HEAD, main, and the checked-out branch change", async (t) => {
  const directory = await repository(t, { "shared.txt": "base\n", ".gitattributes": "*.txt diff\n" })
  await git(directory, "checkout", "-b", "feature")
  await put(directory, "shared.txt", "snapshot content\n")
  await commit(directory)
  const scope = await resolveBranchScope(directory)
  const comparison = { ...scope.comparison }

  await put(directory, "shared.txt", "later feature content\n")
  await put(directory, "future.txt", "not in snapshot\n")
  await commit(directory)
  await git(directory, "checkout", "main")
  await put(directory, "shared.txt", "later main content\n")
  await put(directory, ".gitattributes", "*.txt -diff\n")
  await commit(directory)
  await put(directory, "shared.txt", "dirty current checkout\n")

  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const files = readFilesForScope(scope)
  assert.deepEqual(scope.comparison, comparison)
  assert.equal(files.length, 1)
  assert.equal(files[0].content, "snapshot content\n")
  assert.match(files[0].patch, /-base\n\+snapshot content/)
  assert.doesNotMatch(files[0].patch, /later|dirty|future/)
})

test("unchanged hunk reviews survive new commits and hunk positions, but stay isolated by mode and branch", async (t) => {
  const lines = Array.from({ length: 65 }, (_, index) => `line ${index + 1}`)
  const directory = await repository(t, { "shared.txt": `${lines.join("\n")}\n` })
  await git(directory, "checkout", "-b", "feature")
  lines[25] = "first reviewed change"
  lines[50] = "second reviewed change"
  await put(directory, "shared.txt", `${lines.join("\n")}\n`)
  await commit(directory)
  const original = await resolveBranchScope(directory)
  await reconcileWorkspaceDiff(noSDK, original)
  const file = readFilesForScope(original)[0]
  assert.equal(file.blocks.length, 2)
  for (const block of file.blocks) {
    setBlockResolved(original, file.id, block.id, true)
    setBlockComment(original, file.id, block.id, `reviewed ${block.hash}`)
  }
  const reviewed = readFilesForScope(original)
  for (const block of reviewed[0].blocks) {
    block.review = { hash: block.hash, generatedAt: Date.now(), explanations: [{ diffStartLine: block.diffStartLine, diffEndLine: block.diffEndLine, explanation: "Keep this review" }] }
  }
  writeFilesForScope(original, reviewed)

  await put(directory, "z-unrelated.txt", "new file after shared.txt in patch order\n")
  await commit(directory)
  const sameHunks = await resolveBranchScope(directory)
  assert.equal(sameHunks.id, original.id)
  await reconcileWorkspaceDiff(noSDK, sameHunks)
  assert.deepEqual(readFilesForScope(sameHunks).find((current) => current.id === file.id)?.blocks, reviewed[0].blocks)

  lines[1] = "new unreviewed hunk before the reviewed hunks"
  await put(directory, "shared.txt", `${lines.join("\n")}\n`)
  await commit(directory)
  const advanced = await resolveBranchScope(directory)
  assert.equal(advanced.id, original.id)
  assert.notEqual(advanced.comparison?.head, original.comparison?.head)
  await reconcileWorkspaceDiff(noSDK, advanced)
  const updated = readFilesForScope(advanced).find((current) => current.id === file.id)!
  assert.equal(updated.blocks.length, 3)
  assert.equal(updated.blocks[0].resolved, false)
  assert.equal(updated.blocks[0].comment, undefined)
  for (const previous of reviewed[0].blocks) {
    const block = updated.blocks.find((current) => current.hash === previous.hash)!
    assert.ok(block)
    assert.notEqual(block.id, previous.id)
    assert.equal(block.resolved, true)
    assert.equal(block.comment, previous.comment)
    const offset = block.diffStartLine - previous.diffStartLine
    assert.ok(offset > 0)
    assert.equal(block.review?.hash, previous.review?.hash)
    assert.equal(block.review?.generatedAt, previous.review?.generatedAt)
    assert.deepEqual(block.review?.explanations, previous.review!.explanations.map((explanation) => ({
      ...explanation,
      diffStartLine: explanation.diffStartLine + offset,
      diffEndLine: explanation.diffEndLine + offset,
    })))
  }

  const worktree = ledgerScopeForDirectory(directory, "worktree")
  const api = { client: { vcs: { diff2: { raw: async () => ({ data: updated.patch }) }, diff: async () => assert.fail("Unexpected worktree fallback") } } } as unknown as TuiPluginApi
  assert.notEqual(worktree.id, advanced.id)
  await reconcileWorkspaceDiff(api, worktree)
  assert.ok(readFilesForScope(worktree)[0].blocks.every((block) => !block.resolved && !block.comment && !block.review))

  await git(directory, "checkout", "-b", "another-feature")
  const other = await resolveBranchScope(directory)
  assert.notEqual(other.id, advanced.id)
  await reconcileWorkspaceDiff(noSDK, other)
  assert.ok(readFilesForScope(other).every((current) => current.blocks.every((block) => !block.resolved && !block.comment && !block.review)))
  await git(directory, "checkout", "feature")
  const returned = await resolveBranchScope(directory)
  assert.equal(returned.id, advanced.id)
  await reconcileWorkspaceDiff(noSDK, returned)
  assert.deepEqual(readFilesForScope(returned).find((current) => current.id === file.id)?.blocks, updated.blocks)
})

test("analyzed files refresh hunk positions when only hunk headers change", async (t) => {
  const directory = await repository(t)
  const scope = ledgerScopeForDirectory(directory)
  let patch = [
    "diff --git a/shared.txt b/shared.txt", "--- a/shared.txt", "+++ b/shared.txt",
    "@@ -10,3 +10,3 @@", " before", "-old", "+new", " after",
  ].join("\n")
  const api = { client: { vcs: { diff2: { raw: async () => ({ data: patch }) }, diff: async () => assert.fail("Unexpected worktree fallback") } } } as unknown as TuiPluginApi
  await reconcileWorkspaceDiff(api, scope)
  const file = readFilesForScope(scope)[0]
  const block = file.blocks[0]
  const generatedAt = Date.now()
  file.analysis = { hash: file.hash, impact: "low", generatedAt }
  block.resolved = true
  block.comment = "Keep this approval and comment"
  block.review = {
    hash: block.hash,
    generatedAt,
    explanations: [{ diffStartLine: 5, diffEndLine: 6, explanation: "Keep the changed-line explanation" }],
  }
  writeFilesForScope(scope, [file])

  patch = patch.replace("@@ -10,3 +10,3 @@", "@@ -30,3 +40,3 @@")
  await reconcileWorkspaceDiff(api, scope)
  const updated = readFilesForScope(scope)[0]
  const moved = updated.blocks[0]
  assert.equal(updated.hash, file.hash)
  assert.deepEqual(updated.analysis, file.analysis)
  assert.equal(updated.updatedAt, file.updatedAt)
  assert.equal(moved.hash, block.hash)
  assert.notEqual(moved.patch, block.patch)
  assert.match(moved.patch, /^@@ -30,3 \+40,3 @@/)
  assert.equal(moved.oldStart, 31)
  assert.equal(moved.oldEnd, 31)
  assert.equal(moved.newStart, 41)
  assert.equal(moved.newEnd, 41)
  assert.equal(moved.diffStartLine, block.diffStartLine)
  assert.equal(moved.diffEndLine, block.diffEndLine)
  assert.equal(moved.resolved, true)
  assert.equal(moved.comment, block.comment)
  assert.equal(moved.updatedAt, block.updatedAt)
  assert.deepEqual(moved.review, block.review)
})

test("detached HEAD scopes include the exact hash and are isolated from named branches and each other", async (t) => {
  const directory = await repository(t)
  await git(directory, "checkout", "-b", "feature")
  await put(directory, "shared.txt", "first\n")
  const first = await commit(directory)
  const named = await resolveBranchScope(directory)
  await put(directory, "shared.txt", "second\n")
  const second = await commit(directory)

  await git(directory, "checkout", "--detach", first)
  const detached = await resolveBranchScope(directory)
  assert.ok(detached.comparison?.name.includes(first))
  assert.equal(detached.comparison?.head, first)
  assert.notEqual(detached.id, named.id)
  await reconcileWorkspaceDiff(noSDK, detached)
  assert.equal(readFilesForScope(detached)[0].content, "first\n")
  await git(directory, "checkout", "--detach", second)
  const next = await resolveBranchScope(directory)
  assert.ok(next.comparison?.name.includes(second))
  assert.notEqual(next.id, detached.id)
  assert.equal((await resolveBranchScope(directory)).id, next.id)
})

test("shouldApply prevents writes both immediately and when a pending branch refresh becomes stale", async (t) => {
  const directory = await repository(t)
  await git(directory, "checkout", "-b", "feature")
  await put(directory, "shared.txt", "feature\n")
  await commit(directory)
  const scope = await resolveBranchScope(directory)
  const statePath = join(directory, ".opencode/ledger/state.json")
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope, () => false), false)
  assert.equal(existsSync(statePath), false)
  await reconcileWorkspaceDiff(noSDK, scope)
  const before = await readFile(statePath, "utf8")

  await put(directory, "shared.txt", "new feature\n")
  await commit(directory)
  const next = await resolveBranchScope(directory)
  let active = true
  let checked = false
  const pending = reconcileWorkspaceDiff(noSDK, next, () => {
    checked = true
    return active
  })
  assert.equal(checked, false)
  active = false
  assert.equal(await pending, false)
  assert.equal(checked, true)
  assert.equal(await readFile(statePath, "utf8"), before)
})

test("literal filenames, rename-only, empty, binary, symlink, and gitlink changes coexist under hostile diff config", async (t) => {
  const oldName = 'old "quoted" \u96ea name.txt'
  const newName = 'renamed "quoted" \u96ea name.txt'
  const binaryName = 'binary "\u96ea" file.bin'
  const directory = await repository(t, {
    [oldName]: "rename-only unique content\n",
    [binaryName]: Buffer.from([0, 1, 2, 3]),
    "delete with spaces.txt": "delete me\n",
    "target.txt": "unchanged target\n",
    ".gitattributes": "*.txt diff=hostile\n",
  })
  await symlink("target.txt", join(directory, "type change.txt"))
  await commit(directory, "base symlink")
  await git(directory, "checkout", "-b", "feature")
  await rename(join(directory, oldName), join(directory, newName))
  await put(directory, binaryName, Buffer.from([0, 4, 5, 6]))
  await rm(join(directory, "delete with spaces.txt"))
  await rm(join(directory, "type change.txt"))
  await put(directory, "type change.txt", "now a regular file\n")
  await put(directory, "new empty.txt", "")
  const names = ["with spaces.txt", 'quote " and apostrophe\'.txt', "\u96ea/caf\u00e9.txt", "tab\tand\nnewline.txt", "back\\slash.txt", " leading and trailing "]
  for (const [index, name] of names.entries()) await put(directory, name, `committed literal file ${index}\n`)
  await git(directory, "add", "--all")
  const gitlink = "vendor/sub module"
  await git(directory, "update-index", "--add", "--cacheinfo", "160000", "1234567890123456789012345678901234567890", gitlink)
  await git(directory, "commit", "-m", "varied file changes")
  for (const [key, value] of Object.entries({
    "diff.mnemonicPrefix": "true", "diff.noprefix": "true", "diff.relative": "true",
    "diff.srcPrefix": "old/", "diff.dstPrefix": "new/", "color.ui": "always",
    "diff.external": "false", "diff.hostile.command": "false", "diff.hostile.textconv": "false",
    "diff.renames": "false", "diff.submodule": "log", "diff.ignoreSubmodules": "all",
    "diff.algorithm": "histogram", "diff.context": "0", "diff.interHunkContext": "99",
  })) await git(directory, "config", key, value)

  const scope = await resolveBranchScope(directory)
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const files = new Map(readFilesForScope(scope).map((file) => [file.path, file]))
  assert.deepEqual([...files.keys()].sort(), [...names, newName, binaryName, "delete with spaces.txt", "new empty.txt", "type change.txt", gitlink].sort())
  for (const [index, name] of names.entries()) assert.equal(files.get(name)?.content, `committed literal file ${index}\n`)
  assert.equal(files.get(newName)?.content, "rename-only unique content\n")
  assert.equal(files.get(newName)?.status, "modified")
  assert.equal(files.get(newName)?.additions, 0)
  assert.equal(files.get(newName)?.deletions, 0)
  assert.match(files.get(newName)!.patch, /similarity index 100%/)
  assert.equal(files.get(newName)?.blocks.length, 1)
  assert.equal(files.get("new empty.txt")?.status, "added")
  assert.equal(files.get("new empty.txt")?.content, "")
  assert.equal(files.get("delete with spaces.txt")?.content, "")
  assert.match(files.get(binaryName)!.patch, /Binary files/)
  assert.equal(files.get(binaryName)?.content, "")
  assert.equal(files.get(gitlink)?.content, "")
  assert.match(files.get(gitlink)!.patch, /Subproject commit 1234567890/)
  assert.equal(files.get("type change.txt")?.content, "now a regular file\n")
  assert.equal(files.get("type change.txt")?.status, "modified")
  assert.equal(files.get("type change.txt")?.additions, 1)
  assert.equal(files.get("type change.txt")?.deletions, 1)
  assert.equal(files.get("type change.txt")?.blocks.length, 2)
  for (const file of files.values()) assert.doesNotMatch(file.patch, /\u001b\[/)
  assert.match(files.get("with spaces.txt")!.patch, /^diff --git a\/with spaces.txt b\/with spaces.txt/)
})

test("worktree mode retains raw SDK diffs, structured fallback, and workspace file content", async (t) => {
  const directory = await repository(t)
  await put(directory, "shared.txt", "local workspace content\n")
  const scope = ledgerScopeForDirectory(directory)
  assert.equal(scope.mode, "worktree")
  const patch = await git(directory, "diff", "--no-ext-diff", "--no-textconv", "--no-color")
  let rawCalls = 0
  let fallbackCalls = 0
  let rawData = patch
  const api = { client: { vcs: {
    diff2: { raw: async (input: { directory: string }) => {
      assert.equal(input.directory, directory)
      rawCalls++
      return { data: rawData }
    } },
    diff: async (input: { directory: string; mode: string }) => {
      assert.deepEqual(input, { directory, mode: "git" })
      fallbackCalls++
      return { data: [{ file: "shared.txt", before: "base\n", after: "SDK content, not local\n", additions: 1, deletions: 1, status: "modified" }] }
    },
  } } } as unknown as TuiPluginApi
  assert.equal(await reconcileWorkspaceDiff(api, scope), true)
  assert.equal(rawCalls, 1)
  assert.equal(fallbackCalls, 0)
  assert.equal(readFilesForScope(scope)[0].content, "local workspace content\n")
  assert.match(readFilesForScope(scope)[0].patch, /\+local workspace content/)

  rawData = ""
  assert.equal(await reconcileWorkspaceDiff(api, scope), true)
  assert.equal(rawCalls, 2)
  assert.equal(fallbackCalls, 1)
  assert.equal(readFilesForScope(scope)[0].content, "local workspace content\n")
  assert.match(readFilesForScope(scope)[0].patch, /\+SDK content, not local/)
})

test("a pending worktree fallback still checks shouldApply before storage writes", async (t) => {
  const directory = await repository(t)
  const scope = ledgerScopeForDirectory(directory)
  const result = Promise.withResolvers<{ data: { file: string; patch: string }[] }>()
  const started = Promise.withResolvers<void>()
  const api = { client: { vcs: {
    diff2: { raw: async () => ({ data: "" }) },
    diff: () => { started.resolve(); return result.promise },
  } } } as unknown as TuiPluginApi
  let active = true
  const pending = reconcileWorkspaceDiff(api, scope, () => active)
  await started.promise
  active = false
  result.resolve({ data: [{ file: "shared.txt", patch: "--- a/shared.txt\n+++ b/shared.txt\n@@ -1 +1 @@\n-base\n+stale\n" }] })
  assert.equal(await pending, false)
  assert.equal(existsSync(join(directory, ".opencode/ledger/state.json")), false)
})
