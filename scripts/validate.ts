import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import serverPlugin from "../src/server"
import tuiPlugin from "../src/goal-tui"

const root = path.resolve(import.meta.dir, "..")
const startedAt = new Date().toISOString()
const test = Bun.spawn(["bun", "test"], { cwd: root, stdout: "pipe", stderr: "pipe" })
const testOutput = await new Response(test.stdout).text()
const testError = await new Response(test.stderr).text()
const testExit = await test.exited

const typecheck = Bun.spawn(["bun", "run", "typecheck"], { cwd: root, stdout: "pipe", stderr: "pipe" })
const typecheckOutput = await new Response(typecheck.stdout).text()
const typecheckError = await new Response(typecheck.stderr).text()
const typecheckExit = await typecheck.exited

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "goal-validate-"))
const client = {
  session: {
    get: async () => ({ data: { agent: "auto-accept", model: { id: "m1", providerID: "p1" } } }),
    messages: async () => ({ data: [] }),
    promptAsync: async () => ({ data: undefined }),
  },
}
const hooks = await serverPlugin.server(
  { client, directory: root, worktree: root } as unknown as PluginInput,
  { goal: { data_dir: dataDirectory } },
)

const checks = [
  ["server package entry", serverPlugin.id === "opencode-goal-plugin" && typeof serverPlugin.server === "function"],
  ["TUI package entry", tuiPlugin.id === "opencode-goal-plugin.tui" && typeof tuiPlugin.tui === "function"],
  ["goal_get tool", Boolean(hooks.tool?.goal_get)],
  ["goal_create tool", Boolean(hooks.tool?.goal_create)],
  ["goal_update tool", Boolean(hooks.tool?.goal_update)],
  ["command hook", Boolean(hooks["command.execute.before"])],
  ["idle event hook", Boolean(hooks.event)],
  ["compaction hook", Boolean(hooks["experimental.session.compacting"])],
] as const

const reportDirectory = path.join(root, "logs", "validate")
fs.mkdirSync(reportDirectory, { recursive: true })
const report = [
  "# Goal plugin validation",
  "",
  `Started: ${startedAt}`,
  `Finished: ${new Date().toISOString()}`,
  "",
  "## Static/runtime contract checks",
  "",
  ...checks.map(([name, passed]) => `- ${passed ? "PASS" : "FAIL"}: ${name}`),
  "",
  "## Unit tests",
  "",
  `Exit: ${testExit}`,
  "",
  "```text",
  (testOutput + testError).trim(),
  "```",
  "",
  "## Typecheck",
  "",
  `Exit: ${typecheckExit}`,
  "",
  "```text",
  (typecheckOutput + typecheckError).trim(),
  "```",
  "",
  "## Scope",
  "",
  "This script proves deterministic package, hook, unit, and type contracts. Live OpenCode/model smoke results are recorded separately in devlogs.md because they require configured providers and a real TUI.",
  "",
].join("\n")
fs.writeFileSync(path.join(reportDirectory, "VALIDATION-REPORT.md"), report, "utf8")

const failed = testExit !== 0 || typecheckExit !== 0 || checks.some(([, passed]) => !passed)
if (failed) throw new Error("Goal plugin validation failed; see logs/validate/VALIDATION-REPORT.md")
console.info("Goal plugin validation passed: logs/validate/VALIDATION-REPORT.md")
