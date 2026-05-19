import type { LedgerAction, LedgerKey } from "./types"
import { ledgerActionConfigs } from "./constants"

const keyActions = new Map<string, LedgerAction>()
for (const item of ledgerActionConfigs) {
  for (const key of [...item.keys, ...(item.aliases ?? [])]) keyActions.set(key, item.action)
}

function modifiedKey(key: LedgerKey, value: string) {
  if (key.ctrl) return `ctrl+${value.toLowerCase()}`
  if (key.shift) return `shift+${value.toLowerCase()}`
  return value
}

export function ledgerAction(key: LedgerKey): LedgerAction | undefined {
  const value = key.name || key.sequence
  if (!value) return undefined
  return keyActions.get(modifiedKey(key, value)) ?? keyActions.get(value)
}
