import { describe, expect, test } from "bun:test"
import type { PluginInput, ToolContext } from "@opencode-ai/plugin"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import plugin from "../src/server"

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "goal-server-test-"))
  const prompts: Array<{ path: { id: string }; body: Record<string, unknown> }> = []
  const client = {
    session: {
      get: async () => ({ data: { agent: "auto-accept", model: { id: "m1", providerID: "p1", variant: "default" } } }),
      messages: async () => ({ data: [] }),
      promptAsync: async (call: { path: { id: string }; body: Record<string, unknown> }) => {
        prompts.push(call)
        return { data: undefined }
      },
    },
  }
  const input = {
    client,
    directory,
    worktree: directory,
  } as unknown as PluginInput
  return { directory, prompts, input }
}

function context(sessionID = "s1"): ToolContext {
  return { sessionID } as ToolContext
}

function outputOf(result: string | { output: string }): string {
  return typeof result === "string" ? result : result.output
}

describe("server plugin contracts", () => {
  test("registers goal_get and goal_update only and gates them on an active goal", async () => {
    const { input, directory } = setup()
    const hooks = await plugin.server(input, { goal: { data_dir: directory } })
    const get = hooks.tool?.goal_get
    const update = hooks.tool?.goal_update
    if (!get || !update) throw new Error("goal tools not registered")
    expect(hooks.tool?.goal_create).toBeUndefined()

    expect(outputOf(await get.execute({}, context()))).toContain("No active goal")
    expect(outputOf(await update.execute({ status: "complete" }, context()))).toContain("No active goal")

    const command = hooks["command.execute.before"]
    if (!command) throw new Error("goal command hook not registered")
    const output = { parts: [{ type: "text", text: "ship" }] } as Parameters<typeof command>[1]
    await command({ command: "goal", sessionID: "s1", arguments: "ship" }, output)

    const active = await get.execute({}, context())
    expect(outputOf(active)).toContain("status: active")
    expect(outputOf(active).toLowerCase()).not.toContain("budget")

    const rejected = await update.execute({ status: "paused" }, context())
    expect(outputOf(rejected)).toContain("only accepts complete or blocked")

    const completed = await update.execute({ status: "complete" }, context())
    expect(outputOf(completed)).toContain("status: complete")

    expect(outputOf(await get.execute({}, context()))).toContain("goal is complete; goal tools work only while the goal is active")
    expect(outputOf(await update.execute({ status: "blocked" }, context()))).toContain("goal is complete; goal tools work only while the goal is active")
  })

  test("rewrites a set command into the first continuation and injects an artifact", async () => {
    const { input, directory, prompts } = setup()
    const hooks = await plugin.server(input, { goal: { data_dir: directory } })
    const command = hooks["command.execute.before"]
    if (!command) throw new Error("goal command hook not registered")
    const output = { parts: [{ type: "text", text: "ship" }] } as Parameters<typeof command>[1]

    await command({ command: "goal", sessionID: "s1", arguments: "ship" }, output)

    expect((output.parts[0] as { text?: string }).text).toContain("Continue working toward the active session goal")
    expect(prompts).toHaveLength(1)
    expect(prompts[0]?.body).toMatchObject({ noReply: true, agent: "auto-accept" })
    expect(JSON.stringify(prompts[0]?.body)).toContain("Goal — ACTIVE")
  })
})
