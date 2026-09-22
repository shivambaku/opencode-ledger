import type { OpenCodeClient, SessionMessageInfo } from "@opencode/client"
import { join } from "node:path"
import type { LedgerBlock, LedgerFile, LedgerScope } from "./types"
import { isRecord, limitText, normalizePath } from "./utils"

type CandidateRow = {
  partID: string
  messageID: string
  sessionID: string
  timeCreated: number
  data: unknown
  title: string
}

export type ContextMatch = {
  hunkID: string
  sessionID: string
  sessionTitle: string
  messageID: string
  partID: string
  tool: string
  score: number
  timeCreated: number
  reasons: string[]
  matchedLines: string[]
  includedMessageIDs: string[]
}

export type RetrievedContext = {
  source: "opencode-api" | "workspace"
  matches: ContextMatch[]
  totalIncludedChars: number
  rendered: string
  error?: string
}

function jsonText(value: unknown, path: string[]) {
  let current = value
  for (const key of path) current = isRecord(current) ? current[key] : undefined
  return typeof current === "string" ? current : ""
}

function changedLines(block: LedgerBlock) {
  const lines = new Set<string>()
  for (const line of block.patch.split("\n")) {
    if ((!line.startsWith("+") && !line.startsWith("-")) || line.startsWith("+++") || line.startsWith("---")) continue
    const text = line.slice(1).trim()
    if (text.length >= 4) lines.add(text)
  }
  return [...lines]
}

function candidateNeedles(scope: LedgerScope, file: LedgerFile) {
  const absolute = normalizePath(join(scope.directory, file.path))
  const relative = normalizePath(file.path)
  return { absolute, relative }
}

function cleanPath(value: string) {
  return normalizePath(value.trim().replace(/^"(.*)"$/, "$1").replace(/\t.*$/, "").replace(/^[ab]\//, ""))
}

function targetMatches(scope: LedgerScope, file: LedgerFile, value: string) {
  const { absolute, relative } = candidateNeedles(scope, file)
  const path = cleanPath(value)
  return path === absolute || path === relative || path.endsWith(`/${relative}`)
}

function diffSections(diff: string) {
  const sections: string[][] = []
  let current: string[] = []
  for (const line of diff.split("\n")) {
    if ((line.startsWith("Index: ") || line.startsWith("diff --git ")) && current.length) {
      sections.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length) sections.push(current)
  return sections.map((lines) => lines.join("\n"))
}

function sectionPaths(section: string) {
  const paths: string[] = []
  for (const line of section.split("\n")) {
    if (line.startsWith("Index: ")) paths.push(cleanPath(line.slice("Index: ".length)))
    else if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const path = cleanPath(line.slice(4))
      if (path && path !== "/dev/null") paths.push(path)
    } else if (line.startsWith("diff --git ")) {
      const parts = line.split(/\s+/)
      if (parts[2]) paths.push(cleanPath(parts[2]))
      if (parts[3]) paths.push(cleanPath(parts[3]))
    }
  }
  return paths
}

function patchTextPaths(patchText: string) {
  const paths: string[] = []
  for (const line of patchText.split("\n")) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/)
    if (match) paths.push(cleanPath(match[1]))
  }
  return paths
}

function targetToolText(data: unknown, scope: LedgerScope, file: LedgerFile) {
  const state = isRecord(data) ? data.state : undefined
  const input = isRecord(state) ? state.input : undefined
  const metadata = isRecord(state) ? state.metadata : undefined
  const inputPath = jsonText(input, ["filePath"]) || jsonText(input, ["path"])
  const diff = jsonText(metadata, ["diff"])
  const patchText = jsonText(input, ["patchText"])
  const chunks: string[] = []
  const targetPaths: string[] = []

  if (diff) {
    for (const section of diffSections(diff)) {
      const paths = sectionPaths(section)
      if (paths.some((path) => targetMatches(scope, file, path))) {
        chunks.push(section)
        targetPaths.push(...paths)
      }
    }
  }

  if (patchText) {
    const paths = patchTextPaths(patchText)
    if (paths.some((path) => targetMatches(scope, file, path))) {
      chunks.push(patchText)
      targetPaths.push(...paths)
    }
  }

  if (inputPath && targetMatches(scope, file, inputPath)) {
    chunks.push([jsonText(input, ["oldString"]), jsonText(input, ["newString"]), jsonText(input, ["content"]), inputPath].filter(Boolean).join("\n"))
    targetPaths.push(inputPath)
  }

  return {
    text: chunks.filter(Boolean).join("\n"),
    paths: [...new Set(targetPaths.map(cleanPath))],
  }
}

function scoreCandidate(row: CandidateRow, scope: LedgerScope, file: LedgerFile, block: LedgerBlock): (ContextMatch & { text: string }) | undefined {
  const data = row.data
  if (!isRecord(data)) return undefined
  const tool = typeof data.name === "string" ? data.name : "tool"
  const target = targetToolText(data, scope, file)
  const text = target.text
  if (!text) return undefined
  const { absolute, relative } = candidateNeedles(scope, file)
  const lines = changedLines(block)
  const reasons: string[] = []
  const matchedLines: string[] = []
  let score = 0

  if (target.paths.some((path) => path === absolute || path.endsWith(`/${relative}`))) {
    score += 45
    reasons.push("absolute file path")
  } else if (target.paths.includes(relative)) {
    score += 40
    reasons.push("relative file path")
  }

  for (const line of lines) {
    const add = `+${line}`
    const remove = `-${line}`
    if (text.includes(add) || text.includes(remove)) {
      score += 35
      matchedLines.push(line)
    } else if (text.includes(line)) {
      score += 20
      matchedLines.push(line)
    }
  }

  if (!reasons.length || !matchedLines.length || score < 75) return undefined
  reasons.push(`${matchedLines.length} changed line${matchedLines.length === 1 ? "" : "s"}`)
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
    text,
  }
}

function messageText(message: SessionMessageInfo) {
  if (message.type === "user") return message.text
  if (message.type !== "assistant") return ""
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
}

function compactText(value: string, max = 700) {
  return limitText(value.trim().replace(/\s+/g, " "), max)
}

function renderMatch(messages: SessionMessageInfo[], match: ContextMatch & { text: string }) {
  const matchIndex = messages.findIndex((message) => message.id === match.messageID)
  if (matchIndex < 0) return ""

  let start = matchIndex
  while (start > 0 && messages[start].type !== "user") start--
  const end = Math.min(messages.length - 1, matchIndex + 1)
  const window = messages.slice(start, end + 1)
  match.includedMessageIDs = window.map((message) => message.id)

  const rendered: string[] = []
  for (const message of window) {
    const text = messageText(message)
    if (text.trim()) rendered.push(`${message.type === "user" ? "User request" : "Assistant note"}: ${compactText(text, 900)}`)
    if (message.id === match.messageID) rendered.push(`Matched changed text: ${match.matchedLines.map((line) => `\`${line}\``).join(", ")}`)
  }
  return rendered.join("\n\n")
}

export async function retrieveReviewContext(client: OpenCodeClient, scope: LedgerScope, file: LedgerFile): Promise<RetrievedContext> {
  try {
    const signal = AbortSignal.timeout(10000)
    const sessions = await client.session.list({ directory: scope.directory, limit: 50, order: "desc" }, { signal })
    const rows: CandidateRow[] = []
    const transcripts = new Map<string, SessionMessageInfo[]>()
    for (const session of sessions.data) {
      if (session.location.directory !== scope.directory || session.metadata?.ledger === true) continue
      const messages = await client.session.context({ sessionID: session.id }, { signal })
      transcripts.set(session.id, messages)
      for (const message of messages) {
        if (message.type !== "assistant") continue
        for (const part of message.content) {
          if (part.type !== "tool" || part.state.status !== "completed" || !["patch", "apply_patch", "edit", "write"].includes(part.name)) continue
          if (!targetToolText(part, scope, file).text) continue
          rows.push({ partID: part.id, messageID: message.id, sessionID: session.id, timeCreated: part.time.created, data: part, title: session.title ?? "Untitled" })
        }
      }
      if (rows.length >= 200) break
    }
    rows.sort((a, b) => b.timeCreated - a.timeCreated)
    rows.splice(200)
    const matches: (ContextMatch & { text: string })[] = []
    const sections: string[] = []
    for (const block of file.blocks) {
      const match = rows
        .map((row) => scoreCandidate(row, scope, file, block))
        .filter((item): item is ContextMatch & { text: string } => !!item)
        .sort((a, b) => b.score - a.score || b.timeCreated - a.timeCreated)[0]
      if (match) {
        const rendered = renderMatch(transcripts.get(match.sessionID) ?? [], match)
        matches.push(match)
        sections.push(`Change block ${block.id}:\n${rendered || "(not available)"}`)
      } else sections.push(`Change block ${block.id}:\n(not available)`)
    }
    const rendered = limitText(sections.join("\n\n---\n\n"), 7000)
    const debugMatches = matches.map(({ text: _text, ...match }) => match)
    return { source: debugMatches.length ? "opencode-api" : "workspace", matches: debugMatches, totalIncludedChars: rendered.length, rendered }
  } catch (error) {
    return { source: "workspace", matches: [], totalIncludedChars: 0, rendered: "", error: error instanceof Error ? error.message : String(error) }
  }
}
