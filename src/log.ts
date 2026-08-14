import path from "node:path"
import { appendFileSync, mkdirSync } from "node:fs"

type LogLevel = "debug" | "info" | "error"

const ranks: Record<LogLevel, number> = { debug: 0, info: 1, error: 2 }

export class GoalLogger {
  private readonly file: string
  private readonly threshold: number

  constructor(directory = process.cwd()) {
    const logDirectory = path.join(directory, "logs")
    mkdirSync(logDirectory, { recursive: true })
    this.file = path.join(logDirectory, "goal-plugin.log")
    const configured = process.env.LOGGING_LEVEL?.toLowerCase() as LogLevel | undefined
    this.threshold = ranks[configured && configured in ranks ? configured : "info"]
  }

  log(level: LogLevel, fields: Record<string, string | number | boolean | null | undefined>): void {
    if (ranks[level] < this.threshold) return
    const line = `[goal] ${new Date().toISOString()} ${Object.entries(fields)
      .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined && entry[1] !== null)
      .map(([key, value]) => `${key}=${String(value).replaceAll("\n", "\\n")}`)
      .join(" ")}`
    appendFileSync(this.file, `${line}\n`)
  }
}
