// Stable UIMessage type for useChat. The agent is a one-shot Tailwind editor
// (see runTailwindEdit in ./tailwind-edit); the transport emits a single
// `edit_tailwind` tool step manually so the side panel renders progress while
// the lone LLM call runs.

import type { UIMessage } from 'ai'

export type PicanthonTools = {
  edit_tailwind: {
    input: {
      request: string
      selector: string
    }
    output: {
      selector: string
      oldClasses: string
      newClasses: string
      applied: number
      summary: string
    }
  }
}

export type PicanthonUIMessage = UIMessage<unknown, Record<string, never>, PicanthonTools>
