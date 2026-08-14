# Development log

## 2026-08-14 — v1 implementation

- Started from the Codex `/goal` reference and `docs/GOAL_PLUGIN.md`.
- Confirmed Codex source at `../opencode-background-agent/external_libs/codex/codex-rs/ext/goal`.
- Implemented an installable package with separate server/TUI exports, typed JSON goal state, atomic persistence, tools, command handling, idle continuation, time/token accounting, error/budget guards, compaction context, and TUI badge.
- OpenCode 1.18 exposes tool discovery but no API for one plugin to execute another plugin's tool. Background gating therefore derives running/terminal job IDs from session tool results and terminal notification messages.
- OpenCode's `command.execute.before` hook can rewrite but cannot cancel the command's model turn. Goal set/edit/resume reuse that turn; show/pause/clear produce a minimal acknowledgment turn.
- Bare `/goal edit` cannot open a backend-controlled editor. v1 uses `/goal edit <new objective>` and returns usage guidance when the objective is omitted.
- Live OpenCode 1.18 testing showed server plugins come from `opencode.json`, while TUI plugins come from a separate `tui.json`. Added separate examples; both point at the same package and goal data directory.
- Removed console logging after a live TUI smoke showed stdout corrupts the OpenTUI renderer. Structured logs remain in `logs/goal-plugin.log`, controlled by `LOGGING_LEVEL`.
- Terminal `noReply` transcript messages were removed: OpenCode can reply to a dangling no-reply user message when the session is resumed. Model terminal status is shown by the tool result; system terminal status is shown by the badge, logs, and `/goal`.
- Final OpenCode 1.18.18 TUI smoke passed: `/goal` persisted state, the model called `goal_get` then `goal_update complete`, final accounting recorded tokens/time, the loop stopped, and `session_prompt_right` rendered `COMPLETE · 2s · …`. No project files changed during the smoke.
