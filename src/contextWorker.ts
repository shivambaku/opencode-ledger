import { retrieveReviewContextSync } from "./contextLookup"
import type { LedgerFile, LedgerScope } from "./types"

type Request = { scope: LedgerScope; file: LedgerFile }

self.onmessage = (event: MessageEvent<Request>) => {
  const { scope, file } = event.data
  self.postMessage(retrieveReviewContextSync(scope, file))
}
