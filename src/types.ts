import { z } from "zod"

export const goalStatuses = ["active", "paused", "blocked", "complete", "budget_limited"] as const
export type GoalStatus = (typeof goalStatuses)[number]

export const GoalSchema = z.object({
  sessionID: z.string().min(1),
  goalID: z.string().min(1),
  objective: z.string().min(1),
  status: z.enum(goalStatuses),
  timeBudgetSeconds: z.number().positive().nullable(),
  timeUsedSeconds: z.number().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  consecutiveErrorTurns: z.number().int().nonnegative(),
  continuationInFlight: z.boolean(),
  lastTurnWasContinuation: z.boolean(),
})

export type Goal = z.infer<typeof GoalSchema>

export type GoalPluginConfig = {
  enabled: boolean
  data_dir: string
  time_budget_minutes: number | null
  max_error_turns: number
  auto_continue: boolean
}

export type PromptContext = {
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
}

export type SessionRuntimeInfo = {
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
}

export type GoalCommand =
  | { type: "show" }
  | { type: "set"; objective: string }
  | { type: "edit"; objective?: string }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "clear" }

export type MessageWithParts = {
  info: {
    id: string
    sessionID: string
    role: "user" | "assistant"
    time?: { completed?: number }
    error?: unknown
    tokens?: { input: number; output: number; reasoning: number }
  }
  parts: Array<Record<string, unknown>>
}
