import { blockComment, blockReviewed, fileNeedsAnalysis, lineRangeText } from "./domain"
import type { CommitMessageQuality, LedgerFile } from "./types"
import { limitText } from "./utils"

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
  const diff = limitText(files.map((file) => `File: ${file.path}\n\`\`\`diff\n${file.patch}\n\`\`\``).join("\n\n"), 18000)
  const prompt = `You are generating a Git commit message for the current Ledger changeset.

Use the current diff as the source of truth. Existing Ledger analysis and reviewer comments may explain intent, but may be partial or stale. Do not mention Ledger, analysis coverage, hunks, JSON, or internal IDs in the commit message.

Return only JSON matching the requested schema.

Files:
${summaries}

Available Ledger context:
${analysis}

Current Git diff:
${diff}

Fields:
- title: one short Conventional Commit subject using type(scope): description. Scope is optional. Keep it under 72 characters and do not end with punctuation.
- body: always an empty string.

Style:
- Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore.
- Describe the user-visible or developer-facing change, not the mechanics of editing files.
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
