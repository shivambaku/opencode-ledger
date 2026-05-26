// @bun
// src/tui.tsx
import {insert as _$insert3} from "@opentui/solid";
import {createTextNode as _$createTextNode2} from "@opentui/solid";
import {insertNode as _$insertNode3} from "@opentui/solid";
import {createElement as _$createElement3} from "@opentui/solid";
import {createComponent as _$createComponent3} from "@opentui/solid";

// src/constants.ts
var ROUTE = "ledger";
var MAX_EXPLANATIONS_PER_HUNK = 8;
var REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    impact: { type: "string", enum: ["high", "medium", "low"] },
    hunks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          explanations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                startLine: { type: "number" },
                endLine: { type: "number" },
                explanation: { type: "string" }
              },
              required: ["startLine", "endLine", "explanation"]
            }
          }
        },
        required: ["id", "explanations"]
      }
    }
  },
  required: ["impact", "hunks"]
};
var COMMIT_MESSAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    body: { type: "string" }
  },
  required: ["title", "body"]
};
var impactRank = { high: 0, medium: 1, low: 2 };
var ledgerActionConfigs = [
  { action: "down", command: "ledger.down", commandKey: "down", desc: "Move", keys: ["j", "down"] },
  { action: "up", command: "ledger.up", commandKey: "up", desc: "Move", keys: ["k", "up"] },
  { action: "nextFile", command: "ledger.nextFile", commandKey: "shift+j", desc: "Next file", keys: ["shift+j"], aliases: ["J"] },
  { action: "prevFile", command: "ledger.prevFile", commandKey: "shift+k", desc: "Previous file", keys: ["shift+k"], aliases: ["K"] },
  { action: "diffLeft", command: "ledger.diffLeft", commandKey: "h", desc: "Scroll left", keys: ["h"] },
  { action: "diffRight", command: "ledger.diffRight", commandKey: "l", desc: "Scroll right", keys: ["l"] },
  { action: "yank", command: "ledger.yank", commandKey: "y", desc: "Yank diff block", keys: ["y"] },
  { action: "yankComments", command: "ledger.yankComments", commandKey: "shift+y", desc: "Yank unresolved comments", keys: ["shift+y"], aliases: ["Y"] },
  { action: "comment", command: "ledger.comment", commandKey: "c", desc: "Add or edit comment", keys: ["c"] },
  { action: "approve", command: "ledger.approve", commandKey: "space", desc: "Toggle approval", keys: ["space"], aliases: [" "] },
  { action: "editor", command: "ledger.editor", commandKey: "e", desc: "Open editor", keys: ["e"] },
  { action: "inspect", command: "ledger.inspect", commandKey: "enter", desc: "Toggle inspect/focus", keys: ["enter"], aliases: ["return"] },
  { action: "explanation", command: "ledger.explanation", commandKey: "tab", desc: "Toggle explanation", keys: ["tab"], aliases: ["\t"] },
  { action: "layout", command: "ledger.layout", commandKey: "|", desc: "Toggle layout", keys: ["|"] },
  { action: "analyze", command: "ledger.analyze", commandKey: "a", desc: "Analyze file", keys: ["a"] },
  { action: "analyzeAll", command: "ledger.analyzeAll", commandKey: "shift+a", desc: "Analyze pending files", keys: ["shift+a"], aliases: ["A"] },
  { action: "commitMessage", command: "ledger.commitMessage", commandKey: "m", desc: "Generate commit message", keys: ["m"] },
  { action: "stop", command: "ledger.stop", commandKey: "x", desc: "Stop analysis", keys: ["x"] },
  { action: "diffDown", command: "ledger.diffDown", commandKey: "ctrl+d", desc: "Scroll down", keys: ["ctrl+d"], aliases: ["\x04"] },
  { action: "diffUp", command: "ledger.diffUp", commandKey: "ctrl+u", desc: "Scroll up", keys: ["ctrl+u"], aliases: ["\x15"] },
  { action: "prevBlock", command: "ledger.prevBlock", commandKey: "shift+n", desc: "Previous block", keys: ["shift+n"], aliases: ["N"] },
  { action: "nextBlock", command: "ledger.nextBlock", commandKey: "n", desc: "Next block", keys: ["n"] },
  { action: "help", command: "ledger.help", commandKey: "?", desc: "Show help", keys: ["?"], aliases: ["shift+/"] },
  { action: "back", command: "ledger.back", commandKey: "escape", desc: "Back or close ledger", keys: ["escape"] },
  { action: "close", command: "ledger.close", commandKey: "q", desc: "Close ledger", keys: ["q"] }
];
var command = Object.fromEntries(ledgerActionConfigs.map((item) => [item.action, item.command]));
var ledgerKeyBindings = ledgerActionConfigs.flatMap((item) => item.keys.map((key) => ({ key, action: item.action, desc: item.desc })));

// src/utils.ts
import {readFileSync} from "fs";
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function isImpact(value) {
  return value === "high" || value === "medium" || value === "low";
}
function normalizePath(path) {
  return path.replaceAll("\\", "/");
}
function filename(path) {
  const normalized = normalizePath(path);
  return normalized.split("/").pop() || normalized;
}
function parseRouteParams(params) {
  return {
    sessionID: typeof params?.sessionID === "string" ? params.sessionID : undefined,
    directory: typeof params?.directory === "string" ? params.directory : undefined,
    index: typeof params?.index === "number" ? params.index : 0,
    scroll: typeof params?.scroll === "number" ? params.scroll : 0
  };
}
function clip(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function hashString(value) {
  let hash = 2166136261;
  for (let i = 0;i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
var normalizedPatchForHash = function(patch) {
  return patch.split("\n").filter((line) => !line.startsWith("@@")).join("\n");
};
function patchHash(path, patch) {
  return hashString(`${path}\n${normalizedPatchForHash(patch)}`);
}
function readWorkspaceFile(directory, path) {
  try {
    return readFileSync(`${directory}/${path}`, "utf8");
  } catch {
    return "";
  }
}
function fileLines(content) {
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (!normalized)
    return [];
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "")
    lines.pop();
  return lines;
}
var commonPrefixLength = function(beforeLines, afterLines) {
  let index = 0;
  while (index < beforeLines.length && index < afterLines.length && beforeLines[index] === afterLines[index])
    index++;
  return index;
};
var changedEnds = function(beforeLines, afterLines, start) {
  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (beforeEnd >= start && afterEnd >= start && beforeLines[beforeEnd] === afterLines[afterEnd]) {
    beforeEnd--;
    afterEnd--;
  }
  return { beforeEnd, afterEnd };
};
var hunkHeader = function(contextStart, beforeContextEnd, afterContextEnd) {
  const oldCount = Math.max(0, beforeContextEnd - contextStart + 1);
  const newCount = Math.max(0, afterContextEnd - contextStart + 1);
  return `@@ -${contextStart + 1},${oldCount} +${contextStart + 1},${newCount} @@`;
};
function unifiedDiff(path, before, after, fallback) {
  if (typeof before !== "string" || typeof after !== "string")
    return fallback;
  if (before === after)
    return fallback;
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const start = commonPrefixLength(beforeLines, afterLines);
  const { beforeEnd, afterEnd } = changedEnds(beforeLines, afterLines, start);
  const contextStart = Math.max(0, start - 3);
  const beforeContextEnd = Math.min(beforeLines.length - 1, beforeEnd + 3);
  const afterContextEnd = Math.min(afterLines.length - 1, afterEnd + 3);
  const out = [`--- ${path}`, `+++ ${path}`, hunkHeader(contextStart, beforeContextEnd, afterContextEnd)];
  for (let i = contextStart;i < start; i++)
    out.push(` ${beforeLines[i] ?? ""}`);
  for (let i = start;i <= beforeEnd; i++)
    out.push(`-${beforeLines[i] ?? ""}`);
  for (let i = start;i <= afterEnd; i++)
    out.push(`+${afterLines[i] ?? ""}`);
  for (let i = Math.max(start, afterEnd + 1);i <= afterContextEnd; i++)
    out.push(` ${afterLines[i] ?? ""}`);
  return out.join("\n");
}
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function splitCommand(value) {
  return value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^(["'])(.*)\1$/, "$2")) ?? [];
}
function wrapText(text, width = 74) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      if (!line)
        line = word;
      else if (line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else
        line = `${line} ${word}`;
    }
    lines.push(line || " ");
  }
  return lines;
}
function splitWidths(total, ratio, minLeft, minRight, maxLeft = total) {
  const available = Math.max(1, total - 1);
  const highestLeft = Math.max(1, Math.min(maxLeft, available - minRight));
  const lowestLeft = Math.min(minLeft, highestLeft);
  const left = clip(Math.floor(available * ratio), lowestLeft, highestLeft);
  return { left, right: Math.max(1, available - left) };
}
function limitText(text, max = 6000) {
  if (text.length <= max)
    return text;
  return `${text.slice(0, max)}\n...[truncated]`;
}
function textFromParts(parts) {
  return parts.map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "").filter(Boolean).join("\n");
}
function errorMessage(error) {
  return error instanceof Error ? error.message : "Unknown error.";
}

// src/domain.ts
function blockReviewed(block) {
  return block.review?.hash === block.hash;
}
function blockStale(block) {
  return !!block.review && block.review.hash !== block.hash;
}
function blockApproved(block) {
  return block.resolved;
}
function blockComment(block) {
  const comment = block.comment?.trim();
  return comment || undefined;
}
function blockHasUnresolvedComment(block) {
  return !block.resolved && !!blockComment(block);
}
var fileAnalyzed = function(file) {
  return file.analysis?.hash === file.hash && file.blocks.every(blockReviewed);
};
function fileNeedsAnalysis(file) {
  return !fileAnalyzed(file);
}
function fileNeedsApproval(file) {
  return file.blocks.some((block) => !blockApproved(block));
}
function fileApproved(file) {
  return !fileNeedsApproval(file);
}
function unresolvedCommentCount(files) {
  return files.reduce((sum, file) => sum + file.blocks.filter(blockHasUnresolvedComment).length, 0);
}
function fileImpact(file) {
  if (fileAnalyzed(file))
    return file.analysis.impact;
  return "?";
}
var approvalProgress = function(file) {
  const complete = file.blocks.filter(blockApproved).length;
  return `${complete}/${file.blocks.length || 1}`;
};
var fileStatus = function(file) {
  return file.status ?? "modified";
};
function fileStatusMark(file) {
  const status = fileStatus(file);
  if (status === "added")
    return "A";
  if (status === "deleted")
    return "D";
  return "M";
}
function lineRangeText(block) {
  const start = block.newStart || block.oldStart || 1;
  const end = block.newEnd || block.oldEnd || start;
  return `${start}-${Math.max(start, end)}`;
}
function fileRow(file, analyzing, analyzingText = "...") {
  const impact = analyzing ? analyzingText : fileImpact(file);
  return `${approvalProgress(file).padEnd(5)} ${impact.padEnd(6)}`;
}
function blockLabel(file, block) {
  return `${file.path}:${lineRangeText(block)}`;
}
function codeFiletype(path) {
  const name = filename(path).toLowerCase();
  if (name.endsWith(".vue"))
    return "typescript";
  if (name.endsWith(".tsx"))
    return "typescriptreact";
  if (name.endsWith(".ts"))
    return "typescript";
  if (name.endsWith(".jsx"))
    return "javascriptreact";
  if (name.endsWith(".js"))
    return "javascript";
  if (name.endsWith(".md"))
    return "markdown";
  if (name.endsWith(".json"))
    return "json";
  if (name.endsWith(".rs"))
    return "rust";
  return;
}

// src/storage.ts
import {existsSync, mkdirSync, readFileSync as readFileSync2, renameSync, rmSync, statSync, writeFileSync} from "fs";
import {dirname, join} from "path";
var ledgerScopeIDForDirectory = function(directory) {
  return hashString(normalizePath(directory || "unknown"));
};
function ledgerScope(api) {
  return ledgerScopeForDirectory(api.state.path.worktree || api.state.path.directory);
}
var ledgerScopeForDirectory = function(directory) {
  const resolved = directory || "unknown";
  return { id: ledgerScopeIDForDirectory(resolved), directory: resolved };
};
var statePath = function(scope) {
  return join(scope.directory, STATE_FILE);
};
var opencodeIgnorePath = function(scope) {
  return join(scope.directory, OPENCODE_IGNORE_FILE);
};
var hasLedgerIgnoreEntry = function(content) {
  return content.split(/\r?\n/).some((line) => {
    const entry = line.trim();
    if (!entry || entry.startsWith("#") || entry.startsWith("!"))
      return false;
    const normalized = entry.replace(/\/+$/, "");
    return normalized === "ledger" || normalized === "/ledger";
  });
};
function ensureLedgerIgnored(scope) {
  const path = opencodeIgnorePath(scope);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, `${LEDGER_IGNORE_ENTRY}\n`);
    return;
  }
  const content = readFileSync2(path, "utf8");
  if (hasLedgerIgnoreEntry(content))
    return;
  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  writeFileSync(path, `${content}${separator}${LEDGER_IGNORE_ENTRY}\n`);
}
var isLedgerState = function(value) {
  if (!isRecord(value) || !isRecord(value.scopes))
    return false;
  return Object.values(value.scopes).every((files) => Array.isArray(files) && files.every(isLedgerFile));
};
var readState = function(scope) {
  const path = statePath(scope);
  if (!existsSync(path))
    return { scopes: {} };
  const parsed = JSON.parse(readFileSync2(path, "utf8"));
  return isLedgerState(parsed) ? parsed : { scopes: {} };
};
var writeState = function(scope, state) {
  const path = statePath(scope);
  mkdirSync(dirname(path), { recursive: true });
  ensureLedgerIgnored(scope);
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
};
function readFilesForScope(scope) {
  return readState(scope).scopes[scope.id] ?? [];
}
var mergeFileState = function(incoming, latest) {
  if (!latest || latest.hash !== incoming.hash)
    return incoming;
  const latestBlocks = new Map(latest.blocks.map((block) => [block.id, block]));
  const blocks = incoming.blocks.map((block) => {
    const current = latestBlocks.get(block.id);
    if (!current || current.hash !== block.hash)
      return block;
    const review = current.review?.hash === block.hash && (!block.review || current.review.generatedAt > block.review.generatedAt) ? current.review : block.review;
    return current.updatedAt > block.updatedAt ? { ...block, resolved: current.resolved, comment: current.comment, updatedAt: current.updatedAt, review } : { ...block, review };
  });
  const analysis = latest.analysis?.hash === incoming.hash && (!incoming.analysis || latest.analysis.generatedAt > incoming.analysis.generatedAt) ? latest.analysis : incoming.analysis;
  return { ...incoming, analysis, blocks, updatedAt: Math.max(incoming.updatedAt, latest.updatedAt) };
};
function writeFilesForScope(scope, files) {
  const state = readState(scope);
  const latest = new Map((state.scopes[scope.id] ?? []).map((file) => [file.id, file]));
  state.scopes[scope.id] = files.map((file) => mergeFileState(file, latest.get(file.id)));
  writeState(scope, state);
}
function ledgerStateVersion(scope) {
  try {
    return statSync(statePath(scope)).mtimeMs;
  } catch {
    return 0;
  }
}
var isLedgerFile = function(value) {
  if (!isRecord(value))
    return false;
  return typeof value.id === "string" && typeof value.path === "string" && typeof value.content === "string" && typeof value.patch === "string" && typeof value.hash === "string" && (value.status === undefined || value.status === "modified" || value.status === "added" || value.status === "deleted") && typeof value.additions === "number" && typeof value.deletions === "number" && typeof value.updatedAt === "number" && (value.analysis === undefined || isFileAnalysis(value.analysis)) && Array.isArray(value.blocks) && value.blocks.every(isLedgerBlock);
};
var isFileAnalysis = function(value) {
  if (!isRecord(value))
    return false;
  return typeof value.hash === "string" && isImpact(value.impact) && typeof value.generatedAt === "number";
};
var isLedgerBlock = function(value) {
  if (!isRecord(value))
    return false;
  return typeof value.id === "string" && typeof value.fileID === "string" && typeof value.patch === "string" && typeof value.hash === "string" && typeof value.diffStartLine === "number" && typeof value.diffEndLine === "number" && typeof value.oldStart === "number" && typeof value.oldEnd === "number" && typeof value.newStart === "number" && typeof value.newEnd === "number" && typeof value.additions === "number" && typeof value.deletions === "number" && typeof value.resolved === "boolean" && (value.comment === undefined || typeof value.comment === "string") && typeof value.updatedAt === "number" && (value.review === undefined || isBlockReview(value.review));
};
var isBlockReview = function(value) {
  if (!isRecord(value))
    return false;
  return typeof value.hash === "string" && typeof value.generatedAt === "number" && Array.isArray(value.explanations) && value.explanations.every(isBlockExplanation);
};
var isBlockExplanation = function(value) {
  if (!isRecord(value))
    return false;
  return typeof value.diffStartLine === "number" && typeof value.diffEndLine === "number" && typeof value.explanation === "string";
};
var orderedFiles = function(files) {
  return [...files].sort((a, b) => {
    const aApproved = fileApproved(a);
    const bApproved = fileApproved(b);
    if (aApproved !== bApproved)
      return aApproved ? 1 : -1;
    const aImpact = fileImpact(a);
    const bImpact = fileImpact(b);
    if (isImpact(aImpact) && isImpact(bImpact))
      return impactRank[aImpact] - impactRank[bImpact];
    if (isImpact(aImpact) !== isImpact(bImpact))
      return isImpact(aImpact) ? -1 : 1;
    return a.path.localeCompare(b.path) || b.updatedAt - a.updatedAt;
  });
};
function routeScope(api, directory) {
  return directory ? ledgerScopeForDirectory(directory) : ledgerScope(api);
}
function ledgerFiles(scope) {
  const files = readFilesForScope(scope);
  return orderedFiles(files);
}
var updateFile = function(scope, id, update) {
  writeFilesForScope(scope, readFilesForScope(scope).map((file) => file.id === id ? update(file) : file));
};
function setFileAnalysisResult(scope, id, hash, analysis, reviews) {
  updateFile(scope, id, (file) => {
    if (file.hash !== hash)
      return file;
    const now = Date.now();
    return {
      ...file,
      analysis,
      blocks: file.blocks.map((block) => ({ ...block, review: reviews.get(block.id) ?? block.review, updatedAt: now })),
      updatedAt: now
    };
  });
}
var updateBlock = function(scope, fileID, blockID, update) {
  updateFile(scope, fileID, (file) => ({
    ...file,
    blocks: file.blocks.map((block) => block.id === blockID ? update(block) : block),
    updatedAt: Date.now()
  }));
};
function currentFile(scope, id) {
  return readFilesForScope(scope).find((file) => file.id === id);
}
function setBlockResolved(scope, fileID, blockID, resolved) {
  updateBlock(scope, fileID, blockID, (block) => ({ ...block, resolved, updatedAt: Date.now() }));
}
function setBlockComment(scope, fileID, blockID, comment) {
  updateBlock(scope, fileID, blockID, (block) => ({ ...block, comment, updatedAt: Date.now() }));
}
function setFileResolved(scope, fileID, resolved) {
  updateFile(scope, fileID, (file) => ({ ...file, blocks: file.blocks.map((block) => ({ ...block, resolved, updatedAt: Date.now() })), updatedAt: Date.now() }));
}
var STATE_FILE = ".opencode/ledger/state.json";
var OPENCODE_IGNORE_FILE = ".opencode/.gitignore";
var LEDGER_IGNORE_ENTRY = "/ledger/";

// src/git.ts
function parseHunk(line) {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match)
    return;
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? 1)
  };
}
var advanceDiffLine = function(line, counters) {
  if (line.startsWith("+"))
    counters.newLine++;
  else if (line.startsWith("-"))
    counters.oldLine++;
  else if (line.startsWith(" ")) {
    counters.oldLine++;
    counters.newLine++;
  }
};
var parseBlocks = function(diff) {
  const lines = diff.split("\n");
  const blocks = [];
  let current;
  function finishBlock() {
    if (!current)
      return;
    if (current.additions || current.deletions) {
      const oldStart = current.oldStart || current.oldLine;
      const oldEnd = current.oldEnd || oldStart;
      const newStart = current.newStart || current.newLine;
      const newEnd = current.newEnd || newStart;
      blocks.push({ id: `b${blocks.length + 1}`, patch: current.lines.join("\n"), diffStartLine: current.diffStartLine, diffEndLine: current.diffEndLine, oldStart, oldEnd, newStart, newEnd, additions: current.additions, deletions: current.deletions });
    }
    current = undefined;
  }
  for (let index = 0;index < lines.length; index++) {
    const line = lines[index];
    const nextHunk = parseHunk(line);
    if (nextHunk) {
      finishBlock();
      current = { id: `b${blocks.length + 1}`, lines: [line], diffStartLine: index, diffEndLine: index, oldStart: 0, oldEnd: 0, newStart: 0, newEnd: 0, additions: 0, deletions: 0, oldLine: nextHunk.oldStart, newLine: nextHunk.newStart };
      continue;
    }
    if (!current)
      continue;
    current.lines.push(line);
    current.diffEndLine = index;
    if (line.startsWith("+")) {
      current.newStart ||= current.newLine;
      current.newEnd = current.newLine;
      current.additions++;
    } else if (line.startsWith("-")) {
      current.oldStart ||= current.oldLine;
      current.oldEnd = current.oldLine;
      current.deletions++;
    }
    advanceDiffLine(line, current);
  }
  finishBlock();
  if (blocks.length)
    return blocks;
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
      deletions: lines.filter((line) => line.startsWith("-") && !line.startsWith("--- ")).length
    }
  ];
};
var gitPatchPath = function(value) {
  const path = value.trim().replace(/^"(.*)"$/, "$1");
  if (!path || path === "/dev/null")
    return "";
  return normalizePath(path.replace(/^[ab]\//, ""));
};
var fileDiffsFromRawPatch = function(raw) {
  const sections = [];
  let current;
  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current?.length)
        sections.push(current);
      current = [line];
    } else if (current)
      current.push(line);
  }
  if (current?.length)
    sections.push(current);
  const diffs = [];
  for (const lines of sections) {
    let oldPath = "";
    let newPath = "";
    let status;
    for (const line of lines) {
      if (line.startsWith("--- "))
        oldPath = gitPatchPath(line.slice(4));
      else if (line.startsWith("+++ "))
        newPath = gitPatchPath(line.slice(4));
      else if (line.startsWith("new file mode"))
        status = "added";
      else if (line.startsWith("deleted file mode"))
        status = "deleted";
    }
    const path = newPath || oldPath;
    if (!path)
      continue;
    diffs.push({
      file: path,
      patch: lines.join("\n"),
      additions: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++ ")).length,
      deletions: lines.filter((line) => line.startsWith("-") && !line.startsWith("--- ")).length,
      status: status ?? (oldPath ? "modified" : "added")
    });
  }
  return diffs;
};
var existingBlockIndex = function(existing) {
  return {
    byID: new Map(existing?.blocks.map((block) => [block.id, block]) ?? []),
    byHash: new Map(existing?.blocks.map((block) => [block.hash, block]) ?? [])
  };
};
var blockFromParsed = function(fileID, path, block, index, existing) {
  const id = `${fileID}:${block.id ?? `b${index + 1}`}`;
  const hash = patchHash(path, block.patch);
  const previous = existing.byID.get(id) ?? existing.byHash.get(hash);
  const unchanged = previous?.hash === hash;
  const now = Date.now();
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
    resolved: unchanged ? previous?.resolved ?? false : false,
    comment: unchanged ? previous?.comment : undefined,
    updatedAt: unchanged ? previous?.updatedAt ?? now : now,
    review: unchanged ? previous?.review : undefined
  };
};
var filePatch = function(input, path, additions, deletions) {
  if (typeof input.patch === "string" && input.patch.trim())
    return input.patch;
  const fallback = `${input.status ?? "modified"} ${path}\n+${additions} additions, ${deletions} deletions`;
  return unifiedDiff(path, input.before, input.after, fallback);
};
var fileStatus2 = function(value) {
  if (value === "added" || value === "deleted")
    return value;
  return "modified";
};
var fileFromDiff = function(input, existing, directory) {
  const path = normalizePath(input.file ?? input.path ?? "");
  if (!path)
    return;
  const content = readWorkspaceFile(directory, path);
  const additions = Math.max(0, input.additions ?? 0);
  const deletions = Math.max(0, input.deletions ?? 0);
  const status = fileStatus2(input.status);
  const patch = filePatch(input, path, additions, deletions);
  const id = path;
  const hash = patchHash(path, patch);
  if (existing?.hash === hash && existing.analysis?.hash === hash && existing.blocks.length) {
    return { ...existing, content, patch, status, additions, deletions };
  }
  const existingBlocks = existingBlockIndex(existing);
  const blocks = parseBlocks(patch).map((block, index) => blockFromParsed(id, path, block, index, existingBlocks));
  return {
    id,
    path,
    content,
    patch,
    hash,
    status,
    additions,
    deletions,
    updatedAt: existing?.hash === hash ? existing.updatedAt ?? Date.now() : Date.now(),
    analysis: existing?.hash === hash ? existing.analysis : undefined,
    blocks
  };
};
async function replaceWorkspaceDiffs(scope, diffs) {
  const previous = readFilesForScope(scope);
  const filesByID = new Map(previous.map((file) => [file.id, file]));
  const currentIDs = new Set;
  for (const diff of diffs) {
    if (!isRecord(diff))
      continue;
    const path = normalizePath(String(diff.file ?? diff.path ?? ""));
    const file = fileFromDiff(diff, filesByID.get(path), scope.directory);
    if (file) {
      filesByID.set(file.id, file);
      currentIDs.add(file.id);
    }
  }
  writeFilesForScope(scope, [...filesByID.values()].filter((file) => currentIDs.has(file.id)));
}
async function reconcileWorkspaceDiff(api, scope, shouldApply) {
  const raw = await api.client.vcs.diff2.raw({ directory: scope.directory });
  if (shouldApply && !shouldApply())
    return false;
  if (!raw.error && typeof raw.data === "string") {
    await replaceWorkspaceDiffs(scope, fileDiffsFromRawPatch(raw.data));
    return true;
  }
  const result = await api.client.vcs.diff({ directory: scope.directory, mode: "git" });
  if (result.error || !result.data)
    throw new Error("Failed to refresh Git diff for Ledger.");
  if (shouldApply && !shouldApply())
    return false;
  await replaceWorkspaceDiffs(scope, result.data);
  return true;
}

// src/runtime.ts
import {spawn} from "child_process";
var writeOsc52 = function(text) {
  if (!process.stdout.isTTY)
    return false;
  const sequence = `\x1B]52;c;${Buffer.from(text).toString("base64")}\x07`;
  process.stdout.write(process.env.TMUX || process.env.STY ? `\x1BPtmux;\x1B${sequence}\x1B\\` : sequence);
  return true;
};
var writeWithStdin = function(command2, args, text) {
  return new Promise((resolve) => {
    const child = spawn(command2, args, { stdio: ["pipe", "ignore", "ignore"] });
    let settled = false;
    const finish = (ok) => {
      if (settled)
        return;
      settled = true;
      resolve(ok);
    };
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
    child.stdin.on("error", () => finish(false));
    child.stdin.end(text);
  });
};
async function writeNativeClipboard(text) {
  if (process.platform === "darwin")
    return writeWithStdin("pbcopy", [], text);
  if (process.platform !== "linux")
    return false;
  const commands = process.env.WAYLAND_DISPLAY ? [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]] : [["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]], ["wl-copy", []]];
  for (const [command2, args] of commands) {
    if (await writeWithStdin(command2, args, text))
      return true;
  }
  return false;
}
var currentSessionID = function(api) {
  const route = api.route.current;
  if (route.name !== "session")
    return;
  const params = route.params ?? {};
  return typeof params.sessionID === "string" ? params.sessionID : undefined;
};
function activeLedger(api) {
  return api.route.current.name === ROUTE && !api.ui.dialog.open;
}
function openLedger(api) {
  api.ui.dialog.clear();
  const sessionID = currentSessionID(api);
  api.route.navigate(ROUTE, { sessionID, directory: api.state.path.worktree || api.state.path.directory, index: 0, scroll: 0 });
}
function closeLedger(api) {
  const route = api.route.current;
  const state = route.name === ROUTE ? parseRouteParams(route.params) : undefined;
  if (state?.sessionID)
    api.route.navigate("session", { sessionID: state.sessionID });
  else
    api.route.navigate("home");
}
var blockDiffBody = function(block) {
  return block.patch.split("\n").filter((line) => !parseHunk(line)).join("\n").trimEnd();
};
var formatCommentedBlock = function(file, block) {
  const comment = blockComment(block);
  const body = blockDiffBody(block);
  if (!comment)
    return body;
  return `${blockLabel(file, block)}\n\nComment:\n${comment}\n\nDiff:\n${body}`;
};
async function writeClipboard(api, body) {
  if (!body)
    return false;
  let renderer = false;
  try {
    renderer = api.renderer.copyToClipboardOSC52(body);
  } catch {
  }
  const osc52 = renderer ? false : writeOsc52(body);
  const native = await writeNativeClipboard(body);
  return renderer || osc52 || native;
}
async function yankBlockToClipboard(api, file, block) {
  return writeClipboard(api, formatCommentedBlock(file, block));
}
async function yankUnresolvedCommentsToClipboard(api, files) {
  const blocks = files.flatMap((file) => file.blocks.filter(blockHasUnresolvedComment).map((block) => ({ file, block })));
  const body = blocks.map(({ file, block }) => formatCommentedBlock(file, block)).join("\n\n---\n\n");
  return { count: blocks.length, ok: await writeClipboard(api, `# Ledger Comments\n\n${body}`) };
}

// src/ui/LedgerScreen.tsx
import {memo as _$memo} from "@opentui/solid";
import {createComponent as _$createComponent2} from "@opentui/solid";
import {effect as _$effect2} from "@opentui/solid";
import {use as _$use} from "@opentui/solid";
import {createTextNode as _$createTextNode} from "@opentui/solid";
import {insertNode as _$insertNode2} from "@opentui/solid";
import {insert as _$insert2} from "@opentui/solid";
import {setProp as _$setProp2} from "@opentui/solid";
import {createElement as _$createElement2} from "@opentui/solid";
import {useTerminalDimensions} from "@opentui/solid";
import {createEffect, createMemo, createSignal, For, onCleanup, onMount, Show as Show2} from "solid-js";

// src/analysis.ts
import {mkdirSync as mkdirSync2, writeFileSync as writeFileSync2} from "fs";
import {join as join3} from "path";

// src/commitPrompt.ts
var commitQuality = function(files) {
  const totalFiles = files.length;
  const analyzedFiles = files.filter((file) => !fileNeedsAnalysis(file)).length;
  const reviewedBlocks = files.reduce((sum, file) => sum + file.blocks.filter(blockReviewed).length, 0);
  const commentedBlocks = files.reduce((sum, file) => sum + file.blocks.filter((block) => !!blockComment(block)).length, 0);
  const quality = analyzedFiles === totalFiles ? "full" : analyzedFiles || reviewedBlocks || commentedBlocks ? "partial" : "diff-only";
  return { quality, analyzedFiles, totalFiles };
};
var fileSummary = function(file) {
  const status = file.status ?? "modified";
  return `${status} ${file.path} (+${file.additions}/-${file.deletions})`;
};
var analysisSummary = function(file) {
  const impact = file.analysis?.hash === file.hash ? `Impact: ${file.analysis.impact}` : undefined;
  const blocks = file.blocks.flatMap((block) => {
    const review = blockReviewed(block) ? block.review : undefined;
    const comment = blockComment(block);
    if (!review && !comment)
      return [];
    return [
      [
        `Lines ${lineRangeText(block)}${block.resolved ? " (approved)" : ""}`,
        ...comment ? [`Reviewer comment: ${comment}`] : [],
        ...review ? review.explanations.map((item) => `Explanation: ${item.explanation}`) : []
      ].join("\n")
    ];
  });
  if (!impact && !blocks.length)
    return "";
  return [`File: ${file.path}`, ...impact ? [impact] : [], ...blocks].join("\n");
};
function buildCommitMessagePrompt(files) {
  const quality = commitQuality(files);
  const summaries = files.map(fileSummary).join("\n");
  const analysis = limitText(files.map(analysisSummary).filter(Boolean).join("\n\n"), 8000) || "(none available)";
  const diff = limitText(files.map((file) => `File: ${file.path}\n\`\`\`diff\n${file.patch}\n\`\`\``).join("\n\n"), 18000);
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
`;
  return { prompt, ...quality };
}

// src/contextLookup.ts
import {Database} from "bun:sqlite";
import {existsSync as existsSync2} from "fs";
import {homedir} from "os";
import {basename, join as join2} from "path";
var opencodeDbPath = function() {
  return join2(homedir(), ".local/share/opencode/opencode.db");
};
var jsonParse = function(value) {
  try {
    return JSON.parse(value);
  } catch {
    return;
  }
};
var jsonText = function(value, path) {
  let current = value;
  for (const key of path)
    current = isRecord(current) ? current[key] : undefined;
  return typeof current === "string" ? current : "";
};
var messageRole = function(row) {
  const data = jsonParse(row.data);
  return isRecord(data) && typeof data.role === "string" ? data.role : "message";
};
var changedLines = function(block) {
  const lines = new Set;
  for (const line of block.patch.split("\n")) {
    if (!line.startsWith("+") && !line.startsWith("-") || line.startsWith("+++") || line.startsWith("---"))
      continue;
    const text = line.slice(1).trim();
    if (text.length >= 4)
      lines.add(text);
  }
  return [...lines];
};
var candidateNeedles = function(scope, file) {
  const absolute = normalizePath(join2(scope.directory, file.path));
  const relative = normalizePath(file.path);
  const name = basename(relative);
  return { absolute, relative, name };
};
var cleanPath = function(value) {
  return normalizePath(value.trim().replace(/^"(.*)"$/, "$1").replace(/\t.*$/, "").replace(/^[ab]\//, ""));
};
var targetMatches = function(scope, file, value) {
  const { absolute, relative } = candidateNeedles(scope, file);
  const path = cleanPath(value);
  return path === absolute || path === relative || path.endsWith(`/${relative}`);
};
var diffSections = function(diff) {
  const sections = [];
  let current = [];
  for (const line of diff.split("\n")) {
    if ((line.startsWith("Index: ") || line.startsWith("diff --git ")) && current.length) {
      sections.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length)
    sections.push(current);
  return sections.map((lines) => lines.join("\n"));
};
var sectionPaths = function(section) {
  const paths = [];
  for (const line of section.split("\n")) {
    if (line.startsWith("Index: "))
      paths.push(cleanPath(line.slice("Index: ".length)));
    else if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const path = cleanPath(line.slice(4));
      if (path && path !== "/dev/null")
        paths.push(path);
    } else if (line.startsWith("diff --git ")) {
      const parts = line.split(/\s+/);
      if (parts[2])
        paths.push(cleanPath(parts[2]));
      if (parts[3])
        paths.push(cleanPath(parts[3]));
    }
  }
  return paths;
};
var patchTextPaths = function(patchText) {
  const paths = [];
  for (const line of patchText.split("\n")) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (match)
      paths.push(cleanPath(match[1]));
  }
  return paths;
};
var targetToolText = function(data, scope, file) {
  const state = isRecord(data) ? data.state : undefined;
  const input = isRecord(state) ? state.input : undefined;
  const metadata = isRecord(state) ? state.metadata : undefined;
  const inputPath = jsonText(input, ["filePath"]) || jsonText(input, ["path"]);
  const diff = jsonText(metadata, ["diff"]);
  const patchText = jsonText(input, ["patchText"]);
  const chunks = [];
  const targetPaths = [];
  if (diff) {
    for (const section of diffSections(diff)) {
      const paths = sectionPaths(section);
      if (paths.some((path) => targetMatches(scope, file, path))) {
        chunks.push(section);
        targetPaths.push(...paths);
      }
    }
  }
  if (patchText) {
    const paths = patchTextPaths(patchText);
    if (paths.some((path) => targetMatches(scope, file, path))) {
      chunks.push(patchText);
      targetPaths.push(...paths);
    }
  }
  if (inputPath && targetMatches(scope, file, inputPath)) {
    chunks.push([jsonText(input, ["oldString"]), jsonText(input, ["newString"]), jsonText(input, ["content"]), inputPath].filter(Boolean).join("\n"));
    targetPaths.push(inputPath);
  }
  return {
    text: chunks.filter(Boolean).join("\n"),
    paths: [...new Set(targetPaths.map(cleanPath))]
  };
};
var scoreCandidate = function(row, scope, file, block) {
  const data = jsonParse(row.data);
  if (!isRecord(data))
    return;
  const tool = typeof data.tool === "string" ? data.tool : "tool";
  const target = targetToolText(data, scope, file);
  const text = target.text;
  if (!text)
    return;
  const { absolute, relative } = candidateNeedles(scope, file);
  const lines = changedLines(block);
  const reasons = [];
  const matchedLines = [];
  let score = 0;
  if (target.paths.some((path) => path === absolute || path.endsWith(`/${relative}`))) {
    score += 45;
    reasons.push("absolute file path");
  } else if (target.paths.includes(relative)) {
    score += 40;
    reasons.push("relative file path");
  }
  for (const line of lines) {
    const add = `+${line}`;
    const remove = `-${line}`;
    if (text.includes(add) || text.includes(remove)) {
      score += 35;
      matchedLines.push(line);
    } else if (text.includes(line)) {
      score += 20;
      matchedLines.push(line);
    }
  }
  if (!reasons.length || !matchedLines.length || score < 75)
    return;
  reasons.push(`${matchedLines.length} changed line${matchedLines.length === 1 ? "" : "s"}`);
  return {
    hunkID: block.id,
    sessionID: row.sessionID,
    sessionTitle: row.title,
    messageID: row.messageID,
    partID: row.partID,
    tool,
    score,
    timeCreated: row.timeCreated,
    reasons,
    matchedLines,
    includedMessageIDs: [],
    text
  };
};
var messageText = function(parts, messageID) {
  return parts.filter((part) => part.messageID === messageID).map((part) => {
    const data = jsonParse(part.data);
    return isRecord(data) && data.type === "text" && typeof data.text === "string" ? data.text : "";
  }).filter(Boolean).join("\n");
};
var compactText = function(value, max = 700) {
  return limitText(value.trim().replace(/\s+/g, " "), max);
};
var renderMatch = function(db, match) {
  const messages = db.query("SELECT id, time_created AS timeCreated, data FROM message WHERE session_id = ? ORDER BY time_created, id").all(match.sessionID);
  const matchIndex = messages.findIndex((message) => message.id === match.messageID);
  if (matchIndex < 0)
    return "";
  let start = matchIndex;
  while (start > 0 && messageRole(messages[start]) !== "user")
    start--;
  const end = Math.min(messages.length - 1, matchIndex + 1);
  const window = messages.slice(start, end + 1);
  const parts = db.query(`SELECT id, message_id AS messageID, data FROM part WHERE session_id = ? AND message_id IN (${window.map(() => "?").join(",")}) ORDER BY time_created, id`).all(match.sessionID, ...window.map((message) => message.id));
  match.includedMessageIDs = window.map((message) => message.id);
  const rendered = [];
  for (const message of window) {
    const role = messageRole(message).toUpperCase();
    const text = messageText(parts, message.id);
    if (text.trim())
      rendered.push(`${role === "USER" ? "User request" : "Assistant note"}: ${compactText(text, 900)}`);
    if (message.id === match.messageID)
      rendered.push(`Matched changed text: ${match.matchedLines.map((line) => `\`${line}\``).join(", ")}`);
  }
  return rendered.join("\n\n");
};
function retrieveReviewContextSync(scope, file) {
  const dbPath = opencodeDbPath();
  if (!existsSync2(dbPath))
    return { source: "workspace", dbPath, matches: [], totalIncludedChars: 0, rendered: "" };
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const { absolute, relative, name } = candidateNeedles(scope, file);
      const rows = db.query(`SELECT p.id AS partID, p.message_id AS messageID, p.session_id AS sessionID, p.time_created AS timeCreated, p.data, s.title
           FROM part p JOIN session s ON s.id = p.session_id
           WHERE s.directory = ?
             AND json_extract(p.data, '\$.type') = 'tool'
             AND json_extract(p.data, '\$.state.status') = 'completed'
             AND json_extract(p.data, '\$.tool') IN ('apply_patch', 'edit', 'write')
             AND (p.data LIKE ? OR p.data LIKE ? OR p.data LIKE ?)
           ORDER BY p.time_created DESC
           LIMIT 200`).all(scope.directory, `%${absolute}%`, `%${relative}%`, `%${name}%`);
      const matches = [];
      const sections = [];
      for (const block of file.blocks) {
        const match = rows.map((row) => scoreCandidate(row, scope, file, block)).filter((item) => !!item).sort((a, b) => b.score - a.score || b.timeCreated - a.timeCreated)[0];
        if (match) {
          const rendered2 = renderMatch(db, match);
          matches.push(match);
          sections.push(`Change block ${block.id}:\n${rendered2 || "(not available)"}`);
        } else
          sections.push(`Change block ${block.id}:\n(not available)`);
      }
      const rendered = limitText(sections.join("\n\n---\n\n"), 7000);
      const debugMatches = matches.map(({ text: _text, ...match }) => match);
      return { source: debugMatches.length ? "opencode-db" : "workspace", dbPath, matches: debugMatches, totalIncludedChars: rendered.length, rendered };
    } finally {
      db.close();
    }
  } catch (error) {
    return { source: "workspace", dbPath, matches: [], totalIncludedChars: 0, rendered: "", error: error instanceof Error ? error.message : String(error) };
  }
}

// src/context.ts
var contextCacheKey = function(scope, file) {
  return `${scope.directory}\0${file.path}\0${file.hash}`;
};
async function retrieveReviewContext(scope, file) {
  const cacheKey = contextCacheKey(scope, file);
  const cached = contextCache.get(cacheKey);
  if (cached)
    return cached;
  if (typeof Worker === "undefined") {
    const result = retrieveReviewContextSync(scope, file);
    contextCache.set(cacheKey, result);
    return result;
  }
  return new Promise((resolve) => {
    let settled = false;
    let worker;
    let timer;
    const finish = (result) => {
      if (settled)
        return;
      settled = true;
      if (timer)
        clearTimeout(timer);
      worker?.terminate();
      contextCache.set(cacheKey, result);
      resolve(result);
    };
    const fallback = (error) => {
      const result = retrieveReviewContextSync(scope, file);
      finish(error && !result.error ? { ...result, error: error instanceof Error ? error.message : String(error) } : result);
    };
    try {
      worker = new Worker(new URL("./contextWorker.ts", import.meta.url), { type: "module" });
      timer = setTimeout(() => fallback(new Error("Context lookup timed out.")), 1e4);
      worker.onmessage = (event) => finish(event.data);
      worker.onerror = (event) => fallback(event instanceof ErrorEvent ? event.error || event.message : event);
      worker.postMessage({ scope, file });
    } catch (error) {
      fallback(error);
    }
  });
}
var contextCache = new Map;

// src/reviewPrompt.ts
var numberedDiff = function(block) {
  return block.patch.split("\n").map((line, index) => `${block.diffStartLine + index + 1}: ${line}`).join("\n");
};
async function buildReviewPrompt(scope, file) {
  const context2 = await retrieveReviewContext(scope, file);
  const hunkSummaries = [];
  const hunks = file.blocks.map((block) => {
    const prior = blockStale(block) ? `\nPrior explanation for an older version:\n${block.review.explanations.map((item) => item.explanation).join("\n")}\n` : "";
    const changedLines2 = lineRangeText(block);
    const diffLines = `${block.diffStartLine + 1}-${block.diffEndLine + 1}`;
    hunkSummaries.push({ id: block.id, hash: block.hash, changedLines: changedLines2, diffLines });
    return `Change block ID: ${block.id}\nChanged file lines: ${changedLines2}\nDiff line range for JSON startLine/endLine: ${diffLines}${prior}\n\`\`\`diff\n${numberedDiff(block)}\n\`\`\``;
  }).join("\n\n");
  const prompt = `You are analyzing one changed file for Ledger.\n\nUse plan-mode analysis behavior. Do not edit files. The current Git diff is the source of truth for implementation details. Background may explain why a change exists, but it can be incomplete. Do not invent intent when the reason is not clear.\n\nLedger approval blocks are Git hunks internally. Keep their IDs exactly as given in the JSON response, but never mention blocks, hunks, diffs, line ranges, or internal IDs inside explanation text. Return one hunk entry for every Change block ID below.\n\nReturn only JSON matching the requested schema.\n\nPath: ${file.path}\n\nBackground by change block:\n${context2.rendered || "(not available)"}\n\nFull current Git diff for this file:\n\`\`\`diff\n${limitText(file.patch, 9000)}\n\`\`\`\n\nChange blocks to explain:\n${hunks}\n\nFields:\n- impact: high, medium, or low for the whole file based on semantic review risk.\n- hunks: one entry for every Change block ID above. The id must exactly match.\n- explanations: annotations inside that change block. Use the 1-based diff line numbers shown in the numbered diff for startLine/endLine. Cover the changed lines. Context-only lines may be omitted unless needed. Prefer 1-${MAX_EXPLANATIONS_PER_HUNK} useful ranges per change block. Multiple related lines should share one explanation. For large change blocks, do not collapse unrelated logic into one explanation. Split by function, branch, lifecycle step, helper, call site, or behavior. Do not create one explanation per line unless each line truly has a distinct role.\n- explanation: one compact, human-friendly explanation for the selected range.\n\nExplanation style:\n${REVIEW_EXPLANATION_GUIDANCE}\n`;
  const { rendered: _rendered, ...debugContext } = context2;
  return { prompt, context: debugContext, hunks: hunkSummaries };
}
var REVIEW_EXPLANATION_GUIDANCE = `
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
`.trim();

// src/analysis.ts
var debugEnabled = function() {
  return true;
};
var debugFileName = function(path) {
  return path.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "file";
};
var writeAnalysisDebug = function(scope, file, analysisSessionID, request, response, error, model) {
  if (!debugEnabled())
    return;
  try {
    const dir = join3(scope.directory, ".opencode/ledger/debug");
    mkdirSync2(dir, { recursive: true });
    ensureLedgerIgnored(scope);
    const createdAt = Date.now();
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
      error: error ? error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) } : null
    };
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    const timestamp = new Date(createdAt).toISOString().replace(/[:.]/g, "-");
    writeFileSync2(join3(dir, `${timestamp}__${debugFileName(file.path)}.json`), text);
    writeFileSync2(join3(dir, "latest.json"), text);
  } catch {
  }
};
var parseAnalysisModel = function(value) {
  if (value === undefined)
    return;
  if (typeof value !== "string")
    throw new Error("Invalid Ledger model option. Expected provider/model-id.");
  const model = value.trim();
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1)
    throw new Error("Invalid Ledger model option. Expected provider/model-id.");
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
};
var parseCommitMessageValue = function(value, meta) {
  const parsed = typeof value === "string" ? parseJsonObject(value) : value;
  if (!isRecord(parsed) || typeof parsed.title !== "string" || typeof parsed.body !== "string") {
    throw new Error("Commit message response did not match the expected schema.");
  }
  const title = parsed.title.split(/\r?\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (!title)
    throw new Error("Commit message response did not include a title.");
  const body = parsed.body.trim();
  return { ...meta, title, body, text: title };
};
var parseJsonObject = function(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start)
    throw new Error("Review response was not JSON.");
  return JSON.parse(trimmed.slice(start, end + 1));
};
var parseAnalysisPayload = function(value) {
  const parsed = typeof value === "string" ? parseJsonObject(value) : value;
  if (!isRecord(parsed) || !isImpact(parsed.impact) || !Array.isArray(parsed.hunks)) {
    throw new Error("Analysis response did not match the expected schema.");
  }
  return { impact: parsed.impact, hunks: parsed.hunks };
};
var parseHunkHeader = function(value, blocksByID, used) {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.explanations))
    throw new Error("Analysis response did not match the expected hunk schema.");
  if (used.has(value.id))
    throw new Error("Analysis response included a hunk more than once.");
  const block = blocksByID.get(value.id);
  if (!block)
    throw new Error("Analysis response referenced an unknown hunk.");
  used.add(value.id);
  return { block, explanations: value.explanations };
};
var parseExplanation = function(value, block) {
  if (!isRecord(value) || typeof value.startLine !== "number" || typeof value.endLine !== "number" || typeof value.explanation !== "string")
    throw new Error("Analysis response did not match the expected explanation schema.");
  const start = clip(Math.floor(Math.min(value.startLine, value.endLine)) - 1, block.diffStartLine, block.diffEndLine);
  const end = clip(Math.floor(Math.max(value.startLine, value.endLine)) - 1, block.diffStartLine, block.diffEndLine);
  return { diffStartLine: start, diffEndLine: end, explanation: value.explanation.trim() || "No explanation returned." };
};
var parseBlockReview = function(value, blocksByID, used, generatedAt) {
  const { block, explanations: rawExplanations } = parseHunkHeader(value, blocksByID, used);
  const explanations = rawExplanations.slice(0, MAX_EXPLANATIONS_PER_HUNK).map((item) => parseExplanation(item, block)).sort((a, b) => a.diffStartLine - b.diffStartLine || a.diffEndLine - b.diffEndLine);
  if (!explanations.length)
    throw new Error("Analysis response included a hunk without explanations.");
  return { id: block.id, review: { hash: block.hash, generatedAt, explanations } };
};
var parseAnalysisValue = function(value, file) {
  const parsed = parseAnalysisPayload(value);
  const blocksByID = new Map(file.blocks.map((block) => [block.id, block]));
  const used = new Set;
  const generatedAt = Date.now();
  const reviews = new Map;
  for (const hunk of parsed.hunks) {
    const { id, review } = parseBlockReview(hunk, blocksByID, used, generatedAt);
    reviews.set(id, review);
  }
  for (const block of file.blocks) {
    if (!used.has(block.id))
      throw new Error("Analysis response did not include every block.");
  }
  return {
    analysis: { hash: file.hash, impact: parsed.impact, generatedAt },
    reviews
  };
};
async function abortSession(api, scope, sessionID) {
  try {
    await api.client.session.abort({ sessionID, directory: scope.directory });
  } catch {
  }
}
async function deleteSession(api, scope, sessionID) {
  try {
    await api.client.session.delete({ sessionID, directory: scope.directory });
  } catch {
  }
}
async function createAnalysisSession(api, scope, shouldContinue, model, title = "Ledger analysis") {
  if (!shouldContinue())
    throw new Error("Analysis stopped.");
  const result = await api.client.session.create({
    directory: scope.directory,
    title,
    agent: "plan",
    model: model ? { providerID: model.providerID, id: model.modelID } : undefined
  });
  if (result.error || !result.data)
    throw new Error("Failed to create Ledger analysis session.");
  if (!shouldContinue()) {
    await abortSession(api, scope, result.data.id);
    await deleteSession(api, scope, result.data.id);
    throw new Error("Analysis stopped.");
  }
  return result.data.id;
}
async function requestAnalysis(api, scope, file, shouldContinue, modelOption, onSession) {
  const model = parseAnalysisModel(modelOption);
  const sessionID = await createAnalysisSession(api, scope, shouldContinue, model);
  onSession?.(sessionID);
  if (!shouldContinue())
    throw new Error("Analysis stopped.");
  const request = await buildReviewPrompt(scope, file);
  let response;
  try {
    const result = await api.client.session.prompt({
      sessionID,
      directory: scope.directory,
      agent: "plan",
      model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
      format: { type: "json_schema", schema: REVIEW_SCHEMA },
      parts: [{ type: "text", text: request.prompt }]
    });
    if (result.error || !result.data) {
      response = { rawText: result.error ? JSON.stringify(result.error) : undefined };
      throw new Error("Ledger analysis failed.");
    }
    response = { structured: result.data.info.structured, rawText: textFromParts(result.data.parts) };
    const parsed = result.data.info.structured !== undefined ? parseAnalysisValue(result.data.info.structured, file) : parseAnalysisValue(response.rawText ?? "", file);
    writeAnalysisDebug(scope, file, sessionID, request, response, undefined, model);
    return parsed;
  } catch (error) {
    writeAnalysisDebug(scope, file, sessionID, request, response, error, model);
    throw error;
  }
}
async function requestCommitMessage(api, scope, files, shouldContinue, modelOption, onSession) {
  if (!files.length)
    throw new Error("No uncommitted Git changes.");
  const model = parseAnalysisModel(modelOption);
  const request = buildCommitMessagePrompt(files);
  const sessionID = await createAnalysisSession(api, scope, shouldContinue, model, "Ledger commit message");
  onSession?.(sessionID);
  if (!shouldContinue())
    throw new Error("Analysis stopped.");
  const result = await api.client.session.prompt({
    sessionID,
    directory: scope.directory,
    agent: "plan",
    model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
    format: { type: "json_schema", schema: COMMIT_MESSAGE_SCHEMA },
    parts: [{ type: "text", text: request.prompt }]
  });
  if (result.error || !result.data)
    throw new Error("Commit message generation failed.");
  const meta = { quality: request.quality, analyzedFiles: request.analyzedFiles, totalFiles: request.totalFiles };
  return result.data.info.structured !== undefined ? parseCommitMessageValue(result.data.info.structured, meta) : parseCommitMessageValue(textFromParts(result.data.parts), meta);
}

// src/display.ts
function blockHunkStart(block) {
  const hunk = parseHunk(block.patch.split("\n")[0] ?? "");
  const start = hunk?.newStart ?? block.newStart;
  return Math.max(1, start || 1);
}
var firstChangedDiffLineForBlock = function(block) {
  const lines = block.patch.split("\n");
  const changed = lines.findIndex((line) => line.startsWith("+") && !line.startsWith("+++ ") || line.startsWith("-") && !line.startsWith("--- "));
  return block.diffStartLine + Math.max(0, changed);
};
var deletionAnchorFileLine = function(block, totalLines) {
  if (totalLines <= 0)
    return;
  return clip(blockHunkStart(block), 1, totalLines);
};
var walkBlockPatch = function(block, visit) {
  let newLine = blockHunkStart(block);
  const lines = block.patch.split("\n");
  for (let index = 0;index < lines.length; index++) {
    const line = lines[index];
    const hunk = parseHunk(line);
    if (hunk) {
      newLine = Math.max(1, hunk.newStart);
      continue;
    }
    if (line.startsWith("\\"))
      continue;
    visit(line, newLine, block.diffStartLine + index);
    if (line.startsWith("+") || line.startsWith(" "))
      newLine++;
  }
  return newLine;
};
var blockFileLines = function(block, totalLines) {
  const result = [];
  walkBlockPatch(block, (line, newLine) => {
    if (line.startsWith("+") || line.startsWith(" ")) {
      if (newLine >= 1)
        result.push(newLine);
    }
  });
  if (!result.length) {
    const anchor = deletionAnchorFileLine(block, totalLines);
    if (anchor !== undefined)
      result.push(anchor);
  }
  return result;
};
function blockContainsFileLine(block, fileLine, totalLines) {
  return blockFileLines(block, totalLines).includes(fileLine);
}
function blockForFileLine(file, fileLine) {
  if (!file || fileLine === undefined)
    return;
  const totalLines = fileLines(file.content).length;
  return file.blocks.find((block) => blockContainsFileLine(block, fileLine, totalLines));
}
function diffLineForFileLine(block, fileLine) {
  if (fileLine === undefined)
    return firstChangedDiffLineForBlock(block);
  let match;
  walkBlockPatch(block, (line, newLine, diffLineIndex) => {
    if (match === undefined && (line.startsWith("+") || line.startsWith(" ")) && newLine === fileLine)
      match = diffLineIndex;
  });
  return match ?? firstChangedDiffLineForBlock(block);
}
function buildDisplayRows(file, base) {
  const content = fileLines(file.content);
  const rows = [];
  const blocks = [...file.blocks].sort((a, b) => blockHunkStart(a) - blockHunkStart(b) || a.diffStartLine - b.diffStartLine);
  const blocksByFileLine = new Map;
  let nextFileLine = 1;
  for (const block of blocks) {
    for (const fileLine of blockFileLines(block, content.length)) {
      if (!blocksByFileLine.has(fileLine))
        blocksByFileLine.set(fileLine, block);
    }
  }
  function push(row) {
    rows.push({ ...row, rowIndex: rows.length });
  }
  function pushFileLine(fileLine) {
    const block = blocksByFileLine.get(fileLine);
    push({ key: `${base}:file:${fileLine}`, line: content[fileLine - 1] ?? "", kind: "code", fileLine, blockID: block?.id, diffLineIndex: block ? diffLineForFileLine(block, fileLine) : undefined });
  }
  function pushBlockRows(block) {
    return walkBlockPatch(block, (line, newLine, diffLineIndex) => {
      if (line.startsWith("+")) {
        push({ key: `${base}:${block.id}:${diffLineIndex}`, line, kind: "add", blockID: block.id, diffLineIndex, fileLine: newLine });
      } else if (line.startsWith("-")) {
        push({ key: `${base}:${block.id}:${diffLineIndex}`, line, kind: "delete", blockID: block.id, diffLineIndex });
      } else if (line.startsWith(" ")) {
        push({ key: `${base}:${block.id}:${diffLineIndex}`, line: line.slice(1), kind: "code", blockID: block.id, diffLineIndex, fileLine: newLine });
      }
    });
  }
  for (const block of blocks) {
    if (block.resolved)
      continue;
    const start = blockHunkStart(block);
    while (nextFileLine < start && nextFileLine <= content.length)
      pushFileLine(nextFileLine++);
    nextFileLine = Math.max(nextFileLine, pushBlockRows(block));
  }
  while (nextFileLine <= content.length)
    pushFileLine(nextFileLine++);
  return rows;
}

// src/editor.ts
var editorCommand = function(editor, file, line) {
  const parts = splitCommand(editor);
  const executable = filename(parts[0] ?? editor).toLowerCase();
  const base = parts.map(shellQuote).join(" ");
  if (["code", "cursor", "windsurf", "code-insiders"].includes(executable))
    return `${base} -g ${shellQuote(`${file}:${line}`)}`;
  if (["vim", "nvim", "vi"].includes(executable))
    return `${base} +${line} ${shellQuote(file)}`;
  return `${base} ${shellQuote(file)}`;
};
async function openEditor(api, scope, file, block) {
  const editor = process.env.VISUAL || "nvim";
  if (!editor) {
    return { text: "Set VISUAL or EDITOR to open files from Ledger.", fg: "#f6b26b" };
  }
  const line = block.newStart || block.oldStart || 1;
  const path = `${scope.directory}/${file.path}`;
  const command2 = editorCommand(editor, path, line);
  const bun = globalThis.Bun;
  if (!bun?.spawn) {
    return { text: "Bun.spawn is unavailable in this plugin runtime.", fg: "#f6b26b" };
  }
  try {
    api.renderer.suspend();
    api.renderer.currentRenderBuffer.clear();
    const proc = bun.spawn(["sh", "-lc", command2], {
      cwd: scope.directory,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit"
    });
    const code = await proc.exited;
    if (code !== 0) {
      return { text: `Editor exited with status ${code}.`, fg: "#f6b26b" };
    }
  } catch (error) {
    return { text: error instanceof Error ? error.message : "Failed to open editor.", fg: "#f6b26b" };
  } finally {
    api.renderer.currentRenderBuffer.clear();
    api.renderer.resume();
    api.renderer.requestRender();
  }
  return { text: `Opened ${file.path}.`, fg: "#3ee06f" };
}

// src/keys.ts
var modifiedKey = function(key, value) {
  if (key.ctrl)
    return `ctrl+${value.toLowerCase()}`;
  if (key.shift)
    return `shift+${value.toLowerCase()}`;
  return value;
};
function ledgerAction(key) {
  const value = key.name || key.sequence;
  if (!value)
    return;
  return keyActions.get(modifiedKey(key, value)) ?? keyActions.get(value);
}
var keyActions = new Map;
for (const item of ledgerActionConfigs) {
  for (const key of [...item.keys, ...item.aliases ?? []])
    keyActions.set(key, item.action);
}

// src/ui/DiffLine.tsx
import {insertNode as _$insertNode} from "@opentui/solid";
import {createComponent as _$createComponent} from "@opentui/solid";
import {effect as _$effect} from "@opentui/solid";
import {insert as _$insert} from "@opentui/solid";
import {setProp as _$setProp} from "@opentui/solid";
import {createElement as _$createElement} from "@opentui/solid";
import {Show} from "solid-js";

// src/ui/styles.ts
import {SyntaxStyle} from "@opentui/core";
var lineColor = function(line) {
  if (line.startsWith("+++ ") || line.startsWith("--- "))
    return "#a8b3cf";
  if (line.startsWith("+"))
    return "#3ee06f";
  if (line.startsWith("-"))
    return "#ff6572";
  if (line.startsWith("@@"))
    return "#8fb4ff";
  if (line.startsWith("Index:") || line.startsWith("="))
    return "#a8b3cf";
  return "#c8d0e8";
};
function rowColor(kind, line) {
  if (kind === "code")
    return "#c8d0e8";
  return lineColor(line);
}
var lineBackground = function(line) {
  if (line.startsWith("+++ ") || line.startsWith("--- "))
    return;
  if (line.startsWith("+"))
    return "#082813";
  if (line.startsWith("-"))
    return "#2f1017";
  if (line.startsWith("@@"))
    return "#111a31";
  return;
};
function rowBackground(kind, line) {
  if (kind === "code")
    return;
  return lineBackground(line);
}
var activeLineBackground = function(line) {
  if (line.startsWith("+++ ") || line.startsWith("--- "))
    return "#25314a";
  if (line.startsWith("+"))
    return "#145c2b";
  if (line.startsWith("-"))
    return "#6b1d26";
  if (line.startsWith("@@"))
    return "#24395e";
  return "#1b2540";
};
function activeRowBackground(kind, line) {
  if (kind === "code")
    return "#1b2540";
  return activeLineBackground(line);
}
function codeSyntax(api) {
  const theme = api.theme.current;
  return SyntaxStyle.fromStyles({
    default: { fg: theme.text },
    comment: { fg: theme.syntaxComment, italic: true },
    string: { fg: theme.syntaxString },
    number: { fg: theme.syntaxNumber },
    boolean: { fg: theme.syntaxNumber },
    keyword: { fg: theme.syntaxKeyword, italic: true },
    operator: { fg: theme.syntaxOperator },
    punctuation: { fg: theme.syntaxPunctuation },
    variable: { fg: theme.syntaxVariable },
    property: { fg: theme.syntaxVariable },
    function: { fg: theme.syntaxFunction },
    "function.call": { fg: theme.syntaxFunction },
    type: { fg: theme.syntaxType },
    module: { fg: theme.syntaxType },
    constant: { fg: theme.syntaxNumber }
  });
}

// src/ui/DiffLine.tsx
function DiffLine(props) {
  const line = () => props.line;
  const codeLine = () => !!props.path;
  const backgroundColor = () => {
    if (props.active)
      return activeRowBackground(props.kind, line());
    return rowBackground(props.kind, line());
  };
  const gutter = () => props.blockActive ? "\u258C " : "  ";
  const gutterColor = () => {
    if (!props.blockActive)
      return "#263149";
    if (props.blockResolved) {
      if (props.active)
        return "#3ee06f";
      return props.explanationActive ? "#65f090" : "#2f8f4e";
    }
    if (props.active)
      return "#86aef5";
    return props.explanationActive ? "#b8d0ff" : "#3e5f99";
  };
  const width = () => Math.max(1, props.width);
  const contentWidth = () => Math.max(1, width() - 2);
  const codeContent = () => (props.kind === "add" || props.kind === "delete" ? line().slice(1) : line()) || " ";
  const visibleContent = () => codeContent().slice(props.scrollX) || " ";
  const textColor = () => rowColor(props.kind, line());
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$setProp(_el$, "overflow", "hidden");
    _$setProp(_el$, "flexDirection", "row");
    _$setProp(_el$2, "width", 2);
    _$setProp(_el$2, "truncate", true);
    _$setProp(_el$2, "wrapMode", "none");
    _$insert(_el$2, gutter);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return codeLine();
      },
      get fallback() {
        return (() => {
          var _el$4 = _$createElement("text");
          _$setProp(_el$4, "wrapMode", "none");
          _$insert(_el$4, visibleContent);
          _$effect((_p$) => {
            var _v$8 = contentWidth(), _v$9 = textColor();
            _v$8 !== _p$.e && (_p$.e = _$setProp(_el$4, "width", _v$8, _p$.e));
            _v$9 !== _p$.t && (_p$.t = _$setProp(_el$4, "fg", _v$9, _p$.t));
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$4;
        })();
      },
      get children() {
        var _el$3 = _$createElement("code");
        _$setProp(_el$3, "drawUnstyledText", true);
        _$setProp(_el$3, "wrapMode", "none");
        _$effect((_p$) => {
          var _v$ = contentWidth(), _v$2 = visibleContent(), _v$3 = props.filetype, _v$4 = props.syntaxStyle;
          _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "width", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp(_el$3, "content", _v$2, _p$.t));
          _v$3 !== _p$.a && (_p$.a = _$setProp(_el$3, "filetype", _v$3, _p$.a));
          _v$4 !== _p$.o && (_p$.o = _$setProp(_el$3, "syntaxStyle", _v$4, _p$.o));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined
        });
        return _el$3;
      }
    }), null);
    _$effect((_p$) => {
      var _v$5 = width(), _v$6 = backgroundColor(), _v$7 = gutterColor();
      _v$5 !== _p$.e && (_p$.e = _$setProp(_el$, "width", _v$5, _p$.e));
      _v$6 !== _p$.t && (_p$.t = _$setProp(_el$, "backgroundColor", _v$6, _p$.t));
      _v$7 !== _p$.a && (_p$.a = _$setProp(_el$2, "fg", _v$7, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$;
  })();
}

// src/ui/LedgerScreen.tsx
var analyzingDots = function(frame) {
  return ".".repeat(frame % 3 + 1);
};
var CommentDialog = function(props) {
  let textarea;
  const dim = useTerminalDimensions();
  const [draft, setDraft] = createSignal(props.initialValue);
  const width = () => Math.min(96, Math.max(44, dim().width - 8));
  const height = () => Math.min(18, Math.max(10, dim().height - 6));
  const innerWidth = () => Math.max(1, width() - 4);
  const bodyHeight = () => Math.max(3, height() - 7);
  const left = () => Math.max(0, Math.floor((dim().width - width()) / 2));
  const top = () => Math.max(1, Math.floor((dim().height - height()) / 2));
  function save() {
    props.onSave(textarea?.plainText ?? draft());
  }
  function handleKey(event) {
    if (event.name !== "escape")
      return;
    event.preventDefault();
    event.stopPropagation();
    props.onCancel();
  }
  onMount(() => {
    setTimeout(() => {
      if (!textarea)
        return;
      textarea.focus();
      textarea.cursorOffset = textarea.plainText.length;
    }, 0);
  });
  return (() => {
    var _el$ = _$createElement2("box"), _el$2 = _$createElement2("text"), _el$3 = _$createElement2("b"), _el$4 = _$createElement2("text"), _el$6 = _$createElement2("box"), _el$7 = _$createElement2("textarea"), _el$8 = _$createElement2("text"), _el$0 = _$createElement2("text");
    _$insertNode2(_el$, _el$2);
    _$insertNode2(_el$, _el$4);
    _$insertNode2(_el$, _el$6);
    _$insertNode2(_el$, _el$8);
    _$insertNode2(_el$, _el$0);
    _$setProp2(_el$, "position", "absolute");
    _$setProp2(_el$, "zIndex", 20);
    _$setProp2(_el$, "border", true);
    _$setProp2(_el$, "borderColor", "#86aef5");
    _$setProp2(_el$, "backgroundColor", "#090d16");
    _$setProp2(_el$, "paddingLeft", 2);
    _$setProp2(_el$, "paddingRight", 2);
    _$setProp2(_el$, "paddingTop", 1);
    _$setProp2(_el$, "paddingBottom", 1);
    _$setProp2(_el$, "flexDirection", "column");
    _$insertNode2(_el$2, _el$3);
    _$setProp2(_el$2, "fg", "#f0f4ff");
    _$setProp2(_el$2, "truncate", true);
    _$setProp2(_el$2, "wrapMode", "none");
    _$insert2(_el$3, () => props.title);
    _$insertNode2(_el$4, _$createTextNode(` `));
    _$setProp2(_el$4, "fg", "#8b96b8");
    _$insertNode2(_el$6, _el$7);
    _$setProp2(_el$6, "overflow", "hidden");
    _$use((node) => {
      textarea = node;
    }, _el$7);
    _$setProp2(_el$7, "focused", true);
    _$setProp2(_el$7, "showCursor", true);
    _$setProp2(_el$7, "wrapMode", "word");
    _$setProp2(_el$7, "textColor", "#d5dcf6");
    _$setProp2(_el$7, "focusedTextColor", "#f0f4ff");
    _$setProp2(_el$7, "backgroundColor", "#090d16");
    _$setProp2(_el$7, "focusedBackgroundColor", "#090d16");
    _$setProp2(_el$7, "placeholder", "Add a comment for this block...");
    _$setProp2(_el$7, "placeholderColor", "#5e6a86");
    _$setProp2(_el$7, "keyBindings", commentKeyBindings);
    _$setProp2(_el$7, "onSubmit", save);
    _$setProp2(_el$7, "onContentChange", setDraft);
    _$setProp2(_el$7, "onKeyPress", handleKey);
    _$insertNode2(_el$8, _$createTextNode(` `));
    _$setProp2(_el$8, "fg", "#8b96b8");
    _$insertNode2(_el$0, _$createTextNode(`enter save shift+enter newline esc cancel`));
    _$setProp2(_el$0, "fg", "#8b96b8");
    _$setProp2(_el$0, "truncate", true);
    _$setProp2(_el$0, "wrapMode", "none");
    _$effect2((_p$) => {
      var _v$ = left(), _v$2 = top(), _v$3 = width(), _v$4 = height(), _v$5 = innerWidth(), _v$6 = innerWidth(), _v$7 = bodyHeight(), _v$8 = innerWidth(), _v$9 = bodyHeight(), _v$0 = props.initialValue, _v$1 = innerWidth();
      _v$ !== _p$.e && (_p$.e = _$setProp2(_el$, "left", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$, "top", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp2(_el$, "width", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp2(_el$, "height", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp2(_el$2, "width", _v$5, _p$.i));
      _v$6 !== _p$.n && (_p$.n = _$setProp2(_el$6, "width", _v$6, _p$.n));
      _v$7 !== _p$.s && (_p$.s = _$setProp2(_el$6, "height", _v$7, _p$.s));
      _v$8 !== _p$.h && (_p$.h = _$setProp2(_el$7, "width", _v$8, _p$.h));
      _v$9 !== _p$.r && (_p$.r = _$setProp2(_el$7, "height", _v$9, _p$.r));
      _v$0 !== _p$.d && (_p$.d = _$setProp2(_el$7, "initialValue", _v$0, _p$.d));
      _v$1 !== _p$.l && (_p$.l = _$setProp2(_el$0, "width", _v$1, _p$.l));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined,
      r: undefined,
      d: undefined,
      l: undefined
    });
    return _el$;
  })();
};
function LedgerScreen(props) {
  let root;
  const dim = useTerminalDimensions();
  const route = parseRouteParams(props.params);
  const syntaxStyle = codeSyntax(props.api);
  const [cursor, setCursor] = createSignal(route.index);
  const [scroll, setScroll] = createSignal(route.scroll);
  const [diffScroll, setDiffScroll] = createSignal(0);
  const [diffScrollX, setDiffScrollX] = createSignal(0);
  const [diffCursor, setDiffCursor] = createSignal(0);
  const [explanationScroll, setExplanationScroll] = createSignal(0);
  const [inspectFocus, setInspectFocus] = createSignal("diff");
  const [inspectLayout, setInspectLayout] = createSignal("bottom");
  const [explanationVisible, setExplanationVisible] = createSignal(false);
  const [helpVisible, setHelpVisible] = createSignal(false);
  const [helpCursor, setHelpCursor] = createSignal(0);
  const [helpScroll, setHelpScroll] = createSignal(0);
  const [inspect, setInspect] = createSignal(false);
  const [commentEditor, setCommentEditor] = createSignal();
  const [revision, setRevision] = createSignal(0);
  const [analyzingIDs, setAnalyzingIDs] = createSignal(new Set);
  const [generatingCommitMessage, setGeneratingCommitMessage] = createSignal(false);
  const [analyzingFrame, setAnalyzingFrame] = createSignal(0);
  const [notice, setNotice] = createSignal();
  let noticeTimer;
  const scope = createMemo(() => routeScope(props.api, route.directory));
  const scopeID = () => scope().id;
  const files = createMemo(() => {
    revision();
    return ledgerFiles(scope());
  });
  const approvedBlocks = createMemo(() => files().reduce((sum, file) => sum + file.blocks.filter(blockApproved).length, 0));
  const totalBlocks = createMemo(() => files().reduce((sum, file) => sum + file.blocks.length, 0));
  const commentCount = createMemo(() => unresolvedCommentCount(files()));
  const visibleRows = () => Math.max(5, dim().height - 7);
  const inspectRows = () => Math.max(8, dim().height - 7);
  const bottomExplanationHeight = () => clip(Math.floor(inspectRows() * 0.38), 4, Math.max(4, inspectRows() - 5));
  const bottomDiffHeight = () => Math.max(5, inspectRows() - bottomExplanationHeight());
  const bottomExplanationLayout = () => inspect() && explanationVisible() && inspectLayout() === "bottom";
  const diffVisibleRows = () => bottomExplanationLayout() ? Math.max(1, bottomDiffHeight() - 4) : Math.max(6, dim().height - 7);
  const explanationVisibleRows = () => bottomExplanationLayout() ? Math.max(1, bottomExplanationHeight() - 2) : Math.max(6, dim().height - 7);
  const index = () => clip(cursor(), 0, Math.max(0, files().length - 1));
  const selected = () => files()[index()];
  const selectedFiletype = createMemo(() => selected() ? codeFiletype(selected().path) : undefined);
  const scrollStart = () => clip(scroll(), 0, Math.max(0, files().length - visibleRows()));
  const shownFiles = () => files().slice(scrollStart(), scrollStart() + visibleRows());
  const displayDiffRows = createMemo(() => {
    const file = selected();
    const base = file ? `${file.id}:${file.hash}` : "none";
    return file ? buildDisplayRows(file, base) : [];
  });
  const diffMaxScroll = () => Math.max(0, displayDiffRows().length - diffVisibleRows());
  const diffScrollStart = () => clip(diffScroll(), 0, diffMaxScroll());
  const activeDisplayIndex = () => clip(diffCursor(), 0, Math.max(0, displayDiffRows().length - 1));
  const activeDisplayRow = () => displayDiffRows()[activeDisplayIndex()];
  const activeBlock = () => {
    const file = selected();
    const row = activeDisplayRow();
    if (!file || !row)
      return;
    if (row.blockID)
      return file.blocks.find((block) => block.id === row.blockID);
    return blockForFileLine(file, row.fileLine);
  };
  const activeDiffLine = () => {
    const row = activeDisplayRow();
    const block = activeBlock();
    return row?.diffLineIndex ?? (block ? diffLineForFileLine(block, row?.fileLine) : 0);
  };
  const visibleDiffLines = () => displayDiffRows().slice(diffScrollStart(), diffScrollStart() + diffVisibleRows());
  const activeExplanation = createMemo(() => {
    const block = activeBlock();
    if (!explanationVisible())
      return;
    if (!block?.review?.explanations.length)
      return;
    return explanationForLine(block, activeDiffLine())?.explanation;
  });
  const activeExplanationGutterRows = createMemo(() => {
    const block = activeBlock();
    const explanation = activeExplanation();
    const result = new Set;
    if (!block || !explanation)
      return result;
    for (const row of displayDiffRows()) {
      if (!displayRowBelongsToBlock(row, block))
        continue;
      if (explanationForLine(block, diffLineForRow(block, row))?.explanation === explanation)
        result.add(row.rowIndex);
    }
    return result;
  });
  const diffPosition = () => {
    const total = displayDiffRows().length;
    if (!total)
      return "0/0";
    const start = diffScrollStart() + 1;
    const end = Math.min(total, diffScrollStart() + diffVisibleRows());
    return `${start}-${end}/${total}`;
  };
  const fileApprovalPosition = () => {
    const file = selected();
    if (!file?.blocks.length)
      return "approved 0/0";
    return `approved ${file.blocks.filter(blockApproved).length}/${file.blocks.length}`;
  };
  const contentWidth = () => Math.max(1, dim().width - 4);
  const commentCountText = () => commentCount() ? ` \xB7 ${commentCount()} ${commentCount() === 1 ? "comment" : "comments"}` : "";
  const headerTitle = () => `Ledger ${approvedBlocks()}/${totalBlocks()} approved${commentCountText()}`;
  const headerWidth = () => Math.max(1, contentWidth() - 2);
  const headerHelpText = () => notice()?.text ?? helpText();
  const headerHelpWidth = () => Math.max(1, headerWidth() - headerTitle().length - 2);
  const headerHelpTextWidth = () => Math.min(headerHelpText().length, headerHelpWidth());
  const normalWidths = () => splitWidths(contentWidth(), 0.38, 28, 30, 52);
  const fileListInnerWidth = () => Math.max(1, normalWidths().left - 4);
  const inspectWidths = () => splitWidths(contentWidth(), 0.62, 35, 28);
  const helpWidth = () => Math.min(96, Math.max(44, contentWidth() - 4));
  const helpHeight = () => Math.min(22, Math.max(10, dim().height - 4));
  const helpBodyRows = () => Math.max(1, helpHeight() - 8);
  const helpLeft = () => Math.max(0, Math.floor((dim().width - helpWidth()) / 2));
  const helpTop = () => Math.max(1, Math.floor((dim().height - helpHeight()) / 2));
  let analysisToken = 0;
  let statePollTimer;
  let analyzingFrameTimer;
  let lastStateVersion = 0;
  const activeAnalysisSessions = new Set;
  const ANALYSIS_CONCURRENCY = 2;
  function isAnalyzingFile(file) {
    return analyzingIDs().has(file.id);
  }
  function isAnalyzing(id) {
    return analyzingIDs().has(id);
  }
  function analyzingText() {
    return analyzingDots(analyzingFrame());
  }
  function fixedAnalyzingText() {
    return analyzingText().padEnd(3);
  }
  function fileImpactText(file) {
    return isAnalyzing(file.id) ? fixedAnalyzingText() : fileImpact(file);
  }
  function fileStatusColor(file, muted) {
    if (muted)
      return "#78839f";
    const mark = fileStatusMark(file);
    if (mark === "A")
      return "#65f090";
    if (mark === "D")
      return "#ff7aa8";
    return "#86aef5";
  }
  function setAnalyzing(id, analyzing) {
    setAnalyzingIDs((current) => {
      const next = new Set(current);
      if (analyzing)
        next.add(id);
      else
        next.delete(id);
      return next;
    });
  }
  createEffect(() => {
    const active = analyzingIDs().size > 0;
    if (active && !analyzingFrameTimer) {
      analyzingFrameTimer = setInterval(() => setAnalyzingFrame((frame) => frame + 1), 400);
    } else if (!active && analyzingFrameTimer) {
      clearInterval(analyzingFrameTimer);
      analyzingFrameTimer = undefined;
      setAnalyzingFrame(0);
    }
  });
  function showLedgerNotice(text, fg = "#8b96b8") {
    if (noticeTimer)
      clearTimeout(noticeTimer);
    setNotice({
      text,
      fg
    });
    noticeTimer = setTimeout(() => setNotice(undefined), 2200);
  }
  function helpText() {
    return "? help";
  }
  function keepHelpRowVisible(nextIndex = helpCursor()) {
    const row = clip(nextIndex, 0, helpRows.length - 1);
    const top = clip(helpScroll(), 0, Math.max(0, helpRows.length - helpBodyRows()));
    const bottom = top + helpBodyRows() - 1;
    if (row < top)
      setHelpScroll(row);
    else if (row > bottom)
      setHelpScroll(clip(row - helpBodyRows() + 1, 0, Math.max(0, helpRows.length - helpBodyRows())));
  }
  function moveHelpCursor(delta) {
    const nextIndex = clip(helpCursor() + delta, 0, helpRows.length - 1);
    setHelpCursor(nextIndex);
    keepHelpRowVisible(nextIndex);
  }
  function closeHelp() {
    setHelpVisible(false);
  }
  function toggleHelp() {
    setHelpVisible((visible) => {
      const next = !visible;
      if (next)
        keepHelpRowVisible();
      return next;
    });
  }
  function diffPanelWidth() {
    if (!inspect())
      return normalWidths().right;
    if (!explanationVisible())
      return contentWidth();
    return inspectLayout() === "side" ? inspectWidths().left : contentWidth();
  }
  function diffMaxScrollX(innerWidth = Math.max(1, diffPanelWidth() - 6)) {
    const visibleCodeWidth = Math.max(1, innerWidth - 2);
    const longest = displayDiffRows().reduce((max, row) => Math.max(max, diffRowContent(row).length), 0);
    return Math.max(0, longest - visibleCodeWidth);
  }
  function diffRowContent(row) {
    return row.kind === "add" || row.kind === "delete" ? row.line.slice(1) : row.line;
  }
  function clampDiffScrollX(innerWidth) {
    setDiffScrollX((value) => clip(value, 0, diffMaxScrollX(innerWidth)));
  }
  function keepSelectedVisible(nextIndex = index()) {
    const top = scrollStart();
    const bottom = top + visibleRows() - 1;
    if (nextIndex < top)
      setScroll(nextIndex);
    else if (nextIndex > bottom)
      setScroll(clip(nextIndex - visibleRows() + 1, 0, Math.max(0, files().length - visibleRows())));
  }
  function displayRowBelongsToBlock(row, block) {
    if (row.blockID === block.id)
      return true;
    const file = selected();
    if (!file || row.fileLine === undefined)
      return false;
    return blockContainsFileLine(block, row.fileLine, fileLines(file.content).length);
  }
  function displayIndexForBlock(block) {
    const rows = displayDiffRows();
    if (!rows.length || !block)
      return 0;
    const next = rows.findIndex((row) => displayRowBelongsToBlock(row, block));
    return next >= 0 ? next : clip(blockHunkStart(block) - 1, 0, rows.length - 1);
  }
  function keepDisplayRowVisible(rowIndex) {
    const row = clip(rowIndex, 0, Math.max(0, displayDiffRows().length - 1));
    const top = diffScrollStart();
    const bottom = top + diffVisibleRows() - 1;
    if (row < top)
      setDiffScroll(row);
    else if (row > bottom)
      setDiffScroll(clip(row - diffVisibleRows() + 1, 0, diffMaxScroll()));
  }
  function alignDisplayRowTop(rowIndex) {
    const row = clip(rowIndex, 0, Math.max(0, displayDiffRows().length - 1));
    setDiffScroll(clip(row, 0, diffMaxScroll()));
  }
  function focusDiffLine(file) {
    const nextIndex = displayIndexForBlock(file?.blocks[0]);
    setDiffCursor(nextIndex);
    setDiffScroll(clip(nextIndex - 2, 0, diffMaxScroll()));
    setDiffScrollX(0);
    setExplanationScroll(0);
  }
  function focusBlock(block) {
    const nextIndex = displayIndexForBlock(block);
    setDiffCursor(nextIndex);
    setExplanationScroll(0);
    alignDisplayRowTop(nextIndex);
  }
  function targetBlockForJump(file, delta) {
    const currentRow = activeDisplayIndex();
    const currentBlock = activeBlock();
    const targets = file.blocks.map((block) => ({
      block,
      rowIndex: displayIndexForBlock(block)
    })).sort((a, b) => a.rowIndex - b.rowIndex || a.block.diffStartLine - b.block.diffStartLine);
    if (!targets.length)
      return;
    if (currentBlock) {
      const currentIndex = targets.findIndex((target) => target.block.id === currentBlock.id);
      const nextIndex = currentIndex >= 0 ? clip(currentIndex + delta, 0, targets.length - 1) : delta > 0 ? 0 : targets.length - 1;
      return targets[nextIndex].block;
    }
    if (delta > 0)
      return (targets.find((target) => target.rowIndex > currentRow) ?? targets[targets.length - 1]).block;
    return ([...targets].reverse().find((target) => target.rowIndex < currentRow) ?? targets[0]).block;
  }
  function cursorAfterRowsChange(previousRow, previousIndex) {
    const rows = displayDiffRows();
    if (!rows.length)
      return 0;
    if (previousRow?.fileLine !== undefined) {
      const sameFileLine = rows.findIndex((row) => row.fileLine === previousRow.fileLine);
      if (sameFileLine >= 0)
        return sameFileLine;
    }
    return clip(previousIndex, 0, rows.length - 1);
  }
  function explanationBodyRows(file, block, width) {
    if (isAnalyzing(file.id))
      return [{
        text: "Analyzing this file with plan mode..."
      }];
    if (blockReviewed(block)) {
      const match = explanationForLine(block, activeDiffLine());
      if (match) {
        const position = explanationPosition(block, match.explanation);
        return [{
          text: `Explanation ${position}`,
          muted: true
        }, ...wrapText(match.explanation.explanation, width).map((text) => ({
          text
        }))];
      }
      return [{
        text: "No explanation was returned for this hunk."
      }];
    }
    if (block.resolved)
      return [{
        text: "Approved without AI analysis. Press a if you still want an explanation for this file."
      }];
    const message = blockStale(block) ? "This block changed since its last AI analysis. Press a to refresh the file analysis." : "This block needs AI analysis. Press a to analyze this file.";
    return wrapText(message, width).map((text) => ({
      text
    }));
  }
  function explanationRows(width) {
    const file = selected();
    const block = activeBlock();
    if (!file || !block)
      return [{
        text: "No block selected.",
        muted: true
      }];
    const comment = blockComment(block);
    return [{
      text: `Block ${lineRangeText(block)} ${block.resolved ? "approved" : "needs approval"}${comment ? " \xB7 commented" : ""}`,
      fg: block.resolved ? "#3ee06f" : "#86aef5"
    }, ...comment ? [{
      text: "Comment",
      muted: true
    }, ...wrapText(comment, width).map((text) => ({
      text,
      muted: true
    }))] : [], {
      text: " "
    }, ...explanationBodyRows(file, block, width)];
  }
  function explanationForLine(block, line) {
    const explanations = block.review?.explanations ?? [];
    const containing = explanations.find((item) => line >= item.diffStartLine && line <= item.diffEndLine);
    if (containing)
      return {
        explanation: containing,
        exact: true
      };
    const nearest = [...explanations].sort((a, b) => Math.min(Math.abs(a.diffStartLine - line), Math.abs(a.diffEndLine - line)) - Math.min(Math.abs(b.diffStartLine - line), Math.abs(b.diffEndLine - line)))[0];
    return nearest ? {
      explanation: nearest,
      exact: false
    } : undefined;
  }
  function explanationPosition(block, explanation) {
    const explanations = block.review?.explanations ?? [];
    const index2 = explanations.indexOf(explanation);
    return `${index2 >= 0 ? index2 + 1 : 1}/${Math.max(1, explanations.length)}`;
  }
  function diffLineForRow(block, row) {
    return row.diffLineIndex ?? diffLineForFileLine(block, row.fileLine);
  }
  function rowInReviewedExplanationRegion(row) {
    return activeExplanationGutterRows().has(row.rowIndex);
  }
  function rowHasActiveGutter(row) {
    const block = activeBlock();
    return !!block && displayRowBelongsToBlock(row, block);
  }
  function explanationMaxScroll() {
    const width = Math.max(20, (inspectLayout() === "bottom" ? contentWidth() : inspectWidths().right) - 6);
    return Math.max(0, explanationRows(width).length - explanationVisibleRows());
  }
  function scrollExplanation(delta) {
    setExplanationScroll((value) => clip(value + delta, 0, explanationMaxScroll()));
  }
  function scrollDiffHorizontal(delta) {
    if (!inspect() || explanationVisible() && inspectFocus() === "explanation")
      return;
    setDiffScrollX((value) => clip(value + delta, 0, diffMaxScrollX()));
  }
  function refresh(preserveID = selected()?.id) {
    setRevision((value) => value + 1);
    if (preserveID) {
      const nextIndex = files().findIndex((file) => file.id === preserveID);
      if (nextIndex >= 0)
        setCursor(nextIndex);
      keepSelectedVisible(nextIndex >= 0 ? nextIndex : index());
    } else
      keepSelectedVisible();
  }
  function refreshAtIndex(nextIndex) {
    setRevision((value) => value + 1);
    const clipped = clip(nextIndex, 0, Math.max(0, files().length - 1));
    setCursor(clipped);
    keepSelectedVisible(clipped);
  }
  function withActiveBlock(action) {
    const file = selected();
    const block = activeBlock();
    if (file && block)
      action(file, block);
  }
  function openBlockCommentEditor(file, block) {
    root?.blur();
    setCommentEditor({
      file,
      block,
      hadComment: !!blockComment(block)
    });
  }
  function saveBlockComment(editor2, value) {
    const comment = value.trim() ? value.trim() : undefined;
    setBlockComment(scope(), editor2.file.id, editor2.block.id, comment);
    setCommentEditor(undefined);
    refresh(editor2.file.id);
    showLedgerNotice(comment ? `${editor2.hadComment ? "Updated" : "Saved"} comment for ${blockLabel(editor2.file, editor2.block)}.` : `Cleared comment for ${blockLabel(editor2.file, editor2.block)}.`, comment ? "#3ee06f" : "#8b96b8");
  }
  async function analyzeFile(fileID, token) {
    const fileScope = scope();
    const file = currentFile(fileScope, fileID);
    if (!file || isAnalyzing(fileID))
      return;
    setAnalyzing(fileID, true);
    let sessionID;
    try {
      const result = await requestAnalysis(props.api, fileScope, file, () => token === analysisToken, props.analysisModel, (id) => {
        sessionID = id;
        activeAnalysisSessions.add(id);
      });
      if (token !== analysisToken)
        return;
      const preserveID = selected()?.id;
      setFileAnalysisResult(fileScope, fileID, file.hash, result.analysis, result.reviews);
      refresh(preserveID);
      showLedgerNotice(`Analyzed ${file.path}.`, "#3ee06f");
    } catch (error) {
      if (token === analysisToken)
        showLedgerNotice(errorMessage(error), "#f6b26b");
    } finally {
      if (sessionID) {
        activeAnalysisSessions.delete(sessionID);
        await deleteSession(props.api, fileScope, sessionID);
      }
      setAnalyzing(fileID, false);
    }
  }
  async function runWithConcurrency(items, limit, worker) {
    let next = 0;
    const workers = Array.from({
      length: Math.min(limit, items.length)
    }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await worker(item);
      }
    });
    await Promise.all(workers);
  }
  async function analyzeAll(token) {
    const targets = ledgerFiles(scope()).filter((file) => fileNeedsApproval(file) && fileNeedsAnalysis(file) && !isAnalyzing(file.id)).map((file) => file.id);
    if (!targets.length) {
      showLedgerNotice("Everything needing approval is analyzed.");
      return;
    }
    await runWithConcurrency(targets, ANALYSIS_CONCURRENCY, async (fileID) => {
      if (token === analysisToken)
        await analyzeFile(fileID, token);
    });
  }
  function commitMessageContextText(result) {
    if (result.quality === "full")
      return "full analysis";
    if (result.quality === "partial")
      return `partial analysis ${result.analyzedFiles}/${result.totalFiles}`;
    return "diff only";
  }
  async function generateCommitMessage(token) {
    if (generatingCommitMessage()) {
      showLedgerNotice("Commit message is already generating. Press x to stop it.");
      return;
    }
    const fileScope = scope();
    setGeneratingCommitMessage(true);
    showLedgerNotice("Generating commit message...");
    let sessionID;
    try {
      await props.reconcileWorkspace(route.directory);
      if (token !== analysisToken)
        return;
      refresh();
      const result = await requestCommitMessage(props.api, fileScope, ledgerFiles(fileScope), () => token === analysisToken, props.analysisModel, (id) => {
        sessionID = id;
        activeAnalysisSessions.add(id);
      });
      if (token !== analysisToken)
        return;
      const ok = await writeClipboard(props.api, result.text);
      const context2 = commitMessageContextText(result);
      showLedgerNotice(ok ? `Yanked commit message (${context2}).` : `Generated commit message (${context2}), but clipboard unavailable.`, ok ? "#3ee06f" : "#f6b26b");
    } catch (error) {
      if (token === analysisToken)
        showLedgerNotice(errorMessage(error), "#f6b26b");
    } finally {
      if (sessionID) {
        activeAnalysisSessions.delete(sessionID);
        await deleteSession(props.api, fileScope, sessionID);
      }
      setGeneratingCommitMessage(false);
    }
  }
  function deferAnalysis(work) {
    setTimeout(work, 25);
  }
  async function stopAnalysis() {
    analysisToken++;
    const currentScope = scope();
    const sessions = [...activeAnalysisSessions];
    activeAnalysisSessions.clear();
    setAnalyzingIDs(new Set);
    setGeneratingCommitMessage(false);
    await Promise.all(sessions.map(async (sessionID) => {
      await abortSession(props.api, currentScope, sessionID);
      await deleteSession(props.api, currentScope, sessionID);
    }));
    showLedgerNotice("Analysis stopped.");
  }
  function renderDiffPanel(width, layout = {}) {
    const file = selected();
    const innerWidth = Math.max(1, width - 6);
    const horizontalScroll = () => clip(diffScrollX(), 0, diffMaxScrollX(innerWidth));
    const showStatus = () => innerWidth > 1;
    const activeCommentText = () => {
      const block = activeBlock();
      return inspect() && block && blockComment(block) ? "commented \xB7 " : "";
    };
    const statusText = () => file ? `${activeCommentText()}${fileImpactText(file)} \xB7 ${fileApprovalPosition()} \xB7 diff ${diffPosition()}` : "";
    const statusWidth = () => showStatus() ? Math.min(statusText().length, Math.max(1, innerWidth - 1)) : 0;
    const pathWidth = () => Math.max(1, innerWidth - statusWidth());
    return (() => {
      var _el$10 = _$createElement2("box");
      _$setProp2(_el$10, "width", width);
      _$setProp2(_el$10, "overflow", "hidden");
      _$setProp2(_el$10, "flexDirection", "column");
      _$setProp2(_el$10, "border", true);
      _$setProp2(_el$10, "paddingLeft", 2);
      _$setProp2(_el$10, "paddingRight", 2);
      _$insert2(_el$10, file ? (() => {
        var _el$11 = _$createElement2("box"), _el$12 = _$createElement2("box"), _el$13 = _$createElement2("text");
        _$insertNode2(_el$11, _el$12);
        _$setProp2(_el$11, "flexDirection", "column");
        _$setProp2(_el$11, "overflow", "hidden");
        _$setProp2(_el$11, "flexGrow", 1);
        _$insertNode2(_el$12, _el$13);
        _$setProp2(_el$12, "width", innerWidth);
        _$setProp2(_el$12, "overflow", "hidden");
        _$setProp2(_el$12, "flexDirection", "row");
        _$setProp2(_el$12, "justifyContent", "space-between");
        _$setProp2(_el$12, "paddingBottom", 1);
        _$setProp2(_el$13, "fg", "#f0f4ff");
        _$setProp2(_el$13, "truncate", true);
        _$setProp2(_el$13, "wrapMode", "none");
        _$insert2(_el$13, () => file.path);
        _$insert2(_el$12, _$createComponent2(Show2, {
          get when() {
            return showStatus();
          },
          get children() {
            var _el$14 = _$createElement2("text");
            _$setProp2(_el$14, "fg", "#8b96b8");
            _$setProp2(_el$14, "truncate", true);
            _$setProp2(_el$14, "wrapMode", "none");
            _$insert2(_el$14, statusText);
            _$effect2((_$p) => _$setProp2(_el$14, "width", statusWidth(), _$p));
            return _el$14;
          }
        }), null);
        _$insert2(_el$11, _$createComponent2(For, {
          get each() {
            return visibleDiffLines();
          },
          children: (line) => {
            const active = () => inspect() && line.rowIndex === activeDisplayIndex();
            const explanationRegion = () => inspect() && rowInReviewedExplanationRegion(line);
            return _$createComponent2(DiffLine, {
              get line() {
                return line.line;
              },
              width: innerWidth,
              get scrollX() {
                return horizontalScroll();
              },
              get kind() {
                return line.kind;
              },
              get active() {
                return active();
              },
              get blockActive() {
                return _$memo(() => !!inspect())() && rowHasActiveGutter(line);
              },
              get explanationActive() {
                return explanationRegion();
              },
              get blockResolved() {
                return !!activeBlock()?.resolved;
              },
              get path() {
                return file.path;
              },
              get filetype() {
                return selectedFiletype();
              },
              syntaxStyle
            });
          }
        }), null);
        _$effect2((_$p) => _$setProp2(_el$13, "width", pathWidth(), _$p));
        return _el$11;
      })() : (() => {
        var _el$15 = _$createElement2("text");
        _$insertNode2(_el$15, _$createTextNode(`No uncommitted Git changes. Make changes, then open Ledger again.`));
        _$setProp2(_el$15, "fg", "#8b96b8");
        return _el$15;
      })());
      _$effect2((_p$) => {
        var { height: _v$10, flexGrow: _v$11, flexShrink: _v$12, flexBasis: _v$13, minHeight: _v$14 } = layout, _v$15 = inspect() && inspectFocus() === "diff" ? "#86aef5" : "#263149";
        _v$10 !== _p$.e && (_p$.e = _$setProp2(_el$10, "height", _v$10, _p$.e));
        _v$11 !== _p$.t && (_p$.t = _$setProp2(_el$10, "flexGrow", _v$11, _p$.t));
        _v$12 !== _p$.a && (_p$.a = _$setProp2(_el$10, "flexShrink", _v$12, _p$.a));
        _v$13 !== _p$.o && (_p$.o = _$setProp2(_el$10, "flexBasis", _v$13, _p$.o));
        _v$14 !== _p$.i && (_p$.i = _$setProp2(_el$10, "minHeight", _v$14, _p$.i));
        _v$15 !== _p$.n && (_p$.n = _$setProp2(_el$10, "borderColor", _v$15, _p$.n));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined,
        n: undefined
      });
      return _el$10;
    })();
  }
  function renderHelpOverlay() {
    const maxScroll = Math.max(0, helpRows.length - helpBodyRows());
    const start = clip(helpScroll(), 0, maxScroll);
    const visibleRows2 = helpRows.slice(start, start + helpBodyRows());
    const sectionWidth = 14;
    const keyWidth = Math.min(18, Math.max(12, Math.floor(helpWidth() * 0.22)));
    const descWidth = () => Math.max(1, helpWidth() - sectionWidth - keyWidth - 7);
    const footerText = () => `${clip(helpCursor(), 0, helpRows.length - 1) + 1}/${helpRows.length}   j/k move  ctrl+d/u page  ?/esc close`;
    return (() => {
      var _el$17 = _$createElement2("box"), _el$18 = _$createElement2("text"), _el$19 = _$createElement2("b"), _el$21 = _$createElement2("text"), _el$23 = _$createElement2("text"), _el$25 = _$createElement2("text");
      _$insertNode2(_el$17, _el$18);
      _$insertNode2(_el$17, _el$21);
      _$insertNode2(_el$17, _el$23);
      _$insertNode2(_el$17, _el$25);
      _$setProp2(_el$17, "position", "absolute");
      _$setProp2(_el$17, "zIndex", 20);
      _$setProp2(_el$17, "border", true);
      _$setProp2(_el$17, "borderColor", "#86aef5");
      _$setProp2(_el$17, "backgroundColor", "#090d16");
      _$setProp2(_el$17, "paddingLeft", 2);
      _$setProp2(_el$17, "paddingRight", 2);
      _$setProp2(_el$17, "paddingTop", 1);
      _$setProp2(_el$17, "paddingBottom", 1);
      _$setProp2(_el$17, "flexDirection", "column");
      _$insertNode2(_el$18, _el$19);
      _$setProp2(_el$18, "fg", "#f0f4ff");
      _$insertNode2(_el$19, _$createTextNode(`Ledger Help`));
      _$insertNode2(_el$21, _$createTextNode(` `));
      _$setProp2(_el$21, "fg", "#8b96b8");
      _$insert2(_el$17, _$createComponent2(For, {
        each: visibleRows2,
        children: (row, offset) => {
          const rowIndex = () => start + offset();
          const active = () => rowIndex() === helpCursor();
          return (() => {
            var _el$26 = _$createElement2("box"), _el$27 = _$createElement2("text"), _el$28 = _$createElement2("text"), _el$29 = _$createElement2("text");
            _$insertNode2(_el$26, _el$27);
            _$insertNode2(_el$26, _el$28);
            _$insertNode2(_el$26, _el$29);
            _$setProp2(_el$26, "flexDirection", "row");
            _$setProp2(_el$26, "overflow", "hidden");
            _$setProp2(_el$27, "width", 14);
            _$setProp2(_el$27, "truncate", true);
            _$setProp2(_el$27, "wrapMode", "none");
            _$insert2(_el$27, () => row.section);
            _$setProp2(_el$28, "width", keyWidth);
            _$setProp2(_el$28, "truncate", true);
            _$setProp2(_el$28, "wrapMode", "none");
            _$insert2(_el$28, () => row.keys);
            _$setProp2(_el$29, "truncate", true);
            _$setProp2(_el$29, "wrapMode", "none");
            _$insert2(_el$29, () => row.desc);
            _$effect2((_p$) => {
              var _v$20 = active() ? "#86aef5" : undefined, _v$21 = active() ? "#07101f" : "#86aef5", _v$22 = active() ? "#07101f" : "#f0f4ff", _v$23 = descWidth(), _v$24 = active() ? "#07101f" : "#d5dcf6";
              _v$20 !== _p$.e && (_p$.e = _$setProp2(_el$26, "backgroundColor", _v$20, _p$.e));
              _v$21 !== _p$.t && (_p$.t = _$setProp2(_el$27, "fg", _v$21, _p$.t));
              _v$22 !== _p$.a && (_p$.a = _$setProp2(_el$28, "fg", _v$22, _p$.a));
              _v$23 !== _p$.o && (_p$.o = _$setProp2(_el$29, "width", _v$23, _p$.o));
              _v$24 !== _p$.i && (_p$.i = _$setProp2(_el$29, "fg", _v$24, _p$.i));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined,
              o: undefined,
              i: undefined
            });
            return _el$26;
          })();
        }
      }), _el$23);
      _$insertNode2(_el$23, _$createTextNode(` `));
      _$setProp2(_el$23, "fg", "#8b96b8");
      _$setProp2(_el$25, "fg", "#8b96b8");
      _$setProp2(_el$25, "truncate", true);
      _$setProp2(_el$25, "wrapMode", "none");
      _$insert2(_el$25, footerText);
      _$effect2((_p$) => {
        var _v$16 = helpLeft(), _v$17 = helpTop(), _v$18 = helpWidth(), _v$19 = helpHeight();
        _v$16 !== _p$.e && (_p$.e = _$setProp2(_el$17, "left", _v$16, _p$.e));
        _v$17 !== _p$.t && (_p$.t = _$setProp2(_el$17, "top", _v$17, _p$.t));
        _v$18 !== _p$.a && (_p$.a = _$setProp2(_el$17, "width", _v$18, _p$.a));
        _v$19 !== _p$.o && (_p$.o = _$setProp2(_el$17, "height", _v$19, _p$.o));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined
      });
      return _el$17;
    })();
  }
  function renderReviewPanel(width, layout = {}) {
    const innerWidth = Math.max(20, width - 6);
    const rows = explanationRows(innerWidth);
    const start = clip(explanationScroll(), 0, Math.max(0, rows.length - explanationVisibleRows()));
    return (() => {
      var _el$30 = _$createElement2("box");
      _$setProp2(_el$30, "width", width);
      _$setProp2(_el$30, "overflow", "hidden");
      _$setProp2(_el$30, "flexDirection", "column");
      _$setProp2(_el$30, "border", true);
      _$setProp2(_el$30, "paddingLeft", 2);
      _$setProp2(_el$30, "paddingRight", 2);
      _$insert2(_el$30, _$createComponent2(For, {
        get each() {
          return rows.slice(start, start + explanationVisibleRows());
        },
        children: (row) => (() => {
          var _el$31 = _$createElement2("text");
          _$insert2(_el$31, () => row.text);
          _$effect2((_$p) => _$setProp2(_el$31, "fg", row.fg ?? (row.muted ? "#8b96b8" : "#d5dcf6"), _$p));
          return _el$31;
        })()
      }));
      _$effect2((_p$) => {
        var { height: _v$25, flexGrow: _v$26, flexShrink: _v$27, flexBasis: _v$28, minHeight: _v$29 } = layout, _v$30 = inspectFocus() === "explanation" ? "#86aef5" : "#263149";
        _v$25 !== _p$.e && (_p$.e = _$setProp2(_el$30, "height", _v$25, _p$.e));
        _v$26 !== _p$.t && (_p$.t = _$setProp2(_el$30, "flexGrow", _v$26, _p$.t));
        _v$27 !== _p$.a && (_p$.a = _$setProp2(_el$30, "flexShrink", _v$27, _p$.a));
        _v$28 !== _p$.o && (_p$.o = _$setProp2(_el$30, "flexBasis", _v$28, _p$.o));
        _v$29 !== _p$.i && (_p$.i = _$setProp2(_el$30, "minHeight", _v$29, _p$.i));
        _v$30 !== _p$.n && (_p$.n = _$setProp2(_el$30, "borderColor", _v$30, _p$.n));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined,
        n: undefined
      });
      return _el$30;
    })();
  }
  let lastHandledKey = "";
  let lastHandledAt = 0;
  function runAction(action) {
    const explanationFocused = () => inspect() && explanationVisible() && inspectFocus() === "explanation";
    const page = Math.max(1, Math.floor((explanationFocused() ? explanationVisibleRows() : diffVisibleRows()) / 2));
    const handlers = {
      down: () => inspect() ? explanationFocused() ? controls.scrollExplanation(1) : controls.scrollDiff(1) : controls.move(1),
      up: () => inspect() ? explanationFocused() ? controls.scrollExplanation(-1) : controls.scrollDiff(-1) : controls.move(-1),
      nextFile: () => controls.move(1),
      prevFile: () => controls.move(-1),
      diffLeft: () => controls.scrollDiffHorizontal(-4),
      diffRight: () => controls.scrollDiffHorizontal(4),
      diffDown: () => explanationFocused() ? controls.scrollExplanation(page) : controls.scrollDiff(page),
      diffUp: () => explanationFocused() ? controls.scrollExplanation(-page) : controls.scrollDiff(-page),
      prevBlock: () => controls.jumpBlock(-1),
      nextBlock: () => controls.jumpBlock(1),
      help: toggleHelp,
      yank: controls.yank,
      yankComments: controls.yankComments,
      comment: controls.comment,
      approve: controls.approve,
      editor: controls.editor,
      inspect: controls.inspect,
      explanation: controls.explanation,
      layout: controls.layout,
      analyze: controls.analyze,
      analyzeAll: controls.analyzeAll,
      commitMessage: controls.commitMessage,
      stop: controls.stop,
      back: controls.back,
      close: controls.close
    };
    handlers[action]();
  }
  const controls = {
    scopeID,
    commentEditing: () => !!commentEditor(),
    cancelComment: () => setCommentEditor(undefined),
    move(delta) {
      if (!files().length)
        return;
      const nextIndex = clip(index() + delta, 0, files().length - 1);
      setCursor(nextIndex);
      focusDiffLine(files()[nextIndex]);
      keepSelectedVisible(nextIndex);
    },
    scrollDiff(delta) {
      const rows = displayDiffRows();
      if (!rows.length)
        return;
      const nextIndex = clip(activeDisplayIndex() + delta, 0, rows.length - 1);
      setDiffCursor(nextIndex);
      setExplanationScroll(0);
      keepDisplayRowVisible(nextIndex);
    },
    scrollDiffHorizontal,
    scrollExplanation,
    jumpBlock(delta) {
      if (!inspect())
        return;
      const file = selected();
      if (!file?.blocks.length)
        return;
      const nextBlock = targetBlockForJump(file, delta);
      if (nextBlock)
        focusBlock(nextBlock);
    },
    yank() {
      if (!inspect()) {
        showLedgerNotice("Enter inspect mode to yank a block.");
        return;
      }
      withActiveBlock((file, block) => {
        yankBlockToClipboard(props.api, file, block).then((ok) => {
          showLedgerNotice(ok ? `Yanked ${blockLabel(file, block)}.` : "Clipboard unavailable.", ok ? "#3ee06f" : "#f6b26b");
        }).catch((error) => showLedgerNotice(errorMessage(error), "#f6b26b"));
      });
    },
    yankComments() {
      const count = commentCount();
      if (!count) {
        showLedgerNotice("No unresolved blocks with comments.");
        return;
      }
      yankUnresolvedCommentsToClipboard(props.api, files()).then((result) => {
        showLedgerNotice(result.ok ? `Yanked ${result.count} unresolved commented ${result.count === 1 ? "block" : "blocks"}.` : "Clipboard unavailable.", result.ok ? "#3ee06f" : "#f6b26b");
      }).catch((error) => showLedgerNotice(errorMessage(error), "#f6b26b"));
    },
    comment() {
      if (!inspect()) {
        showLedgerNotice("Enter inspect mode to add a comment.");
        return;
      }
      withActiveBlock(openBlockCommentEditor);
    },
    approve() {
      const file = selected();
      const block = activeBlock();
      if (!file)
        return;
      if (inspect()) {
        if (!block)
          return;
        const previousRow = activeDisplayRow();
        const previousIndex = activeDisplayIndex();
        const nextResolved = !block.resolved;
        setBlockResolved(scope(), file.id, block.id, nextResolved);
        refresh(file.id);
        const nextCursor = cursorAfterRowsChange(previousRow, previousIndex);
        setDiffCursor(nextCursor);
        keepDisplayRowVisible(nextCursor);
        return;
      }
      const nextIndex = index();
      setFileResolved(scope(), file.id, !fileApproved(file));
      refreshAtIndex(nextIndex);
    },
    editor() {
      withActiveBlock((file, block) => {
        openEditor(props.api, scope(), file, block).then((result) => showLedgerNotice(result.text, result.fg));
      });
    },
    inspect() {
      if (!selected())
        return;
      if (!inspect()) {
        setInspect(true);
        setInspectFocus("diff");
        setExplanationVisible(false);
        keepDisplayRowVisible(activeDisplayIndex());
      } else {
        if (!explanationVisible())
          return;
        setInspectFocus((focus) => focus === "diff" ? "explanation" : "diff");
      }
    },
    explanation() {
      if (!inspect())
        return;
      const next = !explanationVisible();
      setExplanationVisible(next);
      setExplanationScroll(0);
      if (!next)
        setInspectFocus("diff");
      keepDisplayRowVisible(activeDisplayIndex());
      clampDiffScrollX();
    },
    layout() {
      if (!inspect() || !explanationVisible())
        return;
      setInspectLayout((layout) => layout === "side" ? "bottom" : "side");
      setExplanationScroll(0);
      keepDisplayRowVisible(activeDisplayIndex());
      clampDiffScrollX();
    },
    analyze() {
      const file = selected();
      if (file) {
        if (isAnalyzing(file.id)) {
          showLedgerNotice("This file is already analyzing. Press x to stop it.");
          return;
        }
        const token = analysisToken;
        deferAnalysis(() => void analyzeFile(file.id, token));
      }
    },
    analyzeAll() {
      if (inspect())
        return;
      const token = analysisToken;
      deferAnalysis(() => void analyzeAll(token));
    },
    commitMessage() {
      const token = analysisToken;
      deferAnalysis(() => void generateCommitMessage(token));
    },
    stop() {
      stopAnalysis();
    },
    back() {
      if (inspect()) {
        if (inspectFocus() === "explanation") {
          setInspectFocus("diff");
          return;
        }
        setInspect(false);
        setInspectFocus("diff");
        setExplanationVisible(false);
      } else
        closeLedger(props.api);
    },
    close() {
      closeLedger(props.api);
    },
    refresh,
    notice: showLedgerNotice,
    handleKey(key) {
      if (props.api.ui.dialog.open)
        return false;
      const action = ledgerAction(key);
      if (!action)
        return false;
      if (helpVisible() && action !== "help") {
        if (action === "down")
          moveHelpCursor(1);
        else if (action === "up")
          moveHelpCursor(-1);
        else if (action === "diffDown")
          moveHelpCursor(helpBodyRows());
        else if (action === "diffUp")
          moveHelpCursor(-helpBodyRows());
        else if (action === "back" || action === "close" || action === "inspect")
          closeHelp();
        key.preventDefault?.();
        key.stopPropagation?.();
        return true;
      }
      const now = Date.now();
      if (action === lastHandledKey && now - lastHandledAt < 25) {
        key.preventDefault?.();
        key.stopPropagation?.();
        return true;
      }
      lastHandledKey = action;
      lastHandledAt = now;
      runAction(action);
      lastStateVersion = ledgerStateVersion(scope());
      key.preventDefault?.();
      key.stopPropagation?.();
      return true;
    }
  };
  onMount(() => {
    lastStateVersion = ledgerStateVersion(scope());
    statePollTimer = setInterval(() => {
      const nextVersion = ledgerStateVersion(scope());
      if (nextVersion !== lastStateVersion) {
        lastStateVersion = nextVersion;
        refresh();
      }
    }, 1000);
    focusDiffLine(selected());
    props.registerControls(controls);
    props.reconcileWorkspace(route.directory).then(() => refresh()).catch((error) => showLedgerNotice(errorMessage(error), "#f6b26b"));
    setTimeout(() => root?.focus(), 0);
  });
  onCleanup(() => {
    if (statePollTimer)
      clearInterval(statePollTimer);
    if (analyzingFrameTimer)
      clearInterval(analyzingFrameTimer);
    if (noticeTimer)
      clearTimeout(noticeTimer);
    props.registerControls(undefined);
  });
  return (() => {
    var _el$32 = _$createElement2("box"), _el$33 = _$createElement2("box"), _el$34 = _$createElement2("box"), _el$35 = _$createElement2("text"), _el$36 = _$createElement2("b"), _el$38 = _$createTextNode(` `), _el$39 = _$createElement2("span"), _el$40 = _$createTextNode(`/`), _el$41 = _$createTextNode(` approved`), _el$42 = _$createElement2("box"), _el$43 = _$createElement2("text");
    _$insertNode2(_el$32, _el$33);
    _$use((node) => {
      root = node;
    }, _el$32);
    _$setProp2(_el$32, "focused", true);
    _$setProp2(_el$32, "focusable", true);
    _$setProp2(_el$32, "renderAfter", () => {
      if (commentEditor())
        return;
      if (!props.api.ui.dialog.open && !root?.focused)
        root?.focus();
    });
    _$setProp2(_el$32, "position", "relative");
    _$setProp2(_el$32, "flexDirection", "column");
    _$setProp2(_el$32, "paddingTop", 1);
    _$setProp2(_el$32, "paddingLeft", 2);
    _$setProp2(_el$32, "paddingRight", 2);
    _$setProp2(_el$32, "backgroundColor", "#070a10");
    _$insertNode2(_el$33, _el$34);
    _$insertNode2(_el$33, _el$42);
    _$setProp2(_el$33, "height", 1);
    _$setProp2(_el$33, "marginLeft", 1);
    _$setProp2(_el$33, "marginRight", 1);
    _$setProp2(_el$33, "flexDirection", "row");
    _$setProp2(_el$33, "alignItems", "flex-start");
    _$setProp2(_el$33, "justifyContent", "space-between");
    _$setProp2(_el$33, "paddingBottom", 0);
    _$insertNode2(_el$34, _el$35);
    _$setProp2(_el$34, "height", 1);
    _$setProp2(_el$34, "flexDirection", "row");
    _$insertNode2(_el$35, _el$36);
    _$insertNode2(_el$35, _el$38);
    _$insertNode2(_el$35, _el$39);
    _$setProp2(_el$35, "fg", "#d9e2ff");
    _$insertNode2(_el$36, _$createTextNode(`Ledger`));
    _$insertNode2(_el$39, _el$40);
    _$insertNode2(_el$39, _el$41);
    _$setProp2(_el$39, "style", {
      fg: "#8b96b8"
    });
    _$insert2(_el$39, approvedBlocks, _el$40);
    _$insert2(_el$39, totalBlocks, _el$41);
    _$insert2(_el$39, commentCountText, null);
    _$insertNode2(_el$42, _el$43);
    _$setProp2(_el$42, "height", 1);
    _$setProp2(_el$42, "flexDirection", "row");
    _$setProp2(_el$42, "alignItems", "flex-start");
    _$setProp2(_el$42, "justifyContent", "flex-end");
    _$setProp2(_el$42, "overflow", "hidden");
    _$setProp2(_el$43, "truncate", true);
    _$setProp2(_el$43, "wrapMode", "none");
    _$insert2(_el$43, headerHelpText);
    _$insert2(_el$32, (() => {
      var _c$ = _$memo(() => !!inspect());
      return () => _c$() ? _$memo(() => !!!explanationVisible())() ? renderDiffPanel(contentWidth(), {
        flexGrow: 1,
        flexShrink: 1
      }) : _$memo(() => inspectLayout() === "side")() ? (() => {
        var _el$44 = _$createElement2("box");
        _$setProp2(_el$44, "flexDirection", "row");
        _$setProp2(_el$44, "gap", 1);
        _$setProp2(_el$44, "flexGrow", 1);
        _$setProp2(_el$44, "overflow", "hidden");
        _$insert2(_el$44, () => renderDiffPanel(inspectWidths().left, {
          flexGrow: 1,
          flexShrink: 1
        }), null);
        _$insert2(_el$44, () => renderReviewPanel(inspectWidths().right, {
          flexGrow: 1,
          flexShrink: 1
        }), null);
        return _el$44;
      })() : (() => {
        var _el$45 = _$createElement2("box");
        _$setProp2(_el$45, "flexDirection", "column");
        _$setProp2(_el$45, "flexGrow", 1);
        _$setProp2(_el$45, "overflow", "hidden");
        _$insert2(_el$45, () => renderDiffPanel(contentWidth(), {
          flexGrow: bottomDiffHeight(),
          flexShrink: 1,
          flexBasis: bottomDiffHeight(),
          minHeight: 5
        }), null);
        _$insert2(_el$45, () => renderReviewPanel(contentWidth(), {
          flexGrow: bottomExplanationHeight(),
          flexShrink: 1,
          flexBasis: bottomExplanationHeight(),
          minHeight: 4
        }), null);
        return _el$45;
      })() : (() => {
        var _el$46 = _$createElement2("box"), _el$47 = _$createElement2("box");
        _$insertNode2(_el$46, _el$47);
        _$setProp2(_el$46, "flexDirection", "row");
        _$setProp2(_el$46, "gap", 1);
        _$setProp2(_el$46, "flexGrow", 1);
        _$setProp2(_el$47, "flexDirection", "column");
        _$setProp2(_el$47, "border", true);
        _$setProp2(_el$47, "borderColor", "#86aef5");
        _$setProp2(_el$47, "paddingLeft", 1);
        _$setProp2(_el$47, "paddingRight", 1);
        _$insert2(_el$47, _$createComponent2(For, {
          get each() {
            return shownFiles();
          },
          children: (file) => {
            const on = () => file.id === selected()?.id;
            const approved = () => fileApproved(file);
            const muted = () => approved();
            const additions = () => `+${file.additions}`;
            const deletions = () => `-${file.deletions}`;
            const status = () => fileStatusMark(file);
            const baseText = () => fileRow(file, isAnalyzingFile(file), analyzingText());
            const name = () => filename(file.path);
            const fixedWidth = () => baseText().length + additions().length + deletions().length + 5;
            const nameWidth = () => Math.max(1, fileListInnerWidth() - fixedWidth());
            const textColor = () => muted() ? "#78839f" : "#d5dcf6";
            const addColor = () => muted() ? "#78839f" : "#65f090";
            const deleteColor = () => muted() ? "#78839f" : "#ff7aa8";
            return (() => {
              var _el$48 = _$createElement2("box"), _el$49 = _$createElement2("text"), _el$50 = _$createTextNode(` `), _el$51 = _$createElement2("text"), _el$52 = _$createTextNode(` `), _el$53 = _$createElement2("text"), _el$54 = _$createElement2("text"), _el$55 = _$createTextNode(` `), _el$56 = _$createElement2("text"), _el$57 = _$createTextNode(` `);
              _$insertNode2(_el$48, _el$49);
              _$insertNode2(_el$48, _el$51);
              _$insertNode2(_el$48, _el$53);
              _$insertNode2(_el$48, _el$54);
              _$insertNode2(_el$48, _el$56);
              _$setProp2(_el$48, "flexDirection", "row");
              _$setProp2(_el$48, "overflow", "hidden");
              _$insertNode2(_el$49, _el$50);
              _$setProp2(_el$49, "flexShrink", 0);
              _$setProp2(_el$49, "truncate", true);
              _$setProp2(_el$49, "wrapMode", "none");
              _$insert2(_el$49, baseText, _el$50);
              _$insertNode2(_el$51, _el$52);
              _$setProp2(_el$51, "width", 2);
              _$setProp2(_el$51, "flexShrink", 0);
              _$setProp2(_el$51, "truncate", true);
              _$setProp2(_el$51, "wrapMode", "none");
              _$insert2(_el$51, status, _el$52);
              _$setProp2(_el$53, "truncate", true);
              _$setProp2(_el$53, "wrapMode", "none");
              _$insert2(_el$53, name);
              _$insertNode2(_el$54, _el$55);
              _$setProp2(_el$54, "flexShrink", 0);
              _$setProp2(_el$54, "truncate", true);
              _$setProp2(_el$54, "wrapMode", "none");
              _$insert2(_el$54, additions, null);
              _$insertNode2(_el$56, _el$57);
              _$setProp2(_el$56, "flexShrink", 0);
              _$setProp2(_el$56, "truncate", true);
              _$setProp2(_el$56, "wrapMode", "none");
              _$insert2(_el$56, deletions, null);
              _$effect2((_p$) => {
                var _v$37 = on() ? "#1b2540" : undefined, _v$38 = baseText().length + 1, _v$39 = muted() ? "#78839f" : "#d5dcf6", _v$40 = fileStatusColor(file, muted()), _v$41 = nameWidth(), _v$42 = textColor(), _v$43 = additions().length + 1, _v$44 = addColor(), _v$45 = deletions().length + 1, _v$46 = deleteColor();
                _v$37 !== _p$.e && (_p$.e = _$setProp2(_el$48, "backgroundColor", _v$37, _p$.e));
                _v$38 !== _p$.t && (_p$.t = _$setProp2(_el$49, "width", _v$38, _p$.t));
                _v$39 !== _p$.a && (_p$.a = _$setProp2(_el$49, "fg", _v$39, _p$.a));
                _v$40 !== _p$.o && (_p$.o = _$setProp2(_el$51, "fg", _v$40, _p$.o));
                _v$41 !== _p$.i && (_p$.i = _$setProp2(_el$53, "width", _v$41, _p$.i));
                _v$42 !== _p$.n && (_p$.n = _$setProp2(_el$53, "fg", _v$42, _p$.n));
                _v$43 !== _p$.s && (_p$.s = _$setProp2(_el$54, "width", _v$43, _p$.s));
                _v$44 !== _p$.h && (_p$.h = _$setProp2(_el$54, "fg", _v$44, _p$.h));
                _v$45 !== _p$.r && (_p$.r = _$setProp2(_el$56, "width", _v$45, _p$.r));
                _v$46 !== _p$.d && (_p$.d = _$setProp2(_el$56, "fg", _v$46, _p$.d));
                return _p$;
              }, {
                e: undefined,
                t: undefined,
                a: undefined,
                o: undefined,
                i: undefined,
                n: undefined,
                s: undefined,
                h: undefined,
                r: undefined,
                d: undefined
              });
              return _el$48;
            })();
          }
        }));
        _$insert2(_el$46, () => renderDiffPanel(normalWidths().right), null);
        _$effect2((_$p) => _$setProp2(_el$47, "width", normalWidths().left, _$p));
        return _el$46;
      })();
    })(), null);
    _$insert2(_el$32, _$createComponent2(Show2, {
      get when() {
        return helpVisible();
      },
      get children() {
        return renderHelpOverlay();
      }
    }), null);
    _$insert2(_el$32, _$createComponent2(Show2, {
      get when() {
        return commentEditor();
      },
      children: (editor2) => _$createComponent2(CommentDialog, {
        get title() {
          return `Comment for ${blockLabel(editor2().file, editor2().block)}`;
        },
        get initialValue() {
          return editor2().block.comment ?? "";
        },
        onSave: (value) => saveBlockComment(editor2(), value),
        onCancel: () => setCommentEditor(undefined)
      })
    }), null);
    _$effect2((_p$) => {
      var _v$31 = dim().width, _v$32 = dim().height, _v$33 = headerWidth(), _v$34 = headerHelpWidth(), _v$35 = headerHelpTextWidth(), _v$36 = notice()?.fg ?? "#8b96b8";
      _v$31 !== _p$.e && (_p$.e = _$setProp2(_el$32, "width", _v$31, _p$.e));
      _v$32 !== _p$.t && (_p$.t = _$setProp2(_el$32, "height", _v$32, _p$.t));
      _v$33 !== _p$.a && (_p$.a = _$setProp2(_el$33, "width", _v$33, _p$.a));
      _v$34 !== _p$.o && (_p$.o = _$setProp2(_el$42, "width", _v$34, _p$.o));
      _v$35 !== _p$.i && (_p$.i = _$setProp2(_el$43, "width", _v$35, _p$.i));
      _v$36 !== _p$.n && (_p$.n = _$setProp2(_el$43, "fg", _v$36, _p$.n));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined
    });
    return _el$32;
  })();
}
var commentKeyBindings = [{
  name: "return",
  action: "submit"
}, {
  name: "return",
  shift: true,
  action: "newline"
}, {
  name: "enter",
  action: "submit"
}, {
  name: "enter",
  shift: true,
  action: "newline"
}, {
  name: "j",
  ctrl: true,
  action: "newline"
}];
var helpRows = [{
  section: "File View",
  keys: "j / k",
  desc: "Move file selection"
}, {
  section: "File View",
  keys: "enter",
  desc: "Open selected file diff"
}, {
  section: "File View",
  keys: "space",
  desc: "Toggle selected file approval"
}, {
  section: "File View",
  keys: "a",
  desc: "Analyze selected file"
}, {
  section: "File View",
  keys: "A",
  desc: "Analyze all pending files"
}, {
  section: "File View",
  keys: "Y",
  desc: "Yank unresolved comments"
}, {
  section: "File View",
  keys: "x",
  desc: "Stop analysis"
}, {
  section: "Diff View",
  keys: "j / k",
  desc: "Move diff cursor"
}, {
  section: "Diff View",
  keys: "h / l",
  desc: "Scroll diff horizontally"
}, {
  section: "Diff View",
  keys: "ctrl+d / ctrl+u",
  desc: "Scroll diff by half a page"
}, {
  section: "Diff View",
  keys: "n / N",
  desc: "Next or previous block"
}, {
  section: "Diff View",
  keys: "space",
  desc: "Toggle active block approval"
}, {
  section: "Diff View",
  keys: "tab",
  desc: "Show or hide explanation"
}, {
  section: "Diff View",
  keys: "enter",
  desc: "Focus explanation when visible"
}, {
  section: "Diff View",
  keys: "|",
  desc: "Toggle explanation layout"
}, {
  section: "Diff View",
  keys: "c",
  desc: "Add or edit active block comment"
}, {
  section: "Diff View",
  keys: "y",
  desc: "Yank active block"
}, {
  section: "Diff View",
  keys: "Y",
  desc: "Yank unresolved comments"
}, {
  section: "Diff View",
  keys: "e",
  desc: "Open editor at active block"
}, {
  section: "Diff View",
  keys: "esc",
  desc: "Return to file view"
}, {
  section: "Explanation",
  keys: "j / k",
  desc: "Scroll explanation"
}, {
  section: "Explanation",
  keys: "ctrl+d / ctrl+u",
  desc: "Page explanation"
}, {
  section: "Explanation",
  keys: "enter",
  desc: "Focus diff"
}, {
  section: "Explanation",
  keys: "tab",
  desc: "Hide explanation"
}, {
  section: "Explanation",
  keys: "esc",
  desc: "Return focus to diff"
}, {
  section: "General",
  keys: "J / K",
  desc: "Next or previous file"
}, {
  section: "General",
  keys: "m",
  desc: "Generate commit message"
}, {
  section: "General",
  keys: "?",
  desc: "Toggle help"
}, {
  section: "General",
  keys: "q",
  desc: "Close ledger"
}];

// src/tui.tsx
var tui = async (api, options) => {
  let controls;
  const reconcileTimers = new Map;
  const registerControls = (next) => {
    controls = next;
  };
  const applyReconcile = async (scope) => {
    const applied = await reconcileWorkspaceDiff(api, scope);
    if (applied && controls && controls.scopeID() === scope.id)
      controls.refresh();
  };
  const reconcile = async (directory) => applyReconcile(routeScope(api, directory));
  const scheduleReconcile = (scope) => {
    const timerKey = scope.id;
    const existing = reconcileTimers.get(timerKey);
    if (existing)
      clearTimeout(existing);
    reconcileTimers.set(timerKey, setTimeout(() => {
      reconcileTimers.delete(timerKey);
      applyReconcile(scope).catch((error) => {
        if (controls && controls.scopeID() === scope.id)
          controls.notice(errorMessage(error), "#f6b26b");
      });
    }, 500));
  };
  api.lifecycle.onDispose(() => {
    for (const timer of reconcileTimers.values())
      clearTimeout(timer);
    reconcileTimers.clear();
  });
  api.route.register([{
    name: ROUTE,
    render: ({
      params
    }) => _$createComponent3(LedgerScreen, {
      api,
      params,
      get analysisModel() {
        return options?.model;
      },
      registerControls,
      reconcileWorkspace: reconcile
    })
  }]);
  api.keymap.registerLayer({
    commands: [{
      name: "ledger.open",
      title: "Ledger",
      category: "Review",
      namespace: "palette",
      slashName: "ledger",
      run: () => openLedger(api)
    }]
  });
  const runKey = (name) => () => controls?.handleKey({
    name
  });
  api.keymap.registerLayer({
    enabled: () => activeLedger(api) && !controls?.commentEditing(),
    priority: 1000,
    commands: [...ledgerActionConfigs.map((item) => ({
      name: item.command,
      run: runKey(item.commandKey)
    }))],
    bindings: ledgerKeyBindings.map((item) => ({
      key: item.key,
      cmd: command[item.action],
      desc: item.desc
    }))
  });
  api.keymap.registerLayer({
    enabled: () => activeLedger(api) && !!controls?.commentEditing(),
    priority: 1001,
    commands: [{
      name: "ledger.comment.cancel",
      run: () => controls?.cancelComment()
    }],
    bindings: [{
      key: "escape",
      cmd: "ledger.comment.cancel",
      desc: "Cancel comment"
    }]
  });
  api.event.on("session.diff", () => {
    const scope = ledgerScope(api);
    scheduleReconcile(scope);
  });
  api.event.on("file.edited", () => {
    scheduleReconcile(ledgerScope(api));
  });
  api.event.on("file.watcher.updated", () => {
    scheduleReconcile(ledgerScope(api));
  });
  api.event.on("vcs.branch.updated", () => {
    scheduleReconcile(ledgerScope(api));
  });
  api.slots.register({
    slots: {
      session_prompt_right() {
        const scope = ledgerScope(api);
        const needs = readFilesForScope(scope).filter(fileNeedsApproval).length;
        return needs ? (() => {
          var _el$ = _$createElement3("text"), _el$2 = _$createTextNode2(`ledger `);
          _$insertNode3(_el$, _el$2);
          _$insert3(_el$, needs, null);
          return _el$;
        })() : null;
      }
    }
  });
};
var plugin = {
  id: "opencode-ledger",
  tui
};
var tui_default = plugin;
export {
  tui_default as default
};

//# debugId=9F567394111AD64C64756e2164756e21
