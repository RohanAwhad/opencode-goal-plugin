import type { Goal, GoalCommand, GoalPluginConfig, GoalStatus } from "./types"
import { GoalStore } from "./store"

export type CommandOutcome = {
  artifact: string
  goal: Goal | null
  modelPrompt: "continuation" | "objective_updated" | "handled"
}

const frozenStatuses = new Set<GoalStatus>(["complete", "budget_limited"])

export function parseGoalCommand(argumentsText: string): GoalCommand {
  const value = argumentsText.trim()
  if (!value || value === "show") return { type: "show" }
  if (value === "pause") return { type: "pause" }
  if (value === "resume") return { type: "resume" }
  if (value === "clear") return { type: "clear" }
  if (value === "edit") return { type: "edit" }
  if (value.startsWith("edit ")) return { type: "edit", objective: value.slice(5).trim() }
  return { type: "set", objective: value }
}

export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return `${hours}h ${minutes}m ${remainder}s`
}

export function elapsedSeconds(goal: Goal, now = Date.now()): number {
  const end = frozenStatuses.has(goal.status) ? goal.updatedAt : now
  const paused =
    goal.pausedTotalSeconds +
    (goal.pausedAt !== null && end > goal.pausedAt ? (end - goal.pausedAt) / 1000 : 0)
  return Math.max(0, (end - goal.createdAt) / 1000 - paused)
}

export function renderArtifact(goal: Goal | null, note: string, now = Date.now()): string {
  if (!goal) return `Goal — NONE\n\n${note}`
  return [
    `Goal — ${goal.status.toUpperCase()}`,
    "",
    goal.objective,
    "",
    `Elapsed: ${formatElapsed(elapsedSeconds(goal, now))}`,
    note,
  ].join("\n")
}

export function applyGoalCommand(
  store: GoalStore,
  sessionID: string,
  command: GoalCommand,
  config: GoalPluginConfig,
  now = Date.now(),
): CommandOutcome {
  const current = store.get(sessionID)

  if (command.type === "show") {
    return {
      artifact: renderArtifact(current, current ? statusNote(current.status) : "Run /goal <objective> to set one."),
      goal: current,
      modelPrompt: "handled",
    }
  }

  if (command.type === "set") {
    if (current && ["active", "paused", "blocked"].includes(current.status)) {
      return {
        artifact: renderArtifact(current, "An unfinished goal already exists. Run /goal clear first or /goal edit <objective>."),
        goal: current,
        modelPrompt: "handled",
      }
    }
    const budget = config.time_budget_minutes === null ? null : config.time_budget_minutes * 60
    const goal = store.create(sessionID, command.objective, budget)
    return {
      artifact: renderArtifact(goal, "Continuation starts now and repeats whenever the session is idle."),
      goal,
      modelPrompt: "continuation",
    }
  }

  if (command.type === "edit") {
    if (!current) {
      return { artifact: renderArtifact(null, "No goal to edit."), goal: null, modelPrompt: "handled" }
    }
    if (!command.objective) {
      return {
        artifact: renderArtifact(current, "Usage: /goal edit <new objective>"),
        goal: current,
        modelPrompt: "handled",
      }
    }
    if (!["active", "paused", "blocked"].includes(current.status)) {
      return {
        artifact: renderArtifact(current, "This goal is finished. Set a new goal instead."),
        goal: current,
        modelPrompt: "handled",
      }
    }
    const goal = store.mutate(sessionID, (value) => value && { ...value, objective: command.objective as string })
    return {
      artifact: renderArtifact(goal, goal?.status === "active" ? "The active objective was updated." : "The objective was updated; resume to continue."),
      goal,
      modelPrompt: goal?.status === "active" ? "objective_updated" : "handled",
    }
  }

  if (command.type === "pause") {
    if (!current || current.status !== "active") {
      return { artifact: renderArtifact(current, "Only an active goal can be paused."), goal: current, modelPrompt: "handled" }
    }
    const goal = store.mutate(sessionID, (value) => value && {
      ...value,
      status: "paused",
      continuationInFlight: false,
      pausedAt: now,
    })
    return { artifact: renderArtifact(goal, "Automatic continuation is paused."), goal, modelPrompt: "handled" }
  }

  if (command.type === "resume") {
    if (!current || !["paused", "blocked"].includes(current.status)) {
      return { artifact: renderArtifact(current, "Only a paused or blocked goal can be resumed."), goal: current, modelPrompt: "handled" }
    }
    const goal = store.mutate(sessionID, (value) => value && {
      ...value,
      status: "active",
      consecutiveErrorTurns: 0,
      continuationInFlight: false,
      pausedAt: null,
      pausedTotalSeconds:
        value.pausedAt !== null ? value.pausedTotalSeconds + (now - value.pausedAt) / 1000 : value.pausedTotalSeconds,
    })
    return { artifact: renderArtifact(goal, "Automatic continuation resumes now."), goal, modelPrompt: "continuation" }
  }

  store.clear(sessionID)
  return { artifact: renderArtifact(null, current ? "Goal cleared." : "No goal was set."), goal: null, modelPrompt: "handled" }
}

function statusNote(status: Goal["status"]): string {
  if (status === "active") return "Continuation auto-starts whenever the session is idle."
  if (status === "paused") return "Run /goal resume to continue."
  if (status === "blocked") return "Run /goal resume to begin a fresh blocked audit."
  if (status === "budget_limited") return "The configured time limit stopped automatic continuation."
  return "The model marked this goal complete."
}
