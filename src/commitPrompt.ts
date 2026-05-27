import { blockComment, blockReviewed, fileNeedsAnalysis, lineRangeText } from "./domain"
import type { CommitMessageQuality, LedgerFile } from "./types"
import { limitText } from "./utils"

const MAX_COMMIT_DIFF_CHARS = 18000
const MAX_FILE_DIFF_CHARS = 3500

export type CommitMessagePrompt = {
  prompt: string
  quality: CommitMessageQuality
  analyzedFiles: number
  totalFiles: number
}

function commitQuality(files: LedgerFile[]): Pick<CommitMessagePrompt, "quality" | "analyzedFiles" | "totalFiles"> {
  const totalFiles = files.length
  const analyzedFiles = files.filter((file) => !fileNeedsAnalysis(file)).length
  const reviewedBlocks = files.reduce((sum, file) => sum + file.blocks.filter(blockReviewed).length, 0)
  const commentedBlocks = files.reduce((sum, file) => sum + file.blocks.filter((block) => !!blockComment(block)).length, 0)
  const quality: CommitMessageQuality = analyzedFiles === totalFiles ? "full" : analyzedFiles || reviewedBlocks || commentedBlocks ? "partial" : "diff-only"
  return { quality, analyzedFiles, totalFiles }
}

function fileSummary(file: LedgerFile) {
  const status = file.status ?? "modified"
  return `${status} ${file.path} (+${file.additions}/-${file.deletions})`
}

function changesetSummary(files: LedgerFile[]) {
  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)
  return `${files.length} ${files.length === 1 ? "file" : "files"} changed (+${additions}/-${deletions})`
}

function analysisSummary(file: LedgerFile) {
  const impact = file.analysis?.hash === file.hash ? `Impact: ${file.analysis.impact}` : undefined
  const blocks = file.blocks.flatMap((block) => {
    const review = blockReviewed(block) ? block.review : undefined
    const comment = blockComment(block)
    if (!review && !comment) return []
    return [
      [
        `Lines ${lineRangeText(block)}${block.resolved ? " (approved)" : ""}`,
        ...(comment ? [`Reviewer comment: ${comment}`] : []),
        ...(review ? review.explanations.map((item) => `Explanation: ${item.explanation}`) : []),
      ].join("\n"),
    ]
  })
  if (!impact && !blocks.length) return ""
  return [`File: ${file.path}`, ...(impact ? [impact] : []), ...blocks].join("\n")
}

export function buildCommitMessagePrompt(files: LedgerFile[]): CommitMessagePrompt {
  const quality = commitQuality(files)
  const summaries = files.map(fileSummary).join("\n")
  const analysis = limitText(files.map(analysisSummary).filter(Boolean).join("\n\n"), 8000) || "(none available)"
  const maxFileDiff = Math.max(1200, Math.min(MAX_FILE_DIFF_CHARS, Math.floor(MAX_COMMIT_DIFF_CHARS / Math.max(1, files.length))))
  const diff = limitText(files.map((file) => `File: ${file.path}\n\`\`\`diff\n${limitText(file.patch, maxFileDiff)}\n\`\`\``).join("\n\n"), MAX_COMMIT_DIFF_CHARS)
  const prompt = `You are generating a Git commit message for the current Ledger changeset.

Generate the message for the entire changeset, not for one interesting file, helper, bug fix, or analysis note. First infer the dominant purpose that best explains the changed files together. Prefer a broad, accurate summary over a narrow implementation detail.

Use the current diff as the source of truth. Existing Ledger analysis and reviewer comments are secondary context: they may explain intent, but may be partial, stale, or focused on only one file. Do not mention Ledger, analysis coverage, hunks, JSON, or internal IDs in the commit message.

Return only JSON matching the requested schema.

Changeset summary:
${changesetSummary(files)}

Changed files:
${summaries}

Current Git diff excerpts by file:
${diff}

Available Ledger context, if useful:
${analysis}

Fields:
- title: one short Conventional Commit subject using type(scope): description. Scope is optional. Keep it under 72 characters and do not end with punctuation. It must summarize the dominant changeset purpose, not just one internal cleanup.
- body: always an empty string.

Style:
- Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore.
- Describe the user-visible or developer-facing change, not the mechanics of editing files.
- If the changes are mixed release/setup/docs/code hardening work, choose a broad title that covers the release or maintenance intent.
- Only use fix when the dominant change is a user-facing bug fix. Use chore or build for package metadata, publish setup, and release preparation.
- Use imperative mood after the colon.
- Do not invent motivation that is not supported by the diff or available context.
- Do not include markdown fences, bullets unless genuinely helpful, or a trailing period in the title.
- Good: feat(ledger): generate commit messages
- Good: docs: document commit message shortcut
- Bad: add commit message generation
- Bad: feat(ledger): generate commit messages\n\nAdd a shortcut that copies a generated commit message.
`

  return { prompt, ...quality }
}
