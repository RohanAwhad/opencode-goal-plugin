import type { PluginInput } from "@opencode-ai/plugin"
import type { Goal, GoalPluginConfig, MessageWithParts, PromptContext, SessionRuntimeInfo } from "./types"
import { GoalStore } from "./store"
import { GoalLogger } from "./log"
import { outstandingBackgroundJobIDs } from "./background"
import { buildContinuationPrompt } from "./prompts"
import { elapsedSeconds } from "./commands"

type Client = PluginInput["client"]

type TurnStart = {
  goalID: string
  startedAt: number
}

export class GoalRuntime {
  private config: GoalPluginConfig
  private readonly starts = new Map<string, TurnStart>()
  private readonly pendingErrors = new Set<string>()
  private readonly processedMessages = new Set<string>()
  private readonly processedMessageOrder: string[] = []
  private readonly knownSessions = new Set<string>()

  constructor(
    private readonly client: Client,
    private readonly store: GoalStore,
    config: GoalPluginConfig,
    private readonly logger: GoalLogger,
  ) {
    this.config = config
  }

  updateConfig(config: GoalPluginConfig): void {
    this.config = config
    this.store.setDataDirectory(config.data_dir)
  }

  beginCommandTurn(sessionID: string, goal: Goal): Goal {
    this.knownSessions.add(sessionID)
    const updated = this.store.mutate(sessionID, (current) => current && {
      ...current,
      continuationInFlight: true,
      lastTurnWasContinuation: true,
    }) as Goal
    this.starts.set(sessionID, { goalID: goal.goalID, startedAt: Date.now() })
    this.logger.log("info", { event: "continue", session: sessionID, goal: goal.goalID, via: "command" })
    return updated
  }

  cancelTurn(sessionID: string): void {
    this.starts.delete(sessionID)
    this.pendingErrors.delete(sessionID)
  }

  markError(sessionID: string | undefined): void {
    if (sessionID && this.starts.has(sessionID)) this.pendingErrors.add(sessionID)
  }

  async onMessageUpdated(info: MessageWithParts["info"]): Promise<void> {
    if (info.role !== "assistant" || !info.time?.completed || this.processedMessages.has(info.id)) return
    this.processedMessages.add(info.id)
    this.processedMessageOrder.push(info.id)
    if (this.processedMessageOrder.length > 1000) {
      const oldest = this.processedMessageOrder.shift()
      if (oldest) this.processedMessages.delete(oldest)
    }
    const error = info.error !== undefined || this.pendingErrors.delete(info.sessionID)
    await this.finalizeTurn(info.sessionID, info.tokens, error)
  }

  async onIdle(sessionID: string): Promise<void> {
    this.knownSessions.add(sessionID)
    if (this.starts.has(sessionID)) {
      const error = this.pendingErrors.delete(sessionID)
      await this.finalizeTurn(sessionID, undefined, error)
    }
    await this.continueIfIdle(sessionID)
  }

  async continueIfIdle(sessionID: string): Promise<boolean> {
    const goal = this.store.get(sessionID)
    if (!this.config.enabled || !this.config.auto_continue || !goal || goal.status !== "active") return false
    if (goal.continuationInFlight || this.starts.has(sessionID)) return false
    if (goal.timeBudgetSeconds !== null && elapsedSeconds(goal, Date.now()) >= goal.timeBudgetSeconds) {
      this.store.mutate(sessionID, (current) => current && { ...current, status: "budget_limited", continuationInFlight: false })
      this.logger.log("info", { event: "budget_limited", session: sessionID, goal: goal.goalID })
      return false
    }

    const response = await this.client.session.messages({ path: { id: sessionID } })
    const messages = (response.data ?? []) as MessageWithParts[]
    const jobs = outstandingBackgroundJobIDs(messages)
    if (jobs.length > 0) {
      this.logger.log("info", { event: "continue_gate", session: sessionID, jobs: jobs.join(",") })
      return false
    }

    const active = this.store.mutate(sessionID, (current) => current && {
      ...current,
      continuationInFlight: true,
      lastTurnWasContinuation: true,
    })
    if (!active || active.status !== "active") return false

    const startedAt = Date.now()
    this.starts.set(sessionID, { goalID: active.goalID, startedAt })
    const context = await this.promptContext(sessionID)
    this.logger.log("info", { event: "continue", session: sessionID, goal: active.goalID, via: "idle" })
    const accepted = await this.client.session.promptAsync({
      path: { id: sessionID },
      body: {
        noReply: false,
        ...context,
        parts: [{ type: "text", text: buildContinuationPrompt(active.objective) }],
      },
    })
    if (accepted.error) {
      this.starts.delete(sessionID)
      this.store.mutate(sessionID, (current) => current && { ...current, continuationInFlight: false })
      this.logger.log("error", { event: "continue_rejected", session: sessionID, goal: active.goalID })
      return false
    }
    return true
  }

  async injectArtifact(sessionID: string, text: string): Promise<void> {
    const context = await this.promptContext(sessionID)
    const result = await this.client.session.promptAsync({
      path: { id: sessionID },
      body: { noReply: true, ...context, parts: [{ type: "text", text }] },
    })
    if (result.error) this.logger.log("error", { event: "artifact_rejected", session: sessionID })
  }

  deleteSession(sessionID: string): void {
    this.cancelTurn(sessionID)
    this.knownSessions.delete(sessionID)
    this.store.clear(sessionID)
    this.logger.log("info", { event: "delete", session: sessionID })
  }

  dispose(): void {
    for (const sessionID of this.knownSessions) {
      this.store.mutate(sessionID, (goal) => goal && { ...goal, continuationInFlight: false })
    }
    this.starts.clear()
    this.pendingErrors.clear()
    this.processedMessages.clear()
    this.processedMessageOrder.length = 0
    this.logger.log("info", { event: "dispose" })
  }

  private async finalizeTurn(
    sessionID: string,
    tokens: MessageWithParts["info"]["tokens"],
    error: boolean,
  ): Promise<Goal | null> {
    const start = this.starts.get(sessionID)
    if (!start) return this.store.get(sessionID)
    this.starts.delete(sessionID)
    const now = Date.now()
    const tokenCount = tokens ? tokens.input + tokens.output + tokens.reasoning : 0
    const previous = this.store.get(sessionID)
    const goal = this.store.mutate(sessionID, (current) => {
      if (!current || current.goalID !== start.goalID) return current
      const timeUsedSeconds = elapsedSeconds(current, now)
      const consecutiveErrorTurns = error ? current.consecutiveErrorTurns + 1 : 0
      let status = current.status
      if (status === "active" && consecutiveErrorTurns >= this.config.max_error_turns) status = "blocked"
      if (
        status === "active" &&
        current.timeBudgetSeconds !== null &&
        timeUsedSeconds >= current.timeBudgetSeconds
      ) status = "budget_limited"
      return {
        ...current,
        status,
        timeUsedSeconds,
        tokensUsed: current.tokensUsed + tokenCount,
        consecutiveErrorTurns,
        continuationInFlight: false,
      }
    })
    if (!goal) return null
    this.logger.log("info", {
      event: "account",
      session: sessionID,
      goal: goal.goalID,
      seconds: goal.timeUsedSeconds.toFixed(3),
      tokens: tokenCount,
      error,
      status: goal.status,
    })
    if (previous?.status === "active" && goal.status === "blocked") {
      this.logger.log("error", { event: "blocked", session: sessionID, goal: goal.goalID, system: true })
    }
    if (previous?.status === "active" && goal.status === "budget_limited") {
      this.logger.log("info", { event: "budget_limited", session: sessionID, goal: goal.goalID })
    }
    return goal
  }

  private async promptContext(sessionID: string): Promise<PromptContext> {
    const result = await this.client.session.get({ path: { id: sessionID } })
    const info = result.data as SessionRuntimeInfo | undefined
    if (!info) return {}
    const model = info.model
      ? { providerID: info.model.providerID, modelID: info.model.id }
      : undefined
    const variant = info.model?.variant && info.model.variant !== "default" ? info.model.variant : undefined
    return { agent: info.agent, model, variant }
  }
}
