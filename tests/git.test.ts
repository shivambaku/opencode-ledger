import type { Context as TuiPluginApi } from "@opencode/plugin/tui/context"
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { test, type TestContext } from "node:test"
import { promisify } from "node:util"
import { baseBranchRef, listBaseBranches, reconcileWorkspaceDiff, resolveBranchScope } from "../src/git.ts"
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

test("branch diffs exclude main-only commits and include net staged, unstaged, and untracked changes", async (t) => {
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
  const indexPath = await git(directory, "rev-parse", "--path-format=absolute", "--git-path", "index")
  const indexBefore = await readFile(indexPath)
  const stagedBefore = await git(directory, "diff", "--cached", "--binary")

  const scope = await resolveBranchScope(join(directory, "nested"))
  assert.equal(scope.directory, directory)
  assert.equal(scope.mode, "branch")
  assert.deepEqual(scope.comparison, { name: "feature", baseRef: "main", head, base, mergeBase })
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const files = new Map(readFilesForScope(scope).map((file) => [file.path, file]))
  assert.deepEqual([...files.keys()].sort(), ["local-delete.txt", "nested/added.txt", "removed.txt", "shared.txt", "staged-only.txt", "untracked.txt"])
  assert.equal(files.get("shared.txt")?.content, "unstaged feature edit\n")
  assert.match(files.get("shared.txt")!.patch, /-base\n\+unstaged feature edit/)
  assert.doesNotMatch(files.get("shared.txt")!.patch, /main-only|\+staged feature|committed feature/)
  assert.equal(files.get("local-delete.txt")?.status, "deleted")
  assert.equal(files.get("local-delete.txt")?.content, "")
  assert.match(files.get("local-delete.txt")!.patch, /-old local-delete/)
  assert.equal(files.get("nested/added.txt")?.content, "committed addition\n")
  assert.equal(files.get("nested/added.txt")?.status, "added")
  assert.equal(files.get("removed.txt")?.status, "modified")
  assert.equal(files.get("removed.txt")?.content, "locally resurrected deletion\n")
  assert.match(files.get("removed.txt")!.patch, /-remove this\n\+locally resurrected deletion/)
  assert.equal(files.get("staged-only.txt")?.content, "staged-only edit\n")
  assert.equal(files.get("staged-only.txt")?.status, "modified")
  assert.equal(files.get("untracked.txt")?.content, "untracked addition\n")
  assert.equal(files.get("untracked.txt")?.status, "added")
  assert.equal(files.get("shared.txt")?.additions, 1)
  assert.equal(files.get("shared.txt")?.deletions, 1)
  assert.deepEqual(await readFile(indexPath), indexBefore)
  assert.equal(await git(directory, "diff", "--cached", "--binary"), stagedBefore)
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
  assert.equal(await git(directory, "status", "--porcelain"), "")
  const scope = await resolveBranchScope(directory)
  assert.equal(scope.id, previous.id)
  assert.notEqual(scope.comparison?.head, previous.comparison?.head)
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  assert.deepEqual(readFilesForScope(scope), [])
})

test("local edits can cancel committed changes and staged changes without moving refs", async (t) => {
  const directory = await repository(t, { "shared.txt": "base\n", "removed.txt": "restore me\n" })
  await git(directory, "checkout", "-b", "feature")
  await put(directory, "shared.txt", "committed feature\n")
  await put(directory, "added.txt", "committed addition\n")
  await rm(join(directory, "removed.txt"))
  await commit(directory)
  const scope = await resolveBranchScope(directory)
  await reconcileWorkspaceDiff(noSDK, scope)
  assert.equal(readFilesForScope(scope).length, 3)

  await put(directory, "shared.txt", "staged feature\n")
  await put(directory, "staged-addition.txt", "staged addition\n")
  await git(directory, "add", "--all")
  await put(directory, "shared.txt", "base\n")
  await put(directory, "removed.txt", "restore me\n")
  await rm(join(directory, "added.txt"))
  await rm(join(directory, "staged-addition.txt"))
  const indexBefore = await readFile(join(directory, ".git/index"))

  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  assert.deepEqual(readFilesForScope(scope), [])
  assert.deepEqual(await resolveBranchScope(directory), scope)
  assert.deepEqual(await readFile(join(directory, ".git/index")), indexBefore)
  assert.notEqual(await git(directory, "diff", "--cached"), "")
  assert.notEqual(await git(directory, "diff"), "")
})

test("dirty main refreshes the same scope without moving refs and avoids no-op state writes", async (t) => {
  const directory = await repository(t, { "shared.txt": "before\nbase\nafter\n" })
  const scope = await resolveBranchScope(directory)
  assert.equal(scope.comparison?.name, "main")
  assert.equal(scope.comparison?.head, scope.comparison?.mergeBase)
  await put(directory, "shared.txt", "before\nstaged\nafter\n")
  await git(directory, "add", "shared.txt")
  await put(directory, "shared.txt", "before\nfirst local\nafter\n")
  const indexBefore = await readFile(join(directory, ".git/index"))
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const first = readFilesForScope(scope)
  assert.equal(first.length, 1)
  assert.equal(first[0].content, "before\nfirst local\nafter\n")
  assert.match(first[0].patch, / before\n-base\n\+first local\n after/)

  const statePath = join(directory, ".opencode/ledger/state.json")
  const stateBefore = await readFile(statePath)
  const oldTime = new Date("2000-01-01T00:00:00Z")
  await utimes(statePath, oldTime, oldTime)
  const mtimeBefore = (await stat(statePath, { bigint: true })).mtimeNs
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  assert.deepEqual(await readFile(statePath), stateBefore)
  assert.equal((await stat(statePath, { bigint: true })).mtimeNs, mtimeBefore)

  await put(directory, "shared.txt", "before\nsecond local\nafter\n")
  await put(directory, "new.txt", "new untracked\n")
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const second = new Map(readFilesForScope(scope).map((file) => [file.path, file]))
  assert.deepEqual([...second.keys()].sort(), ["new.txt", "shared.txt"])
  assert.equal(second.get("shared.txt")?.content, "before\nsecond local\nafter\n")
  assert.match(second.get("shared.txt")!.patch, / before\n-base\n\+second local\n after/)
  assert.notEqual(second.get("shared.txt")?.hash, first[0].hash)
  assert.equal(second.get("new.txt")?.content, "new untracked\n")
  assert.deepEqual(await resolveBranchScope(directory), scope)
  assert.deepEqual(await readFile(join(directory, ".git/index")), indexBefore)
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

test("base picker lists local and remote branches without tags or symbolic aliases, even without main", async (t) => {
  const directory = await repository(t)
  await git(directory, "branch", "-m", "develop")
  await git(directory, "branch", "origin/develop")
  await git(directory, "update-ref", "refs/remotes/origin/develop", "HEAD")
  await git(directory, "update-ref", "refs/remotes/upstream/release/v1", "HEAD")
  await git(directory, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop")
  await git(directory, "tag", "main")
  const branches = await listBaseBranches(directory)
  assert.deepEqual(branches, [
    { ref: "refs/heads/develop", name: "develop", kind: "local" },
    { ref: "refs/heads/origin/develop", name: "origin/develop", kind: "local" },
    { ref: "refs/remotes/origin/develop", name: "origin/develop", kind: "remote" },
    { ref: "refs/remotes/upstream/release/v1", name: "upstream/release/v1", kind: "remote" },
  ])
  await assert.rejects(resolveBranchScope(directory), /Press B/)
  assert.equal((await resolveBranchScope(directory, branches[0].ref)).comparison?.baseRef, "refs/heads/develop")
})

test("alternate bases change the comparison and keep reviews isolated when switching back", async (t) => {
  const directory = await repository(t)
  await git(directory, "checkout", "-b", "develop")
  await put(directory, "develop.txt", "develop change\n")
  await commit(directory)
  await git(directory, "checkout", "-b", "feature")
  await put(directory, "shared.txt", "feature change\n")
  await commit(directory)
  const indexBefore = await readFile(join(directory, ".git/index"))
  const main = await resolveBranchScope(directory)
  await reconcileWorkspaceDiff(noSDK, main)
  assert.deepEqual(readFilesForScope(main).map((file) => file.path).sort(), ["develop.txt", "shared.txt"])
  const file = readFilesForScope(main).find((file) => file.path === "shared.txt")!
  setBlockResolved(main, file.id, file.blocks[0].id, true)
  setBlockComment(main, file.id, file.blocks[0].id, "Keep this review on main")

  const develop = await resolveBranchScope(directory, "refs/heads/develop")
  await reconcileWorkspaceDiff(noSDK, develop)
  assert.notEqual(develop.id, main.id)
  assert.deepEqual(readFilesForScope(develop).map((file) => file.path), ["shared.txt"])
  assert.equal(readFilesForScope(develop)[0].blocks[0].resolved, false)
  assert.equal(readFilesForScope(develop)[0].blocks[0].comment, undefined)

  const returned = await resolveBranchScope(directory, "refs/heads/main")
  assert.equal(returned.id, main.id)
  await reconcileWorkspaceDiff(noSDK, returned)
  const restored = readFilesForScope(returned).find((file) => file.path === "shared.txt")!
  assert.equal(restored.blocks[0].resolved, true)
  assert.equal(restored.blocks[0].comment, "Keep this review on main")
  assert.equal(await git(directory, "branch", "--show-current"), "feature")
  assert.deepEqual(await readFile(join(directory, ".git/index")), indexBefore)
})

test("local and remote bases with the same display name have distinct refs and review scopes", async (t) => {
  const directory = await repository(t)
  const original = await git(directory, "rev-parse", "HEAD")
  await git(directory, "checkout", "-b", "feature")
  await put(directory, "shared.txt", "feature change\n")
  const head = await commit(directory)
  await git(directory, "branch", "origin/main", head)
  await git(directory, "update-ref", "refs/remotes/origin/main", original)
  const local = await resolveBranchScope(directory, "refs/heads/origin/main")
  const remote = await resolveBranchScope(directory, "refs/remotes/origin/main")
  assert.equal(local.comparison?.base, head)
  assert.equal(remote.comparison?.base, original)
  assert.notEqual(local.id, remote.id)
  assert.equal(baseBranchRef(local.comparison!.baseRef), "refs/heads/origin/main")
  assert.equal(baseBranchRef(remote.comparison!.baseRef), "refs/remotes/origin/main")
  assert.equal(remote.id, ledgerScopeForDirectory(directory, "branch", { ...remote.comparison!, baseRef: "origin/main" }).id)
})

test("deleted or invalid selected bases report errors instead of falling back to main", async (t) => {
  const directory = await repository(t)
  await git(directory, "branch", "release")
  const branches = await listBaseBranches(directory)
  const selected = branches.find((branch) => branch.name === "release")!
  await git(directory, "branch", "-D", "release")
  await assert.rejects(resolveBranchScope(directory, selected.ref), /Base branch release is unavailable.*Press B/)
  await assert.rejects(resolveBranchScope(directory, "refs/heads/main~1"), /unavailable/)
  await assert.rejects(resolveBranchScope(directory, "--all"), /Choose a local or remote-tracking branch/)
  await git(directory, "checkout", "--orphan", "unrelated")
  await git(directory, "commit", "--allow-empty", "-m", "separate history")
  await git(directory, "checkout", "main")
  await assert.rejects(resolveBranchScope(directory, "refs/heads/unrelated"), /no common ancestor.*Press B/)
})

test("alternate-base refreshes reject a moved base and do not write after changing selection", async (t) => {
  const directory = await repository(t)
  await git(directory, "branch", "develop")
  await git(directory, "checkout", "-b", "feature")
  await put(directory, "shared.txt", "feature change\n")
  const head = await commit(directory)
  const scope = await resolveBranchScope(directory, "refs/heads/develop")
  await reconcileWorkspaceDiff(noSDK, scope)
  const statePath = join(directory, ".opencode/ledger/state.json")
  const before = await readFile(statePath, "utf8")
  await git(directory, "update-ref", "refs/heads/develop", head)
  await assert.rejects(reconcileWorkspaceDiff(noSDK, scope), /comparison base changed/)
  assert.equal(await readFile(statePath, "utf8"), before)

  const updated = await resolveBranchScope(directory, "refs/heads/develop")
  let selection = "refs/heads/develop"
  const pending = reconcileWorkspaceDiff(noSDK, updated, () => selection === "refs/heads/develop")
  selection = "refs/heads/main"
  assert.equal(await pending, false)
  assert.equal(await readFile(statePath, "utf8"), before)
})

test("reconciliation rejects stale scopes after HEAD, branch, or comparison base changes", async (t) => {
  for (const change of ["HEAD", "branch", "base", "base ref"] as const) {
    await t.test(change, async (t) => {
      const directory = await repository(t)
      await git(directory, "checkout", "-b", "feature")
      await put(directory, "shared.txt", "snapshot content\n")
      await commit(directory)
      const scope = await resolveBranchScope(directory)
      const comparison = { ...scope.comparison }
      await reconcileWorkspaceDiff(noSDK, scope)
      const statePath = join(directory, ".opencode/ledger/state.json")
      const before = await readFile(statePath)

      if (change === "HEAD") {
        await put(directory, "shared.txt", "later feature content\n")
        await commit(directory)
      } else if (change === "branch") {
        await git(directory, "checkout", "-b", "another-feature")
      } else if (change === "base") {
        await git(directory, "update-ref", "refs/heads/main", comparison.head!)
      } else {
        await git(directory, "update-ref", "refs/remotes/origin/main", comparison.base!)
        await git(directory, "branch", "-D", "main")
      }
      await put(directory, "shared.txt", "dirty current checkout\n")
      const indexBefore = await readFile(join(directory, ".git/index"))
      await assert.rejects(reconcileWorkspaceDiff(noSDK, scope), /branch or comparison base changed.*Refresh Ledger/)
      assert.deepEqual(scope.comparison, comparison)
      assert.deepEqual(await readFile(statePath), before)
      assert.deepEqual(await readFile(join(directory, ".git/index")), indexBefore)
      const files = readFilesForScope(scope)
      assert.equal(files.length, 1)
      assert.equal(files[0].content, "snapshot content\n")
      assert.match(files[0].patch, /-base\n\+snapshot content/)
      assert.doesNotMatch(files[0].patch, /later|dirty/)
      const refreshed = await resolveBranchScope(directory)
      assert.equal(await reconcileWorkspaceDiff(noSDK, refreshed), true)
      assert.equal(readFilesForScope(refreshed)[0].content, "dirty current checkout\n")
    })
  }
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
  const api = { client: { vcs: { diff: async () => ({ data: [{ file: updated.path, patch: updated.patch }] }) } } } as unknown as TuiPluginApi
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
  const api = { client: { vcs: { diff: async () => ({ data: [{ file: "shared.txt", patch }] }) } } } as unknown as TuiPluginApi
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
  await mkdir(join(directory, gitlink), { recursive: true })
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

test("untracked literal names, empty files, binaries, and symlinks are captured but ignored files are not", async (t) => {
  const directory = await repository(t, {
    ".gitignore": ".opencode/\nignored/\n*.ignored\n",
    "target.txt": "target contents must not replace symlink contents\n",
  })
  const names = ["with spaces.txt", 'quote " and apostrophe\'.txt', "\u96ea/caf\u00e9.txt", "tab\tand\nnewline.txt", "back\\slash.txt", " leading and trailing ", "-leading-dash.txt", ":(glob)*.txt"]
  for (const [index, name] of names.entries()) await put(directory, name, `untracked literal file ${index}\n`)
  await put(directory, "empty.txt", "")
  await put(directory, "binary.bin", Buffer.from([0, 1, 2, 3]))
  await symlink("target.txt", join(directory, "link.txt"))
  await symlink("missing-target", join(directory, "dangling.txt"))
  await put(directory, "ignored/nested.txt", "ignored directory\n")
  await put(directory, "secret.ignored", "ignored extension\n")
  const indexBefore = await readFile(join(directory, ".git/index"))
  const scope = await resolveBranchScope(directory)
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const files = new Map(readFilesForScope(scope).map((file) => [file.path, file]))
  assert.deepEqual([...files.keys()].sort(), [...names, "empty.txt", "binary.bin", "link.txt", "dangling.txt"].sort())
  for (const [index, name] of names.entries()) {
    assert.equal(files.get(name)?.content, `untracked literal file ${index}\n`)
    assert.ok(files.get(name)!.patch.includes(`+untracked literal file ${index}`))
  }
  assert.ok([...files.values()].every((file) => file.status === "added"))
  assert.equal(files.get("empty.txt")?.content, "")
  assert.equal(files.get("empty.txt")?.additions, 0)
  assert.match(files.get("empty.txt")!.patch, /new file mode 100644/)
  assert.equal(files.get("binary.bin")?.content, "")
  assert.match(files.get("binary.bin")!.patch, /Binary files/)
  for (const [name, target] of [["link.txt", "target.txt"], ["dangling.txt", "missing-target"]]) {
    assert.equal(files.get(name)?.content, target)
    assert.match(files.get(name)!.patch, /new file mode 120000/)
    assert.ok(files.get(name)!.patch.includes(`+${target}`))
  }
  assert.deepEqual(await readFile(join(directory, ".git/index")), indexBefore)
  assert.equal(await git(directory, "diff", "--cached"), "")
})

test("the copied index retains force-added ignored files while capturing their unstaged edits", async (t) => {
  const directory = await repository(t, { ".gitignore": ".opencode/\n*.ignored\n" })
  await put(directory, "kept.ignored", "staged ignored file\n")
  await git(directory, "add", "--force", "kept.ignored")
  await put(directory, "kept.ignored", "unstaged ignored file\n")
  await put(directory, "excluded.ignored", "never staged\n")
  const indexBefore = await readFile(join(directory, ".git/index"))
  const scope = await resolveBranchScope(directory)
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const files = readFilesForScope(scope)
  assert.deepEqual(files.map((file) => file.path), ["kept.ignored"])
  assert.equal(files[0].status, "added")
  assert.equal(files[0].content, "unstaged ignored file\n")
  assert.match(files[0].patch, /\+unstaged ignored file/)
  assert.deepEqual(await readFile(join(directory, ".git/index")), indexBefore)
  assert.equal(await git(directory, "show", ":kept.ignored"), "staged ignored file")
})

test("dirty attributes and normalized content come from the same captured tree as the patch", async (t) => {
  const directory = await repository(t, {
    ".gitattributes": "*.txt -diff\n",
    "shared.txt": "before\nbase\nafter\n",
  })
  await put(directory, ".gitattributes", "*.txt diff text eol=lf\n")
  await put(directory, "shared.txt", "before\r\nlocal edit\r\nafter\r\n")
  const scope = await resolveBranchScope(directory)
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const files = new Map(readFilesForScope(scope).map((file) => [file.path, file]))
  assert.deepEqual([...files.keys()].sort(), [".gitattributes", "shared.txt"])
  assert.equal(files.get(".gitattributes")?.content, "*.txt diff text eol=lf\n")
  assert.match(files.get(".gitattributes")!.patch, /-\*\.txt -diff\n\+\*\.txt diff text eol=lf/)
  assert.equal(files.get("shared.txt")?.content, "before\nlocal edit\nafter\n")
  assert.match(files.get("shared.txt")!.patch, / before\n-base\n\+local edit\n after/)
  assert.doesNotMatch(files.get("shared.txt")!.patch, /Binary files|\r/)
  assert.equal(await readFile(join(directory, "shared.txt"), "utf8"), "before\r\nlocal edit\r\nafter\r\n")
})

test("materialized assume-unchanged and skip-worktree edits are captured without changing real index flags", async (t) => {
  const directory = await repository(t, { "assumed.txt": "base\n", "skipped.txt": "base\n" })
  await symlink("old-target", join(directory, "skipped-link"))
  await commit(directory)
  await git(directory, "update-index", "--assume-unchanged", "assumed.txt")
  await git(directory, "update-index", "--skip-worktree", "skipped.txt", "skipped-link")
  const flags = await git(directory, "ls-files", "-v")
  assert.match(flags, /^h assumed\.txt$/m)
  assert.match(flags, /^S skipped\.txt$/m)
  assert.match(flags, /^S skipped-link$/m)
  await put(directory, "assumed.txt", "assumed edit\n")
  await put(directory, "skipped.txt", "skipped edit\n")
  await rm(join(directory, "skipped-link"))
  await symlink("missing-target", join(directory, "skipped-link"))
  const indexBefore = await readFile(join(directory, ".git/index"))
  const scope = await resolveBranchScope(directory)
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const files = new Map(readFilesForScope(scope).map((file) => [file.path, file]))
  assert.deepEqual([...files.keys()].sort(), ["assumed.txt", "skipped-link", "skipped.txt"])
  for (const [name, content] of [["assumed.txt", "assumed edit\n"], ["skipped.txt", "skipped edit\n"], ["skipped-link", "missing-target"]]) {
    assert.equal(files.get(name)?.status, "modified")
    assert.equal(files.get(name)?.content, content)
    assert.ok(files.get(name)!.patch.includes(`+${content.trimEnd()}`))
  }
  assert.deepEqual(await readFile(join(directory, ".git/index")), indexBefore)
  assert.equal(await git(directory, "ls-files", "-v"), flags)
})

test("sparse checkouts preserve absent tracked files and capture materialized changes outside the cone", async (t) => {
  const directory = await repository(t, {
    "inside/kept.txt": "inside base\n",
    "outside/absent.txt": "outside base\n",
    "outside/materialized.txt": "materialized base\n",
  })
  await git(directory, "checkout", "-b", "feature")
  await put(directory, "outside/absent.txt", "committed outside change\n")
  await commit(directory)
  await git(directory, "sparse-checkout", "init", "--cone", "--sparse-index")
  await git(directory, "sparse-checkout", "set", "inside")
  assert.equal(existsSync(join(directory, "outside/absent.txt")), false)
  assert.equal(existsSync(join(directory, "outside/materialized.txt")), false)
  const scope = await resolveBranchScope(directory)
  const sparseIndex = await readFile(join(directory, ".git/index"))
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const initial = readFilesForScope(scope)
  assert.deepEqual(initial.map((file) => file.path), ["outside/absent.txt"])
  assert.equal(initial[0].status, "modified")
  assert.equal(initial[0].content, "committed outside change\n")
  assert.match(initial[0].patch, /-outside base\n\+committed outside change/)
  assert.deepEqual(await readFile(join(directory, ".git/index")), sparseIndex)

  await put(directory, "outside/materialized.txt", "outside local edit\n")
  await put(directory, "outside/new.txt", "outside untracked\n")
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const files = new Map(readFilesForScope(scope).map((file) => [file.path, file]))
  assert.deepEqual([...files.keys()].sort(), ["outside/absent.txt", "outside/materialized.txt", "outside/new.txt"])
  assert.deepEqual(files.get("outside/absent.txt"), initial[0])
  assert.equal(files.get("outside/materialized.txt")?.status, "modified")
  assert.equal(files.get("outside/materialized.txt")?.content, "outside local edit\n")
  assert.match(files.get("outside/materialized.txt")!.patch, /-materialized base\n\+outside local edit/)
  assert.equal(files.get("outside/new.txt")?.status, "added")
  assert.equal(files.get("outside/new.txt")?.content, "outside untracked\n")
  assert.equal(existsSync(join(directory, "outside/absent.txt")), false)
  assert.deepEqual(await readFile(join(directory, ".git/index")), sparseIndex)
})

test("a missing real index is not created while capturing tracked and untracked changes", async (t) => {
  const directory = await repository(t, { "shared.txt": "base\n", "removed.txt": "delete me\n" })
  await rm(join(directory, ".git/index"))
  await put(directory, "shared.txt", "local edit\n")
  await put(directory, "new.txt", "untracked\n")
  await rm(join(directory, "removed.txt"))
  const scope = await resolveBranchScope(directory)
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const files = new Map(readFilesForScope(scope).map((file) => [file.path, file]))
  assert.deepEqual([...files.keys()].sort(), ["new.txt", "removed.txt", "shared.txt"])
  assert.equal(files.get("shared.txt")?.content, "local edit\n")
  assert.match(files.get("shared.txt")!.patch, /-base\n\+local edit/)
  assert.equal(files.get("new.txt")?.status, "added")
  assert.equal(files.get("new.txt")?.content, "untracked\n")
  assert.equal(files.get("removed.txt")?.status, "deleted")
  assert.equal(files.get("removed.txt")?.content, "")
  assert.equal(existsSync(join(directory, ".git/index")), false)
})

test("linked worktrees capture their own working state without changing either real index", async (t) => {
  const directory = await repository(t)
  const linked = join(await temporaryDirectory(t), "linked")
  await git(directory, "worktree", "add", "-b", "feature", linked)
  await put(directory, "shared.txt", "main staged edit\n")
  await git(directory, "add", "shared.txt")
  await put(linked, "shared.txt", "linked staged edit\n")
  await git(linked, "add", "shared.txt")
  await put(linked, "shared.txt", "linked unstaged edit\n")
  await put(linked, "new.txt", "linked untracked\n")
  const mainIndex = join(directory, ".git/index")
  const linkedIndex = await git(linked, "rev-parse", "--path-format=absolute", "--git-path", "index")
  assert.notEqual(linkedIndex, mainIndex)
  const mainBefore = await readFile(mainIndex)
  const linkedBefore = await readFile(linkedIndex)
  const scope = await resolveBranchScope(linked)
  assert.equal(scope.directory, linked)
  assert.equal(scope.comparison?.name, "feature")
  assert.equal(await reconcileWorkspaceDiff(noSDK, scope), true)
  const files = new Map(readFilesForScope(scope).map((file) => [file.path, file]))
  assert.deepEqual([...files.keys()].sort(), ["new.txt", "shared.txt"])
  assert.equal(files.get("shared.txt")?.content, "linked unstaged edit\n")
  assert.match(files.get("shared.txt")!.patch, /-base\n\+linked unstaged edit/)
  assert.equal(files.get("new.txt")?.content, "linked untracked\n")
  assert.deepEqual(await readFile(mainIndex), mainBefore)
  assert.deepEqual(await readFile(linkedIndex), linkedBefore)
  assert.equal(existsSync(join(directory, ".opencode/ledger/state.json")), false)
})

test("worktree mode uses V2 patches and local file content, and clears an empty changeset", async (t) => {
  const directory = await repository(t)
  await put(directory, "shared.txt", "local workspace content\n")
  const scope = ledgerScopeForDirectory(directory)
  assert.equal(scope.mode, "worktree")
  const patch = await git(directory, "diff", "--no-ext-diff", "--no-textconv", "--no-color")
  let calls = 0
  let diffs = [{ file: "shared.txt", patch, additions: 1, deletions: 1, status: "modified" }]
  const api = { client: { vcs: {
    diff: async (input: { location: { directory: string }; mode: string }) => {
      assert.deepEqual(input, { location: { directory }, mode: "working" })
      calls++
      return { location: { directory }, data: diffs }
    },
  } } } as unknown as TuiPluginApi
  assert.equal(await reconcileWorkspaceDiff(api, scope), true)
  assert.equal(calls, 1)
  assert.equal(readFilesForScope(scope)[0].content, "local workspace content\n")
  assert.match(readFilesForScope(scope)[0].patch, /\+local workspace content/)

  diffs = []
  assert.equal(await reconcileWorkspaceDiff(api, scope), true)
  assert.equal(calls, 2)
  assert.deepEqual(readFilesForScope(scope), [])
})

test("a pending V2 worktree request still checks shouldApply before storage writes", async (t) => {
  const directory = await repository(t)
  const scope = ledgerScopeForDirectory(directory)
  const result = Promise.withResolvers<{ data: { file: string; patch: string }[] }>()
  const started = Promise.withResolvers<void>()
  const api = { client: { vcs: {
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
