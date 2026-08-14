import { describe, expect, test } from "bun:test"
import { outstandingBackgroundJobIDs } from "../src/background"
import type { MessageWithParts } from "../src/types"

function messages(parts: Array<Record<string, unknown>>): MessageWithParts[] {
  return [{ info: { id: "m1", sessionID: "s1", role: "assistant" }, parts }]
}

function runningJob(id: string): Record<string, unknown> {
  return {
    type: "tool",
    tool: "background_bash",
    state: { status: "completed", input: {}, metadata: { jobId: id, state: "running" } },
  }
}

describe("background continuation gate", () => {
  test("reports running jobs", () => {
    expect(outstandingBackgroundJobIDs(messages([runningJob("bg_1")]))).toEqual(["bg_1"])
  })

  test("terminal notification clears a running job", () => {
    const terminal = {
      type: "text",
      text: "<task-notification>\n<task-id>bg_1</task-id>\n<status>exited</status>\n</task-notification>",
    }
    expect(outstandingBackgroundJobIDs(messages([runningJob("bg_1"), terminal]))).toEqual([])
  })

  test("stalled notification keeps the gate closed", () => {
    const stalled = {
      type: "text",
      text: "<task-notification>\n<task-id>bg_1</task-id>\n<status>stalled</status>\n</task-notification>",
    }
    expect(outstandingBackgroundJobIDs(messages([runningJob("bg_1"), stalled]))).toEqual(["bg_1"])
  })
})
