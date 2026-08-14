import os from "node:os"
import path from "node:path"
import { z } from "zod"
import type { GoalPluginConfig } from "./types"

export const defaultConfig: GoalPluginConfig = {
  enabled: true,
  data_dir: "~/.local/share/opencode/goal-plugin",
  time_budget_minutes: null,
  max_error_turns: 3,
  auto_continue: true,
}

const configKeys = [
  "enabled",
  "data_dir",
  "time_budget_minutes",
  "max_error_turns",
  "auto_continue",
] as const

const ConfigSchema = z.object({
  enabled: z.boolean(),
  data_dir: z.string().min(1),
  time_budget_minutes: z.number().positive().nullable(),
  max_error_turns: z.number().int().positive(),
  auto_continue: z.boolean(),
})

export function expandHome(value: string): string {
  if (value === "~") return os.homedir()
  if (value.startsWith(`~${path.sep}`)) return path.join(os.homedir(), value.slice(2))
  return value
}

export function resolveConfig(raw: unknown, base: GoalPluginConfig = defaultConfig): GoalPluginConfig {
  const merged: GoalPluginConfig = { ...base }
  if (raw && typeof raw === "object") {
    const input = raw as Record<string, unknown>
    for (const key of configKeys) {
      if (input[key] !== undefined) (merged as unknown as Record<string, unknown>)[key] = input[key]
    }
  }
  return ConfigSchema.parse({ ...merged, data_dir: path.resolve(expandHome(merged.data_dir)) })
}

export function goalOptions(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return undefined
  const record = raw as Record<string, unknown>
  return record.goal ?? record
}
