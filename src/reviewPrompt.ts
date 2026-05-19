import { MAX_EXPLANATIONS_PER_HUNK } from "./constants"
import { retrieveReviewContext, type RetrievedContext } from "./context"
import { blockStale, lineRangeText } from "./domain"
import type { LedgerFile, LedgerScope } from "./types"
import { limitText } from "./utils"

export type ReviewPrompt = {
  prompt: string
  context: Omit<RetrievedContext, "rendered">
  hunks: { id: string; hash: string; changedLines: string; diffLines: string }[]
}

// Edit this block to tune Ledger's review voice. Keep the output JSON contract intact.
const REVIEW_EXPLANATION_GUIDANCE = `
Write explanations like a helpful teammate who understands the surrounding work.

The explanation is shown directly in Ledger. It should feel natural, concise, and useful without exposing how Ledger found context.

Do:
- Focus on purpose and behavior more than syntax.
- Use background silently to infer why the change exists.
- Keep simple changes short.
- Group related changed lines into logical explanation ranges.
- Split large change blocks when different parts serve different purposes, affect different functions, or change different behavior.
- Prefer function-level or behavior-level ranges for large rewrites.
- For complex logic, explain the flow in plain language; use pseudocode only if it is clearer than prose.
- If intent is unclear, say that naturally without over-explaining.

Do not:
- Merely restate the visible changed text.
- Tell the reviewer what to approve or reject.
- Use fixed headings or separate sections.
- Mention internal review machinery such as hunk, diff, line range, matched edit context, opencode, session, message, tool, ID, JSON, schema, or prompt.
- Say approve, reject, should be kept, safe, low risk, high risk, or similar approval language unless there is a concrete behavioral concern that needs to be understood.

Examples:
Bad: Adds a blank separator and the standalone text \`Assistant edit-context test line\` near the end of the Markdown file.
Good: This marker was added while testing Ledger's handling of assistant-made edits.

Bad: Adds \`Manual edit-context test line\` after the fenced metadata block.
Good: This looks like a manual marker for testing how Ledger distinguishes human-made changes.

Good for complex code: This moves the cache lookup before the network call so repeated requests can return from memory instead of re-fetching. Misses still continue through the existing request path.
`.trim()

function numberedDiff(block: LedgerFile["blocks"][number]) {
  return block.patch
    .split("\n")
    .map((line, index) => `${block.diffStartLine + index + 1}: ${line}`)
    .join("\n")
}

export async function buildReviewPrompt(scope: LedgerScope, file: LedgerFile): Promise<ReviewPrompt> {
  const context = await retrieveReviewContext(scope, file)
  const hunkSummaries: ReviewPrompt["hunks"] = []
  const hunks = file.blocks
    .map((block) => {
      const prior = blockStale(block) ? `\nPrior explanation for an older version:\n${block.review!.explanations.map((item) => item.explanation).join("\n")}\n` : ""
      const changedLines = lineRangeText(block)
      const diffLines = `${block.diffStartLine + 1}-${block.diffEndLine + 1}`
      hunkSummaries.push({ id: block.id, hash: block.hash, changedLines, diffLines })
      return `Change block ID: ${block.id}\nChanged file lines: ${changedLines}\nDiff line range for JSON startLine/endLine: ${diffLines}${prior}\n\`\`\`diff\n${numberedDiff(block)}\n\`\`\``
    })
    .join("\n\n")

  const prompt = `You are analyzing one changed file for Ledger.\n\nUse plan-mode analysis behavior. Do not edit files. The current Git diff is the source of truth for implementation details. Background may explain why a change exists, but it can be incomplete. Do not invent intent when the reason is not clear.\n\nLedger approval blocks are Git hunks internally. Keep their IDs exactly as given in the JSON response, but never mention blocks, hunks, diffs, line ranges, or internal IDs inside explanation text. Return one hunk entry for every Change block ID below.\n\nReturn only JSON matching the requested schema.\n\nPath: ${file.path}\n\nBackground by change block:\n${context.rendered || "(not available)"}\n\nFull current Git diff for this file:\n\`\`\`diff\n${limitText(file.patch, 9000)}\n\`\`\`\n\nChange blocks to explain:\n${hunks}\n\nFields:\n- impact: high, medium, or low for the whole file based on semantic review risk.\n- hunks: one entry for every Change block ID above. The id must exactly match.\n- explanations: annotations inside that change block. Use the 1-based diff line numbers shown in the numbered diff for startLine/endLine. Cover the changed lines. Context-only lines may be omitted unless needed. Prefer 1-${MAX_EXPLANATIONS_PER_HUNK} useful ranges per change block. Multiple related lines should share one explanation. For large change blocks, do not collapse unrelated logic into one explanation. Split by function, branch, lifecycle step, helper, call site, or behavior. Do not create one explanation per line unless each line truly has a distinct role.\n- explanation: one compact, human-friendly explanation for the selected range.\n\nExplanation style:\n${REVIEW_EXPLANATION_GUIDANCE}\n`

  const { rendered: _rendered, ...debugContext } = context
  return { prompt, context: debugContext, hunks: hunkSummaries }
}
