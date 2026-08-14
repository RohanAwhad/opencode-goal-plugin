import type { MessageWithParts } from "./types"

function metadataJobID(part: Record<string, unknown>): string | undefined {
  const state = part.state
  if (!state || typeof state !== "object") return undefined
  const metadata = (state as Record<string, unknown>).metadata
  if (!metadata || typeof metadata !== "object") return undefined
  const value = (metadata as Record<string, unknown>).jobId
  return typeof value === "string" ? value : undefined
}

function stateMetadata(part: Record<string, unknown>): Record<string, unknown> {
  const state = part.state
  if (!state || typeof state !== "object") return {}
  const metadata = (state as Record<string, unknown>).metadata
  return metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {}
}

export function outstandingBackgroundJobIDs(messages: MessageWithParts[]): string[] {
  const running = new Set<string>()
  const terminal = new Set<string>()

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool" && part.tool === "background_bash") {
        const metadata = stateMetadata(part)
        const id = metadataJobID(part)
        if (id && metadata.state === "running") running.add(id)
      }
      if (part.type === "tool" && (part.tool === "background_kill" || part.tool === "background_status")) {
        const state = part.state
        const input = state && typeof state === "object" ? (state as Record<string, unknown>).input : undefined
        const id = input && typeof input === "object" ? (input as Record<string, unknown>).job_id : undefined
        const metadata = stateMetadata(part)
        if (typeof id === "string" && ["cancelled", "exited", "failed"].includes(String(metadata.state))) terminal.add(id)
      }
      if (part.type !== "text" || typeof part.text !== "string") continue
      const blocks = part.text.matchAll(/<task-notification>[\s\S]*?<task-id>([^<]+)<\/task-id>[\s\S]*?<status>([^<]+)<\/status>[\s\S]*?<\/task-notification>/g)
      for (const match of blocks) {
        if (!["running", "stalled"].includes(match[2] ?? "")) terminal.add(match[1] as string)
      }
    }
  }

  for (const id of terminal) running.delete(id)
  return [...running].sort()
}
