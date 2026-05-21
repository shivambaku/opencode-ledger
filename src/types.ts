export type Impact = "high" | "medium" | "low"

export type BlockExplanation = {
  diffStartLine: number
  diffEndLine: number
  explanation: string
}

export type BlockReview = {
  hash: string
  generatedAt: number
  explanations: BlockExplanation[]
}

export type FileAnalysis = {
  hash: string
  impact: Impact
  generatedAt: number
}

export type FileStatus = "modified" | "added" | "deleted"

export type LedgerBlock = {
  id: string
  fileID: string
  patch: string
  hash: string
  diffStartLine: number
  diffEndLine: number
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
  additions: number
  deletions: number
  resolved: boolean
  comment?: string
  updatedAt: number
  review?: BlockReview
}

export type LedgerFile = {
  id: string
  path: string
  content: string
  patch: string
  hash: string
  status?: FileStatus
  additions: number
  deletions: number
  updatedAt: number
  analysis?: FileAnalysis
  blocks: LedgerBlock[]
}

export type FileDiff = {
  file?: string
  path?: string
  patch?: string
  before?: string
  after?: string
  additions?: number
  deletions?: number
  status?: string
}

export type ParsedBlock = {
  id?: string
  patch: string
  diffStartLine: number
  diffEndLine: number
  oldStart: number
  oldEnd: number
  newStart: number
  newEnd: number
  additions: number
  deletions: number
}

export type LedgerKey = { name?: string; sequence?: string; ctrl?: boolean; shift?: boolean; preventDefault?: () => void; stopPropagation?: () => void }
export type LedgerAction = "down" | "up" | "nextFile" | "prevFile" | "diffLeft" | "diffRight" | "yank" | "yankComments" | "comment" | "approve" | "editor" | "inspect" | "explanation" | "layout" | "diffDown" | "diffUp" | "prevBlock" | "nextBlock" | "help" | "analyze" | "analyzeAll" | "stop" | "back" | "close"
export type InspectFocus = "diff" | "explanation"
export type InspectLayout = "side" | "bottom"
export type VisibleDiffKind = "code" | "add" | "delete"
export type VisibleDiffLine = { key: string; line: string; rowIndex: number; kind: VisibleDiffKind; blockID?: string; diffLineIndex?: number; fileLine?: number }
export type LedgerNotice = { text: string; fg: string }
export type LedgerScope = { id: string; directory: string }

export type LedgerControls = {
  scopeID(): string
  commentEditing(): boolean
  cancelComment(): void
  move(delta: number): void
  scrollDiff(delta: number): void
  scrollDiffHorizontal(delta: number): void
  scrollExplanation(delta: number): void
  jumpBlock(delta: number): void
  yank(): void
  yankComments(): void
  comment(): void
  approve(): void
  editor(): void
  inspect(): void
  explanation(): void
  layout(): void
  analyze(): void
  analyzeAll(): void
  stop(): void
  back(): void
  close(): void
  refresh(preserveID?: string): void
  notice(text: string, fg?: string): void
  handleKey(key: LedgerKey): boolean
}
