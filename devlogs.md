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

## 2026-08-15 — active-only model tools (v2)

- Dropped `goal_create` from the `tool` hook: goals are created exclusively via `/goal` (spec deviation from Codex documented in `GOAL_PLUGIN.md` §8).
- `goal_get`/`goal_update` now refuse with an instructive message unless the session goal is `active` (`activeOnlyRefusal` in `src/server.ts`).
- Verified against opencode source: the `tool` hook is a static record snapshotted once at startup (`ToolRegistry.state`, `packages/opencode/src/tool/registry.ts:199-204`) — no dynamic per-state registration exists, so active-only enforcement lives inside each tool's `execute`.
- Updated `scripts/validate.ts` (asserts `goal_create` absent), `test/server.test.ts` (active-only gating flow via `/goal` command), README, and spec (`GOAL_PLUGIN.md` §5.1/§8/§12/§17/§20, new S5b scenario).

## 2026-08-15 — elapsed time bug fix (v3, wall-clock accounting)

**Bug:** "Elapsed" displayed model-turn durations, not real elapsed time. `timeUsedSeconds` only accrued per continuation turn (start snapshot → finalize delta); the clock froze between turns, so a goal active for hours showed seconds. Transcript artifacts also never passed an in-flight start, so `/goal set` showed a permanent `Elapsed: 0h 0m 0s`. The TUI badge's in-flight estimate used `updatedAt` (last store write), not the real turn start.

**Fix (root cause):** elapsed is now **wall-clock since `createdAt` minus paused time**:
- `types.ts`: new `pausedAt` (nullable) + `pausedTotalSeconds` fields, zod `.default()` so pre-v3 goal files parse unchanged.
- `commands.ts`: `elapsedSeconds(goal, now)` = `(end - createdAt)/1000 - paused`, frozen at `updatedAt` for `complete`/`budget_limited`; `renderArtifact` drops the dead `turnStartedAt` param; `/goal pause` records `pausedAt`, `/goal resume` accrues `pausedTotalSeconds`; `applyGoalCommand` takes an injectable `now` for deterministic tests.
- `runtime.ts`: `finalizeTurn` charges wall-clock elapsed; `continueIfIdle` pre-checks the budget while idle (budget can now expire between turns); `seconds` log = total wall elapsed.
- `goal-tui.tsx`: badge uses wall-clock elapsed — the 30 s ticker now matches a real watch.
- `types.ts`/`store.ts`/`goal-tui.tsx`: `normalizeGoal` backfills `pausedAt` from `updatedAt` for legacy paused goal files (pre-v3 pauses were never recorded; without backfill a goal paused 32 h ago showed 32 h of elapsed).
- Tests: wall-clock rendering, pause exclusion/accrual, terminal freeze, idle-time budget expiry. `bun test` 25 pass, `tsc --noEmit` clean.
- Gotcha recorded: `blocked` counts toward elapsed (only explicit pauses subtract); pause while a goal is `paused` is impossible (guard), so `pausedAt` is always null when non-paused.

## 2026-08-15 — TUI badge: drop objective text (v0.1.3)

- The `session_prompt_right` badge now renders only `STATUS · elapsed` (`ACTIVE · 2m`); the truncated objective was removed (`src/goal-tui.tsx`).
- Removed the now-unused `shortObjective` helper and its test (`test/tui.test.ts`); `testInternals` keeps `goalPath`/`shortElapsed`/`formatElapsed`.
- Updated the S14 badge smoke spec in `GOAL_PLUGIN.md` (badge shows `ACTIVE` + elapsed, no objective).
