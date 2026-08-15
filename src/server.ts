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

function goalToolOutput(goal: Goal): { output: string; metadata: Record<string, unknown> } {
  return {
    output: `status: ${goal.status}\nobjective: ${goal.objective}`,
    metadata: { found: true, status: goal.status },
  }
}

function activeOnlyRefusal(goal: Goal | null): { output: string; metadata: Record<string, unknown> } {
  return {
    output: goal
      ? `The session goal is ${goal.status}; goal tools work only while the goal is active.`
      : "No active goal in this session. Goals are created with the /goal command.",
    metadata: { allowed: false, status: goal?.status ?? "none" },
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
      description: "Read the active goal for this session. Returns status and objective; refuses when no goal is active. Usage accounting is user-facing.",
      args: {},
      async execute(_args, ctx) {
        const goal = store.get(ctx.sessionID)
        if (!goal || goal.status !== "active") return activeOnlyRefusal(goal)
        return goalToolOutput(goal)
      },
    }),
    goal_update: tool({
      description: "Mark the active goal complete only after proving every requirement, or blocked only after the same blocker repeats for 3 consecutive goal turns. Refuses unless a goal is active. Pause, resume, and budget states are user/system controlled.",
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
        if (!current || current.status !== "active") return activeOnlyRefusal(current)
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
