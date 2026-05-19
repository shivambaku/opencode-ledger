import { retrieveReviewContextSync, type RetrievedContext } from "./contextLookup"
import type { LedgerFile, LedgerScope } from "./types"

export type { RetrievedContext } from "./contextLookup"

const contextCache = new Map<string, RetrievedContext>()

function contextCacheKey(scope: LedgerScope, file: LedgerFile) {
  return `${scope.directory}\0${file.path}\0${file.hash}`
}

export async function retrieveReviewContext(scope: LedgerScope, file: LedgerFile): Promise<RetrievedContext> {
  const cacheKey = contextCacheKey(scope, file)
  const cached = contextCache.get(cacheKey)
  if (cached) return cached

  if (typeof Worker === "undefined") {
    const result = retrieveReviewContextSync(scope, file)
    contextCache.set(cacheKey, result)
    return result
  }

  return new Promise((resolve) => {
    let settled = false
    let worker: Worker | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: RetrievedContext) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      worker?.terminate()
      contextCache.set(cacheKey, result)
      resolve(result)
    }
    const fallback = (error?: unknown) => {
      const result = retrieveReviewContextSync(scope, file)
      finish(error && !result.error ? { ...result, error: error instanceof Error ? error.message : String(error) } : result)
    }

    try {
      worker = new Worker(new URL("./contextWorker.ts", import.meta.url), { type: "module" })
      timer = setTimeout(() => fallback(new Error("Context lookup timed out.")), 10000)
      worker.onmessage = (event: MessageEvent<RetrievedContext>) => finish(event.data)
      worker.onerror = (event) => fallback(event instanceof ErrorEvent ? event.error || event.message : event)
      worker.postMessage({ scope, file })
    } catch (error) {
      fallback(error)
    }
  })
}
