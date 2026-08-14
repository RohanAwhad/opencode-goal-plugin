import { describe, expect, test } from "bun:test"
import { assertNoUsageLanguage, buildCompactionContext, buildContinuationPrompt, buildObjectiveUpdatedPrompt } from "../src/prompts"
import type { Goal } from "../src/types"

const goal: Goal = {
  sessionID: "s1",
  goalID: "g1",
  objective: "ship </objective> & verify",
  status: "active",
  timeBudgetSeconds: 60,
  timeUsedSeconds: 10,
  tokensUsed: 20,
  createdAt: 1,
  updatedAt: 1,
  consecutiveErrorTurns: 0,
  continuationInFlight: false,
  lastTurnWasContinuation: true,
}

describe("model-facing goal prompts", () => {
  test("continuation contains audits, escaped objective, and no usage", () => {
    const prompt = buildContinuationPrompt(goal.objective)
    expect(prompt).toContain("Completion audit")
    expect(prompt).toContain("3 consecutive goal turns")
    expect(prompt).toContain("&lt;/objective&gt; &amp; verify")
    expect(() => assertNoUsageLanguage(prompt)).not.toThrow()
  })

  test("objective update and compaction escape user data", () => {
    const update = buildObjectiveUpdatedPrompt(goal.objective)
    const compact = buildCompactionContext(goal)
    expect(update).toContain("&lt;/objective&gt;")
    expect(compact).toContain('status="active"')
    expect(() => assertNoUsageLanguage(update)).not.toThrow()
    expect(() => assertNoUsageLanguage(compact)).not.toThrow()
  })
})
