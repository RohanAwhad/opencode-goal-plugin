import path from "node:path"
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { GoalSchema, normalizeGoal, type Goal, type GoalStatus } from "./types"

const unfinishedStatuses = new Set<GoalStatus>(["active", "paused", "blocked"])

export class GoalStore {
  private readonly cache = new Map<string, Goal | null>()
  private dataDirectory: string

  constructor(dataDirectory: string) {
    this.dataDirectory = dataDirectory
    mkdirSync(this.goalsDirectory(), { recursive: true })
  }

  setDataDirectory(dataDirectory: string): void {
    if (dataDirectory === this.dataDirectory) return
    this.dataDirectory = dataDirectory
    this.cache.clear()
    mkdirSync(this.goalsDirectory(), { recursive: true })
  }

  pathFor(sessionID: string): string {
    return path.join(this.goalsDirectory(), `${encodeURIComponent(sessionID)}.json`)
  }

  get(sessionID: string): Goal | null {
    const cached = this.cache.get(sessionID)
    if (cached !== undefined) return cached
    const file = this.pathFor(sessionID)
    if (!existsSync(file)) {
      this.cache.set(sessionID, null)
      return null
    }
    const goal = GoalSchema.parse(JSON.parse(readFileSync(file, "utf8")))
    const restored = normalizeGoal({ ...goal, continuationInFlight: false })
    this.cache.set(sessionID, restored)
    return restored
  }

  create(sessionID: string, objective: string, timeBudgetSeconds: number | null, now = Date.now()): Goal {
    const value = objective.trim()
    if (!value) throw new Error("Goal objective must not be empty.")
    const current = this.get(sessionID)
    if (current && unfinishedStatuses.has(current.status)) {
      throw new Error("Cannot create a new goal because this session has an unfinished goal.")
    }
    const goal: Goal = {
      sessionID,
      goalID: crypto.randomUUID(),
      objective: value,
      status: "active",
      timeBudgetSeconds,
      timeUsedSeconds: 0,
      pausedTotalSeconds: 0,
      pausedAt: null,
      tokensUsed: 0,
      createdAt: now,
      updatedAt: now,
      consecutiveErrorTurns: 0,
      continuationInFlight: false,
      lastTurnWasContinuation: false,
    }
    return this.mutate(sessionID, () => goal) as Goal
  }

  mutate(sessionID: string, update: (goal: Goal | null) => Goal | null): Goal | null {
    const next = update(this.get(sessionID))
    if (!next) {
      const file = this.pathFor(sessionID)
      if (existsSync(file)) unlinkSync(file)
      this.cache.set(sessionID, null)
      return null
    }
    const parsed = GoalSchema.parse({ ...next, updatedAt: Date.now() })
    const file = this.pathFor(sessionID)
    const temporary = `${file}.tmp`
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(temporary, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
    renameSync(temporary, file)
    this.cache.set(sessionID, parsed)
    return parsed
  }

  clear(sessionID: string): void {
    this.mutate(sessionID, () => null)
  }

  private goalsDirectory(): string {
    return path.join(this.dataDirectory, "goals")
  }
}
