import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { ledgerFiles, ledgerScopeForDirectory, writeFilesForScope } from "../src/storage.ts"

for (const { name, paths, expected } of [
  {
    name: "files with unknown impact sort by file name rather than full path",
    paths: ["a/zebra.ts", "middle.ts", "z/apple.ts"],
    expected: ["z/apple.ts", "middle.ts", "a/zebra.ts"],
  },
  {
    name: "matching file names sort by full path",
    paths: ["z/index.ts", "index.ts", "a/index.ts"],
    expected: ["a/index.ts", "index.ts", "z/index.ts"],
  },
]) {
  test(name, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "ledger-storage-test-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const scope = ledgerScopeForDirectory(directory)
    writeFilesForScope(scope, paths.map((path) => ({
      id: path,
      path,
      content: "",
      patch: "",
      hash: path,
      additions: 0,
      deletions: 0,
      updatedAt: 0,
      blocks: [],
    })))

    assert.deepEqual(ledgerFiles(scope).map((file) => file.path), expected)
  })
}
