import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { applyGoalCommand, elapsedSeconds, formatElapsed, parseGoalCommand, renderArtifact } from "../src/commands"
import { defaultConfig, resolveConfig } from "../src/config"
import { GoalStore } from "../src/store"
import { normalizeGoal, type Goal } from "../src/types"

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "goal-command-test-"))
  const config = resolveConfig({ ...defaultConfig, data_dir: directory })
  return { store: new GoalStore(directory), config }
}

describe("goal command parsing", () => {
  test("parses controls, edits, and objectives", () => {
    expect(parseGoalCommand("")).toEqual({ type: "show" })
    expect(parseGoalCommand("show")).toEqual({ type: "show" })
    expect(parseGoalCommand("pause")).toEqual({ type: "pause" })
    expect(parseGoalCommand("edit new objective")).toEqual({ type: "edit", objective: "new objective" })
    expect(parseGoalCommand("ship feature")).toEqual({ type: "set", objective: "ship feature" })
  })

  test("configuration validates boundary types", () => {
    expect(() => resolveConfig({ max_error_turns: 0 })).toThrow()
    expect(() => resolveConfig({ enabled: "yes" })).toThrow()
  })
})

describe("goal command transitions", () => {
  test("set, guard, edit, pause, resume, and clear", () => {
    const { store, config } = setup()
    const set = applyGoalCommand(store, "s1", { type: "set", objective: "ship" }, config)
    expect(set.goal?.status).toBe("active")
    expect(set.modelPrompt).toBe("continuation")

    const guarded = applyGoalCommand(store, "s1", { type: "set", objective: "replace" }, config)
    expect(guarded.goal?.objective).toBe("ship")
    expect(guarded.artifact).toContain("unfinished goal")

    const edited = applyGoalCommand(store, "s1", { type: "edit", objective: "ship well" }, config)
    expect(edited.goal?.objective).toBe("ship well")
    expect(edited.modelPrompt).toBe("objective_updated")

    expect(applyGoalCommand(store, "s1", { type: "pause" }, config).goal?.status).toBe("paused")
    const resumed = applyGoalCommand(store, "s1", { type: "resume" }, config)
    expect(resumed.goal?.status).toBe("active")
    expect(resumed.goal?.consecutiveErrorTurns).toBe(0)
    expect(applyGoalCommand(store, "s1", { type: "clear" }, config).goal).toBeNull()
  })

  test("completed goal auto-replaces", () => {
    const { store, config } = setup()
    store.create("s1", "first", null)
    store.mutate("s1", (goal) => goal && { ...goal, status: "complete" })
    expect(applyGoalCommand(store, "s1", { type: "set", objective: "second" }, config).goal?.objective).toBe("second")
  })
})

describe("elapsed rendering", () => {
  test("wall-clock elapsed since creation", () => {
    const { store } = setup()
    const goal = store.create("s1", "ship", null, 10_000)
    expect(formatElapsed(3661)).toBe("1h 1m 1s")
    expect(elapsedSeconds(goal, 16_000)).toBe(6)
    expect(renderArtifact(goal, "note", 16_000)).toContain("Elapsed: 0h 0m 6s")
  })

  test("paused time is excluded and accrued on resume", () => {
    const { store, config } = setup()
    store.create("s1", "ship", null, 10_000)
    applyGoalCommand(store, "s1", { type: "pause" }, config, 20_000)
    const paused = store.get("s1")
    expect(paused?.pausedAt).toBe(20_000)
    expect(elapsedSeconds(paused as never, 30_000)).toBe(10)

    applyGoalCommand(store, "s1", { type: "resume" }, config, 40_000)
    const resumed = store.get("s1")
    expect(resumed?.pausedAt).toBeNull()
    expect(resumed?.pausedTotalSeconds).toBeCloseTo(20, 5)
    expect(elapsedSeconds(resumed as never, 50_000)).toBe(20)
  })

  test("terminal states freeze the clock at the transition", () => {
    const { store } = setup()
    const goal: Goal = { ...store.create("s1", "ship", null, 10_000), status: "complete", updatedAt: 40_000 }
    expect(elapsedSeconds(goal, 1_000_000)).toBe(30)
  })

  test("legacy paused goal files backfill pausedAt from updatedAt", () => {
    const { store } = setup()
    const legacy: Goal = {
      ...store.create("s1", "ship", null, 10_000),
      status: "paused",
      updatedAt: 20_000,
      pausedAt: null,
    }
    const restored = normalizeGoal(legacy)
    expect(restored.pausedAt).toBe(20_000)
    expect(elapsedSeconds(restored, 1_000_000)).toBe(10)
  })
})
