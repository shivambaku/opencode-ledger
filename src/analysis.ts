import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { COMMIT_MESSAGE_SCHEMA, MAX_EXPLANATIONS_PER_HUNK, REVIEW_SCHEMA } from "./constants"
import { buildCommitMessagePrompt } from "./commitPrompt"
import { buildReviewPrompt, type ReviewPrompt } from "./reviewPrompt"
import { ensureLedgerIgnored } from "./storage"
import type { AnalysisModel, BlockExplanation, BlockReview, CommitMessageResult, FileAnalysis, LedgerBlock, LedgerFile, LedgerScope } from "./types"
import { clip, isImpact, isRecord, textFromParts } from "./utils"

function debugEnabled() {
  return process.env.LEDGER_DEBUG === "1"
}

function debugFileName(path: string) {
  return path.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "file"
}

function writeAnalysisDebug(scope: LedgerScope, file: LedgerFile, analysisSessionID: string, request: ReviewPrompt, response: { structured?: unknown; rawText?: string } | undefined, error: unknown, model: AnalysisModel | undefined) {
  if (!debugEnabled()) return
  try {
    const dir = join(scope.directory, ".opencode/ledger/debug")
    mkdirSync(dir, { recursive: true })
    ensureLedgerIgnored(scope)

    const createdAt = Date.now()
    const payload = {
      createdAt,
      createdAtISO: new Date(createdAt).toISOString(),
      directory: scope.directory,
      scopeID: scope.id,
      file: file.path,
      fileHash: file.hash,
      analysisSessionID,
      agent: "plan",
      model: model ? `${model.providerID}/${model.modelID}` : undefined,
      context: request.context,
      hunks: request.hunks,
      prompt: request.prompt,
      response,
      error: error ? (error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) }) : null,
    }
    const text = `${JSON.stringify(payload, null, 2)}\n`
    const timestamp = new Date(createdAt).toISOString().replace(/[:.]/g, "-")
    writeFileSync(join(dir, `${timestamp}__${debugFileName(file.path)}.json`), text)
    writeFileSync(join(dir, "latest.json"), text)
  } catch {
    // Debug logging should never make review analysis fail.
  }
}

function parseAnalysisModel(value: unknown): AnalysisModel | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error("Invalid Ledger model option. Expected provider/model-id.")

  const model = value.trim()
  const slash = model.indexOf("/")
  if (slash <= 0 || slash === model.length - 1) throw new Error("Invalid Ledger model option. Expected provider/model-id.")

  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) }
}

function parseCommitMessageValue(value: unknown, meta: Pick<CommitMessageResult, "quality" | "analyzedFiles" | "totalFiles">): CommitMessageResult {
  const parsed = typeof value === "string" ? parseJsonObject(value) : value
  if (!isRecord(parsed) || typeof parsed.title !== "string" || typeof parsed.body !== "string") {
    throw new Error("Commit message response did not match the expected schema.")
  }

  const title = parsed.title.split(/\r?\n/)[0]?.replace(/\s+/g, " ").trim() ?? ""
  if (!title) throw new Error("Commit message response did not include a title.")
  const body = parsed.body.trim()
  return { ...meta, title, body, text: title }
}

function parseJsonObject(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error("Review response was not JSON.")
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown
}

function parseAnalysisPayload(value: unknown): { impact: FileAnalysis["impact"]; hunks: unknown[] } {
  const parsed = typeof value === "string" ? parseJsonObject(value) : value
  if (!isRecord(parsed) || !isImpact(parsed.impact) || !Array.isArray(parsed.hunks)) {
    throw new Error("Analysis response did not match the expected schema.")
  }

  return { impact: parsed.impact, hunks: parsed.hunks }
}

function parseHunkHeader(value: unknown, blocksByID: Map<string, LedgerBlock>, used: Set<string>) {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.explanations)) throw new Error("Analysis response did not match the expected hunk schema.")
  if (used.has(value.id)) throw new Error("Analysis response included a hunk more than once.")

  const block = blocksByID.get(value.id)
  if (!block) throw new Error("Analysis response referenced an unknown hunk.")
  used.add(value.id)
  return { block, explanations: value.explanations }
}

function parseExplanation(value: unknown, block: LedgerBlock): BlockExplanation {
  if (!isRecord(value) || typeof value.startLine !== "number" || typeof value.endLine !== "number" || typeof value.explanation !== "string") throw new Error("Analysis response did not match the expected explanation schema.")

  const start = clip(Math.floor(Math.min(value.startLine, value.endLine)) - 1, block.diffStartLine, block.diffEndLine)
  const end = clip(Math.floor(Math.max(value.startLine, value.endLine)) - 1, block.diffStartLine, block.diffEndLine)
  return { diffStartLine: start, diffEndLine: end, explanation: value.explanation.trim() || "No explanation returned." }
}

function parseBlockReview(value: unknown, blocksByID: Map<string, LedgerBlock>, used: Set<string>, generatedAt: number): { id: string; review: BlockReview } {
  const { block, explanations: rawExplanations } = parseHunkHeader(value, blocksByID, used)
  const explanations = rawExplanations
    .slice(0, MAX_EXPLANATIONS_PER_HUNK)
    .map((item) => parseExplanation(item, block))
    .sort((a, b) => a.diffStartLine - b.diffStartLine || a.diffEndLine - b.diffEndLine)

  if (!explanations.length) throw new Error("Analysis response included a hunk without explanations.")
  return { id: block.id, review: { hash: block.hash, generatedAt, explanations } }
}

function parseAnalysisValue(value: unknown, file: LedgerFile): { analysis: FileAnalysis; reviews: Map<string, BlockReview> } {
  const parsed = parseAnalysisPayload(value)

  const blocksByID = new Map(file.blocks.map((block) => [block.id, block]))
  const used = new Set<string>()
  const generatedAt = Date.now()
  const reviews = new Map<string, BlockReview>()

  for (const hunk of parsed.hunks) {
    const { id, review } = parseBlockReview(hunk, blocksByID, used, generatedAt)
    reviews.set(id, review)
  }
  for (const block of file.blocks) {
    if (!used.has(block.id)) throw new Error("Analysis response did not include every block.")
  }

  return {
    analysis: { hash: file.hash, impact: parsed.impact, generatedAt },
    reviews,
  }
}

export async function abortSession(api: TuiPluginApi, scope: LedgerScope, sessionID: string) {
  try {
    await api.client.session.abort({ sessionID, directory: scope.directory })
  } catch {
    // Stop is best effort; cancellation still prevents Ledger from using the session.
  }
}

export async function deleteSession(api: TuiPluginApi, scope: LedgerScope, sessionID: string) {
  try {
    await api.client.session.delete({ sessionID, directory: scope.directory })
  } catch {
    // Analysis sessions are temporary; cleanup is best effort.
  }
}

async function createAnalysisSession(api: TuiPluginApi, scope: LedgerScope, shouldContinue: () => boolean, model: AnalysisModel | undefined, title = "Ledger analysis") {
  if (!shouldContinue()) throw new Error("Analysis stopped.")
  const result = await api.client.session.create({
    directory: scope.directory,
    title,
    agent: "plan",
    model: model ? { providerID: model.providerID, id: model.modelID } : undefined,
  })
  if (result.error || !result.data) throw new Error("Failed to create Ledger analysis session.")
  if (!shouldContinue()) {
    await abortSession(api, scope, result.data.id)
    await deleteSession(api, scope, result.data.id)
    throw new Error("Analysis stopped.")
  }
  return result.data.id
}

export async function requestAnalysis(api: TuiPluginApi, scope: LedgerScope, file: LedgerFile, shouldContinue: () => boolean, modelOption?: unknown, onSession?: (sessionID: string) => void) {
  const model = parseAnalysisModel(modelOption)
  const sessionID = await createAnalysisSession(api, scope, shouldContinue, model)
  onSession?.(sessionID)
  if (!shouldContinue()) throw new Error("Analysis stopped.")
  const request = await buildReviewPrompt(scope, file)
  let response: { structured?: unknown; rawText?: string } | undefined
  try {
    const result = await api.client.session.prompt({
      sessionID,
      directory: scope.directory,
      agent: "plan",
      model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
      format: { type: "json_schema", schema: REVIEW_SCHEMA },
      parts: [{ type: "text", text: request.prompt }],
    })
    if (result.error || !result.data) {
      response = { rawText: result.error ? JSON.stringify(result.error) : undefined }
      throw new Error("Ledger analysis failed.")
    }
    response = { structured: result.data.info.structured, rawText: textFromParts(result.data.parts) }
    const parsed = result.data.info.structured !== undefined ? parseAnalysisValue(result.data.info.structured, file) : parseAnalysisValue(response.rawText ?? "", file)
    writeAnalysisDebug(scope, file, sessionID, request, response, undefined, model)
    return parsed
  } catch (error) {
    writeAnalysisDebug(scope, file, sessionID, request, response, error, model)
    throw error
  }
}

export async function requestCommitMessage(api: TuiPluginApi, scope: LedgerScope, files: LedgerFile[], shouldContinue: () => boolean, modelOption?: unknown, onSession?: (sessionID: string) => void): Promise<CommitMessageResult> {
  if (!files.length) throw new Error("No uncommitted Git changes.")
  const model = parseAnalysisModel(modelOption)
  const request = buildCommitMessagePrompt(files)
  const sessionID = await createAnalysisSession(api, scope, shouldContinue, model, "Ledger commit message")
  onSession?.(sessionID)
  if (!shouldContinue()) throw new Error("Analysis stopped.")
  const result = await api.client.session.prompt({
    sessionID,
    directory: scope.directory,
    agent: "plan",
    model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
    format: { type: "json_schema", schema: COMMIT_MESSAGE_SCHEMA },
    parts: [{ type: "text", text: request.prompt }],
  })
  if (result.error || !result.data) throw new Error("Commit message generation failed.")

  const meta = { quality: request.quality, analyzedFiles: request.analyzedFiles, totalFiles: request.totalFiles }
  return result.data.info.structured !== undefined ? parseCommitMessageValue(result.data.info.structured, meta) : parseCommitMessageValue(textFromParts(result.data.parts), meta)
}
