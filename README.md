# OpenCode Goal Plugin

Persistent, per-session goals for OpenCode. An active goal starts another model turn whenever the session becomes idle and stops only when the model marks it complete/blocked, the user pauses/clears it, or the configured time/error guard fires.

## Install from GitHub

Install the pushed `main` branch globally with OpenCode:

```sh
opencode plugin "github:RohanAwhad/opencode-goal-plugin#main" --global
```

The installer detects the package's server and TUI exports. Add the command definition to the global `opencode.json` once:

```jsonc
{
  "command": {
    "goal": {
      "description": "Set or manage the session goal",
      "template": "$ARGUMENTS",
      "subtask": false
    }
  }
}
```

Restart OpenCode, then use `/goal <objective>`. Pin a tag or commit instead of `main` when reproducible installs are needed.

> **TUI badge caveat (OpenCode ≤ 1.18.x):** the TUI silently skips plugins referenced as
> `github:owner/repo#branch` specs — the server plugin loads and `/goal` works, but no badge
> renders and no error is logged. Point `tui.json` at a local checkout of this repository instead
> (see the local-development form below); the `tui.json` entry can stay local while
> `opencode.json` keeps the `github:` spec for the server plugin.

## Install for local development

1. Run `bun install` in this repository.
2. Add the repository directory as a server plugin and register the `goal` command in `opencode.json`:

```jsonc
{
  "plugin": [
    [
      "/absolute/path/to/opencode-goal-plugin",
      {
        "goal": {
          "enabled": true,
          "data_dir": "~/.local/share/opencode/goal-plugin",
          "time_budget_minutes": null,
          "max_error_turns": 3,
          "auto_continue": true
        }
      }
    ]
  ],
  "command": {
    "goal": {
      "description": "Set or manage the session goal",
      "template": "$ARGUMENTS",
      "subtask": false
    }
  }
}
```

3. Add the same repository and `data_dir` to `tui.json` for the persistent badge:

```jsonc
{
  "plugin": [
    [
      "/absolute/path/to/opencode-goal-plugin",
      {
        "goal": {
          "data_dir": "~/.local/share/opencode/goal-plugin"
        }
      }
    ]
  ]
}
```

OpenCode keeps server and TUI plugin configuration separate. The package exports `./server` and `./tui`; each runtime selects its entrypoint from the same directory package. See [`opencode.example.jsonc`](opencode.example.jsonc) and [`tui.example.jsonc`](tui.example.jsonc).

Unattended goals require an agent whose tool permissions do not wait for interactive approval.

## Commands

- `/goal <objective>` — create a goal and begin the first continuation turn.
- `/goal` or `/goal show` — show current state.
- `/goal edit <objective>` — replace an unfinished goal's objective.
- `/goal pause` — stop after the current turn.
- `/goal resume` — resume a paused/blocked goal with fresh error accounting.
- `/goal clear` — remove the goal.

OpenCode always submits registered commands as model turns. The plugin rewrites new-goal, edit, and resume command turns into useful continuation prompts. Show/pause/clear are rewritten into minimal acknowledgment turns after the state change is persisted.

Terminal model transitions are visible in the `goal_update` tool result. System budget/error transitions are visible in the persistent badge, file log, and `/goal` summary. The plugin does not append a terminal `noReply` user message because OpenCode can treat that dangling message as replyable when a session is resumed.

## Model tools

- `goal_get`
- `goal_create`
- `goal_update` (`complete` or `blocked` only)

## Development

```sh
bun test
bun run typecheck
bun run validate
```

Logs are written to `logs/goal-plugin.log`. Set `LOGGING_LEVEL=debug|info|error` to control verbosity. The plugin does not write to stdout because OpenCode's TUI owns that renderer surface.

Design details: [`docs/GOAL_PLUGIN.md`](docs/GOAL_PLUGIN.md). Codex reference source is vendored in the sibling repository at `../opencode-background-agent/external_libs/codex`.
