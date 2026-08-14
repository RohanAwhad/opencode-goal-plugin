import { describe, expect, test } from "bun:test"
import path from "node:path"
import { testInternals } from "../src/goal-tui"

describe("goal TUI badge helpers", () => {
  test("uses the shared session file path and compact labels", () => {
    expect(testInternals.goalPath("/tmp/goals", "session/one")).toBe(
      path.join("/tmp/goals", "goals", "session%2Fone.json"),
    )
    expect(testInternals.shortElapsed(59)).toBe("59s")
    expect(testInternals.shortElapsed(61)).toBe("1m")
    expect(testInternals.shortElapsed(3660)).toBe("1h 1m")
    expect(testInternals.shortObjective("x".repeat(40))).toHaveLength(36)
  })
})
