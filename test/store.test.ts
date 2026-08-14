import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { GoalStore } from "../src/store"

function tempDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "goal-store-test-"))
}

describe("GoalStore", () => {
  test("creates, persists, and reloads a typed goal", () => {
    const directory = tempDirectory()
    const first = new GoalStore(directory)
    const created = first.create("session/one", "  ship it  ", 60, 100)

    expect(created.objective).toBe("ship it")
    expect(created.status).toBe("active")
    expect(created.timeBudgetSeconds).toBe(60)
    expect(fs.existsSync(first.pathFor("session/one"))).toBe(true)
    expect(first.pathFor("session/one")).not.toContain("session/one.json")

    first.mutate("session/one", (goal) => goal && { ...goal, continuationInFlight: true })
    const restored = new GoalStore(directory).get("session/one")
    expect(restored?.goalID).toBe(created.goalID)
    expect(restored?.continuationInFlight).toBe(false)
  })

  test("unfinished goal cannot be overwritten but terminal goal can", () => {
    const store = new GoalStore(tempDirectory())
    store.create("s1", "first", null)
    expect(() => store.create("s1", "second", null)).toThrow("unfinished goal")
    store.mutate("s1", (goal) => goal && { ...goal, status: "complete" })
    expect(store.create("s1", "second", null).objective).toBe("second")
  })

  test("clear removes persisted state", () => {
    const store = new GoalStore(tempDirectory())
    store.create("s1", "first", null)
    const file = store.pathFor("s1")
    store.clear("s1")
    expect(store.get("s1")).toBeNull()
    expect(fs.existsSync(file)).toBe(false)
  })
})
