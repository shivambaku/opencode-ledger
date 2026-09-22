import assert from "node:assert/strict"
import { test } from "node:test"
import type { OpenCodeClient } from "@opencode/client"
import type { Context } from "@opencode/plugin/tui/context"
import { abortSession, requestAnalysis, requestCommitMessage } from "../src/analysis.ts"
import { retrieveReviewContext } from "../src/contextLookup.ts"
import { ledgerScope, ledgerScopeForDirectory } from "../src/storage.ts"
import type { LedgerFile } from "../src/types.ts"

const scope = ledgerScopeForDirectory("/fixture/project")
const file: LedgerFile = {
  id: "example.txt", path: "example.txt", content: "updated line\n",
  patch: "@@ -1 +1 @@\n-original line\n+updated line", hash: "file-hash",
  additions: 1, deletions: 1, updatedAt: 0,
  blocks: [{
    id: "block", fileID: "example.txt", hash: "block-hash",
    patch: "@@ -1 +1 @@\n-original line\n+updated line",
    diffStartLine: 0, diffEndLine: 2, oldStart: 1, oldEnd: 1, newStart: 1, newEnd: 1,
    additions: 1, deletions: 1, resolved: false, updatedAt: 0,
  }],
}

test("V2 context matches completed edits in this checkout and retains the user request", async () => {
  const client = { session: {
    list: async () => ({ data: [
      { id: "other", location: { directory: "/fixture/other" } },
      { id: "analysis", location: { directory: scope.directory }, metadata: { ledger: true } },
      { id: "matching", title: "Change example", location: { directory: scope.directory } },
    ] }),
    context: async ({ sessionID }: { sessionID: string }) => {
      assert.equal(sessionID, "matching")
      return [
        { id: "user", type: "user", text: "Update the example content." },
        { id: "assistant", type: "assistant", content: [
          { id: "failed", type: "tool", name: "patch", state: { status: "error" } },
          { id: "edit", type: "tool", name: "patch", time: { created: 100 }, state: {
            status: "completed", input: { patchText: "*** Update File: example.txt\n-original line\n+updated line" },
          } },
        ] },
      ]
    },
  } } as unknown as OpenCodeClient
  const context = await retrieveReviewContext(client, scope, file)
  assert.equal(context.source, "opencode-api")
  assert.equal(context.matches.length, 1)
  assert.equal(context.matches[0].partID, "edit")
  assert.match(context.rendered, /User request: Update the example content/)
})

test("analysis validates the generated response against the captured blocks", async () => {
  let text = JSON.stringify({ impact: "low", hunks: [{ id: "block", explanations: [{ startLine: 1, endLine: 3, explanation: "Updates the example." }] }] })
  const api = { client: { session: {
    create: async (input: { location: { directory: string }; model: unknown }) => {
      assert.equal(input.location.directory, scope.directory)
      assert.deepEqual(input.model, { providerID: "provider", id: "model" })
      return { id: "analysis" }
    },
    list: async () => ({ data: [] }),
    generate: async () => ({ text }),
  } } } as unknown as Context
  const result = await requestAnalysis(api, scope, file, () => true, "provider/model")
  assert.equal(result.reviews.get("block")?.hash, "block-hash")
  text = JSON.stringify({ impact: "low", hunks: [] })
  await assert.rejects(requestAnalysis(api, scope, file, () => true, "provider/model"), /every block/)
})

test("stopping analysis aborts the outstanding V2 generation request", async () => {
  let begin!: () => void
  const started = new Promise<void>((resolve) => { begin = resolve })
  let interrupted = false
  const api = { client: { session: {
    create: async () => ({ id: "cancel-me" }),
    generate: async (_input: unknown, { signal }: { signal: AbortSignal }) => {
      begin()
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }))
    },
    interrupt: async ({ sessionID }: { sessionID: string }) => {
      assert.equal(sessionID, "cancel-me")
      interrupted = true
    },
  } } } as unknown as Context
  const pending = requestCommitMessage(api, scope, [file], () => true)
  const rejected = assert.rejects(pending, /cancelled/)
  await started
  await abortSession(api, scope, "cancel-me")
  await rejected
  assert.equal(interrupted, true)
})

test("global tabs select the active session's worktree rather than the launch directory", () => {
  const api = {
    location: { directory: "/fixture/launch" },
    ui: { router: { current: () => ({ type: "session", sessionID: "active" }) } },
    data: { session: { get: () => ({ location: { directory: "/fixture/worktree" } }) } },
  } as unknown as Context
  assert.equal(ledgerScope(api).directory, "/fixture/worktree")
})

test("analysis finishing after the comparison base changes cannot return reviews for the new selection", async () => {
  let begin!: () => void
  const started = new Promise<void>((resolve) => { begin = resolve })
  let finish!: (result: { text: string }) => void
  let base = "refs/heads/main"
  const api = { client: { session: {
    create: async () => ({ id: "old-base-analysis" }),
    list: async () => ({ data: [] }),
    generate: async () => {
      begin()
      return new Promise<{ text: string }>((resolve) => { finish = resolve })
    },
  } } } as unknown as Context
  const pending = requestAnalysis(api, scope, file, () => base === "refs/heads/main")
  const stopped = assert.rejects(pending, /Analysis stopped/)
  await started
  base = "refs/heads/develop"
  finish({ text: JSON.stringify({ impact: "low", hunks: [{ id: "block", explanations: [{ startLine: 1, endLine: 3, explanation: "Old comparison." }] }] }) })
  await stopped
})
