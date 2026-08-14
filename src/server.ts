import { tool, type Hooks, type Plugin, type PluginModule } from "@opencode-ai/plugin"
import { z } from "zod"
import { resolveConfig, goalOptions } from "./config"
import { GoalStore } from "./store"
import { GoalLogger } from "./log"
import { GoalRuntime } from "./runtime"
import { applyGoalCommand, parseGoalCommand, renderArtifact } from "./commands"
import {
  assertNoUsageLanguage,
  buildCompactionContext,
  buildContinuationPrompt,
  buildObjectiveUpdatedPrompt,
  goalSystemGuidance,
} from "./prompts"
import type { Goal, GoalPluginConfig, MessageWithParts } from "./types"

function replaceCommandParts(parts: unknown[], text: string): void {
  parts.splice(0, parts.length, { type: "text", text })
}

function goalToolOutput(goal: Goal | null): { output: string; metadata: Record<string, unknown> } {
  if (!goal) return { output: "No goal is currently set.", metadata: { found: false } }
  return {
    output: `status: ${goal.status}\nobjective: ${goal.objective}`,
    metadata: { found: true, status: goal.status },
  }
}

const server: Plugin = async (input, options) => {
  let config = resolveConfig(goalOptions(options))
  const store = new GoalStore(config.data_dir)
  const logger = new GoalLogger(input.directory)
  const runtime = new GoalRuntime(input.client, store, config, logger)
  logger.log("info", { event: "init", enabled: config.enabled, data_dir: config.data_dir })

  const tools: Hooks["tool"] = {
    goal_get: tool({
      description: "Read the current goal for this session. Returns only status and objective; usage accounting is user-facing.",
      args: {},
      async execute(_args, ctx) {
        return goalToolOutput(store.get(ctx.sessionID))
      },
    }),
    goal_create: tool({
      description: "Create a goal only when explicitly requested by the user or system instructions. Never infer a goal from an ordinary task. Omit time_budget_minutes unless explicitly requested.",
      args: {
        objective: z.string().describe("Concrete objective to persist and pursue"),
        time_budget_minutes: z.number().positive().optional().describe("Positive time limit; omit unless explicitly requested"),
      },
      async execute(args, ctx) {
        const objective = args.objective.trim()
        if (!objective) return { output: "Cannot create a goal with an empty objective.", metadata: { created: false } }
        const current = store.get(ctx.sessionID)
        if (current && ["active", "paused", "blocked"].includes(current.status)) {
          return {
            output: "Cannot create a new goal because this session has an unfinished goal; complete or clear the existing goal first.",
            metadata: { created: false, goalID: current.goalID },
          }
        }
        const minutes = args.time_budget_minutes ?? config.time_budget_minutes
        const goal = store.create(ctx.sessionID, objective, minutes === null || minutes === undefined ? null : minutes * 60)
        logger.log("info", { event: "set", session: ctx.sessionID, goal: goal.goalID, via: "tool" })
        return goalToolOutput(goal)
      },
    }),
    goal_update: tool({
      description: "Mark the current goal complete only after proving every requirement, or blocked only after the same blocker repeats for 3 consecutive goal turns. Pause, resume, and budget states are user/system controlled.",
      args: {
        status: z.string().describe("Only complete or blocked"),
      },
      async execute(args, ctx) {
        if (args.status !== "complete" && args.status !== "blocked") {
          return {
            output: "goal_update only accepts complete or blocked; pause, resume, and budget statuses are controlled by the user or system.",
            metadata: { updated: false },
          }
        }
        const current = store.get(ctx.sessionID)
        if (!current) return { output: "Cannot update goal because this session has no goal.", metadata: { updated: false } }
        const goal = store.mutate(ctx.sessionID, (value) => value && {
          ...value,
          status: args.status as "complete" | "blocked",
          continuationInFlight: false,
        }) as Goal
        logger.log("info", { event: "status", session: ctx.sessionID, goal: goal.goalID, status: goal.status, via: "tool" })
        return {
          title: `Goal — ${goal.status.toUpperCase()}`,
          ...goalToolOutput(goal),
        }
      },
    }),
  }

  const hooks: Hooks = {
    tool: config.enabled ? tools : {},
    dispose: async () => runtime.dispose(),
    config: async (next) => {
      for (const plugin of next.plugin ?? []) {
        if (!Array.isArray(plugin)) continue
        const options = plugin[1]
        if (!options || typeof options !== "object") continue
        const candidate = (options as Record<string, unknown>).goal
        if (!candidate || typeof candidate !== "object") continue
        config = resolveConfig(candidate, config)
        runtime.updateConfig(config)
      }
      logger.log("info", { event: "config", enabled: config.enabled, auto_continue: config.auto_continue })
    },
    "command.execute.before": async ({ command, sessionID, arguments: argumentsText }, output) => {
      if (command !== "goal" || !config.enabled) return
      const parsed = parseGoalCommand(argumentsText)
      const before = store.get(sessionID)
      const outcome = applyGoalCommand(store, sessionID, parsed, config)
      if (parsed.type === "clear") runtime.cancelTurn(sessionID)
      if (outcome.goal && outcome.goal.goalID !== before?.goalID) {
        logger.log("info", { event: "set", session: sessionID, goal: outcome.goal.goalID, via: "command" })
      } else {
        logger.log("info", { event: "command", session: sessionID, action: parsed.type, status: outcome.goal?.status ?? "none" })
      }
      await runtime.injectArtifact(sessionID, outcome.artifact)
      if (outcome.modelPrompt === "continuation" && outcome.goal) {
        const goal = runtime.beginCommandTurn(sessionID, outcome.goal)
        replaceCommandParts(output.parts, buildContinuationPrompt(goal.objective))
        return
      }
      if (outcome.modelPrompt === "objective_updated" && outcome.goal) {
        const goal = runtime.beginCommandTurn(sessionID, outcome.goal)
        replaceCommandParts(output.parts, buildObjectiveUpdatedPrompt(goal.objective))
        return
      }
      replaceCommandParts(
        output.parts,
        `<goal-command-result>\n${outcome.artifact}\n</goal-command-result>\nThe plugin already handled this command. Briefly acknowledge the resulting goal state; do not perform goal work in this command turn.`,
      )
    },
    event: async ({ event }) => {
      if (event.type === "message.updated") {
        await runtime.onMessageUpdated(event.properties.info as MessageWithParts["info"])
        return
      }
      if (event.type === "session.error") {
        runtime.markError(event.properties.sessionID)
        return
      }
      if (event.type === "session.idle") {
        await runtime.onIdle(event.properties.sessionID)
        return
      }
      if (event.type === "session.deleted") runtime.deleteSession(event.properties.info.id)
    },
    "experimental.chat.system.transform": async ({ sessionID }, output) => {
      if (!sessionID || store.get(sessionID)?.status !== "active") return
      output.system.push(...goalSystemGuidance)
    },
    "experimental.session.compacting": async ({ sessionID }, output) => {
      const goal = store.get(sessionID)
      if (!goal) return
      const context = buildCompactionContext(goal)
      assertNoUsageLanguage(context)
      output.context.push(context)
      logger.log("info", { event: "compact", session: sessionID, goal: goal.goalID, status: goal.status })
    },
  }

  assertNoUsageLanguage(buildContinuationPrompt("test"))
  return hooks
}

const plugin: PluginModule = {
  id: "opencode-goal-plugin",
  server,
}

export default plugin
