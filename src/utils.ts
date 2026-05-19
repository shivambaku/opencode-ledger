import { readFileSync } from "node:fs"
import type { Impact } from "./types"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function isImpact(value: unknown): value is Impact {
  return value === "high" || value === "medium" || value === "low"
}

export function normalizePath(path: string) {
  return path.replaceAll("\\", "/")
}

export function filename(path: string) {
  const normalized = normalizePath(path)
  return normalized.split("/").pop() || normalized
}

export function parseRouteParams(params: Record<string, unknown> | undefined) {
  return {
    sessionID: typeof params?.sessionID === "string" ? params.sessionID : undefined,
    directory: typeof params?.directory === "string" ? params.directory : undefined,
    index: typeof params?.index === "number" ? params.index : 0,
    scroll: typeof params?.scroll === "number" ? params.scroll : 0,
  }
}

export function clip(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function hashString(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function normalizedPatchForHash(patch: string) {
  return patch
    .split("\n")
    .filter((line) => !line.startsWith("@@"))
    .join("\n")
}

export function patchHash(path: string, patch: string) {
  return hashString(`${path}\n${normalizedPatchForHash(patch)}`)
}

export function readWorkspaceFile(directory: string, path: string) {
  try {
    return readFileSync(`${directory}/${path}`, "utf8")
  } catch {
    return ""
  }
}

export function fileLines(content: string) {
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
  if (!normalized) return []
  const lines = normalized.split("\n")
  if (lines[lines.length - 1] === "") lines.pop()
  return lines
}

function commonPrefixLength(beforeLines: string[], afterLines: string[]) {
  let index = 0
  while (index < beforeLines.length && index < afterLines.length && beforeLines[index] === afterLines[index]) index++
  return index
}

function changedEnds(beforeLines: string[], afterLines: string[], start: number) {
  let beforeEnd = beforeLines.length - 1
  let afterEnd = afterLines.length - 1
  while (beforeEnd >= start && afterEnd >= start && beforeLines[beforeEnd] === afterLines[afterEnd]) {
    beforeEnd--
    afterEnd--
  }
  return { beforeEnd, afterEnd }
}

function hunkHeader(contextStart: number, beforeContextEnd: number, afterContextEnd: number) {
  const oldCount = Math.max(0, beforeContextEnd - contextStart + 1)
  const newCount = Math.max(0, afterContextEnd - contextStart + 1)
  return `@@ -${contextStart + 1},${oldCount} +${contextStart + 1},${newCount} @@`
}

export function unifiedDiff(path: string, before: string | undefined, after: string | undefined, fallback: string) {
  if (typeof before !== "string" || typeof after !== "string") return fallback
  if (before === after) return fallback

  const beforeLines = before.split("\n")
  const afterLines = after.split("\n")
  const start = commonPrefixLength(beforeLines, afterLines)
  const { beforeEnd, afterEnd } = changedEnds(beforeLines, afterLines, start)

  const contextStart = Math.max(0, start - 3)
  const beforeContextEnd = Math.min(beforeLines.length - 1, beforeEnd + 3)
  const afterContextEnd = Math.min(afterLines.length - 1, afterEnd + 3)
  const out = [`--- ${path}`, `+++ ${path}`, hunkHeader(contextStart, beforeContextEnd, afterContextEnd)]

  for (let i = contextStart; i < start; i++) out.push(` ${beforeLines[i] ?? ""}`)
  for (let i = start; i <= beforeEnd; i++) out.push(`-${beforeLines[i] ?? ""}`)
  for (let i = start; i <= afterEnd; i++) out.push(`+${afterLines[i] ?? ""}`)
  for (let i = Math.max(start, afterEnd + 1); i <= afterContextEnd; i++) out.push(` ${afterLines[i] ?? ""}`)

  return out.join("\n")
}

export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function splitCommand(value: string) {
  return value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^(["'])(.*)\1$/, "$2")) ?? []
}

export function wrapText(text: string, width = 74) {
  const lines: string[] = []
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let line = ""
    for (const word of words) {
      if (!line) line = word
      else if (line.length + word.length + 1 > width) {
        lines.push(line)
        line = word
      } else line = `${line} ${word}`
    }
    lines.push(line || " ")
  }
  return lines
}

export function splitWidths(total: number, ratio: number, minLeft: number, minRight: number, maxLeft = total) {
  const available = Math.max(1, total - 1)
  const highestLeft = Math.max(1, Math.min(maxLeft, available - minRight))
  const lowestLeft = Math.min(minLeft, highestLeft)
  const left = clip(Math.floor(available * ratio), lowestLeft, highestLeft)
  return { left, right: Math.max(1, available - left) }
}

export function limitText(text: string, max = 6000) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n...[truncated]`
}

export function textFromParts(parts: readonly unknown[]) {
  return parts
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error."
}
