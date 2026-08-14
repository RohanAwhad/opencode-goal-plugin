import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { GoalRuntime } from "../src/runtime"
import { GoalStore } from "../src/store"
import { GoalLogger } from "../src/log"
import { resolveConfig } from "../src/config"
import type { MessageWithParts } from "../src/types"

type PromptCall = { path: { id: string }; body: Record<string, unknown> }

function setup(options: { messages?: MessageWithParts[]; budgetSeconds?: number | null } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "goal-runtime-test-"))
  const config = resolveConfig({ data_dir: directory, max_error_turns: 3 })
  const calls: PromptCall[] = []
  const client = {
    session: {
      messages: async () => ({ data: options.messages ?? [] }),
      get: async () => ({ data: { agent: "auto-accept", model: { id: "model-1", providerID: "provider-1", variant: "max" } } }),
      promptAsync: async (call: PromptCall) => {
        calls.push(call)
        return { data: undefined }
      },
    },
  } as unknown as PluginInput["client"]
  const store = new GoalStore(directory)
  const goal = store.create("s1", "ship", options.budgetSeconds ?? null)
  const runtime = new GoalRuntime(client, store, config, new GoalLogger(directory))
  return { runtime, store, calls, goal }
}

function finalMessage(id: string, error?: unknown): MessageWithParts["info"] {
  return {
    id,
    sessionID: "s1",
    role: "assistant",
    time: { completed: Date.now() },
    error,
    tokens: { input: 10, output: 4, reasoning: 2 },
  }
}

describe("GoalRuntime continuation", () => {
  test("starts one stamped continuation and deduplicates", async () => {
    const { runtime, store, calls } = setup()
    expect(await runtime.continueIfIdle("s1")).toBe(true)
    expect(await runtime.continueIfIdle("s1")).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body).toMatchObject({
      noReply: false,
      agent: "auto-accept",
      model: { providerID: "provider-1", modelID: "model-1" },
      variant: "max",
    })
    expect(store.get("s1")?.continuationInFlight).toBe(true)
  })

  test("gates while a background job is running", async () => {
    const running: MessageWithParts = {
      info: { id: "m1", sessionID: "s1", role: "assistant" },
      parts: [{ type: "tool", tool: "background_bash", state: { metadata: { jobId: "bg_1", state: "running" } } }],
    }
    const { runtime, calls } = setup({ messages: [running] })
    expect(await runtime.continueIfIdle("s1")).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test("accounts a completed turn and resets the in-flight guard", async () => {
    const { runtime, store } = setup()
    await runtime.continueIfIdle("s1")
    await runtime.onMessageUpdated(finalMessage("m1"))
    const goal = store.get("s1")
    expect(goal?.continuationInFlight).toBe(false)
    expect(goal?.tokensUsed).toBe(16)
    expect(goal?.timeUsedSeconds).toBeGreaterThanOrEqual(0)
  })

  test("three consecutive error turns block the goal", async () => {
    const { runtime, store } = setup()
    for (let index = 1; index <= 3; index++) {
      const goal = store.get("s1")
      if (!goal) throw new Error("missing goal")
      runtime.beginCommandTurn("s1", goal)
      await runtime.onMessageUpdated(finalMessage(`m${index}`, new Error("failed")))
    }
    expect(store.get("s1")?.status).toBe("blocked")
    expect(store.get("s1")?.consecutiveErrorTurns).toBe(3)
  })

  test("time budget stops the loop at a turn boundary", async () => {
    const { runtime, store, goal } = setup({ budgetSeconds: 0.001 })
    runtime.beginCommandTurn("s1", goal)
    await Bun.sleep(5)
    await runtime.onMessageUpdated(finalMessage("m1"))
    expect(store.get("s1")?.status).toBe("budget_limited")
  })

  test("in-turn completion wins over budget and final accounting is preserved", async () => {
    const { runtime, store, goal, calls } = setup({ budgetSeconds: 0.001 })
    runtime.beginCommandTurn("s1", goal)
    store.mutate("s1", (current) => current && { ...current, status: "complete", continuationInFlight: false })
    await Bun.sleep(5)
    await runtime.onMessageUpdated(finalMessage("m1"))

    expect(store.get("s1")?.status).toBe("complete")
    expect(store.get("s1")?.tokensUsed).toBe(16)
    expect(calls).toHaveLength(0)
  })
})
