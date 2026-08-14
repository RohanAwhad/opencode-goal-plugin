import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { Show, createSignal, onCleanup } from "solid-js"
import { goalOptions, resolveConfig } from "./config"
import { GoalSchema, type Goal } from "./types"
import { elapsedSeconds, formatElapsed } from "./commands"
import path from "node:path"
import { existsSync, readFileSync } from "node:fs"

function goalPath(dataDirectory: string, sessionID: string): string {
  return path.join(dataDirectory, "goals", `${encodeURIComponent(sessionID)}.json`)
}

function shortElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function shortObjective(objective: string): string {
  return objective.length <= 36 ? objective : `${objective.slice(0, 35)}…`
}

function GoalBadge(props: { api: TuiPluginApi; dataDirectory: string; sessionID: string }) {
  const readGoal = (): Goal | null => {
    const file = goalPath(props.dataDirectory, props.sessionID)
    if (!existsSync(file)) return null
    return GoalSchema.parse(JSON.parse(readFileSync(file, "utf8")))
  }
  const [goal, setGoal] = createSignal<Goal | null>(readGoal())
  const [now, setNow] = createSignal(Date.now())

  const refresh = () => {
    setGoal(readGoal())
    setNow(Date.now())
  }

  const interval = setInterval(() => setNow(Date.now()), 30_000)
  const unsubscribers = [
    props.api.event.on("session.idle", (event) => {
      if (event.properties.sessionID === props.sessionID) refresh()
    }),
    props.api.event.on("message.updated", (event) => {
      if (event.properties.info.sessionID === props.sessionID) refresh()
    }),
    props.api.event.on("session.updated", (event) => {
      if (event.properties.info.id === props.sessionID) refresh()
    }),
  ]
  onCleanup(() => {
    clearInterval(interval)
    for (const unsubscribe of unsubscribers) unsubscribe()
  })

  const seconds = () => {
    const value = goal()
    if (!value) return 0
    return elapsedSeconds(value, value.continuationInFlight ? value.updatedAt : undefined, now())
  }
  const color = () => {
    const status = goal()?.status
    if (status === "active") return props.api.theme.current.success
    if (status === "paused") return props.api.theme.current.warning
    if (status === "blocked" || status === "budget_limited") return props.api.theme.current.error
    return props.api.theme.current.textMuted
  }

  return (
    <Show when={goal()}>
      {(value) => (
        <text fg={color()}>
          {value().status.toUpperCase()} · {shortElapsed(seconds())} · {shortObjective(value().objective)}
        </text>
      )}
    </Show>
  )
}

const tui: TuiPlugin = async (api, options) => {
  const config = resolveConfig(goalOptions(options))

  api.slots.register({
    order: 500,
    slots: {
      session_prompt_right(_context, props) {
        return <GoalBadge api={api} dataDirectory={config.data_dir} sessionID={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule = {
  id: "opencode-goal-plugin.tui",
  tui,
}

export default plugin

export const testInternals = { goalPath, shortElapsed, shortObjective, formatElapsed }
