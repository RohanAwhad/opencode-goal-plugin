# Goal plugin validation

Started: 2026-08-14T17:31:39.700Z
Finished: 2026-08-14T17:31:40.421Z

## Static/runtime contract checks

- PASS: server package entry
- PASS: TUI package entry
- PASS: goal_get tool
- PASS: goal_create tool
- PASS: goal_update tool
- PASS: command hook
- PASS: idle event hook
- PASS: compaction hook

## Unit tests

Exit: 0

```text
bun test v1.3.14 (0d9b296a)

test/background.test.ts:
(pass) background continuation gate > reports running jobs [0.22ms]
(pass) background continuation gate > terminal notification clears a running job [0.22ms]
(pass) background continuation gate > stalled notification keeps the gate closed [0.03ms]

test/store.test.ts:
(pass) GoalStore > creates, persists, and reloads a typed goal [1.69ms]
(pass) GoalStore > unfinished goal cannot be overwritten but terminal goal can [0.62ms]
(pass) GoalStore > clear removes persisted state [0.30ms]

test/tui.test.ts:
(pass) goal TUI badge helpers > uses the shared session file path and compact labels [0.05ms]

test/commands.test.ts:
(pass) goal command parsing > parses controls, edits, and objectives [0.52ms]
(pass) goal command parsing > configuration validates boundary types [0.52ms]
(pass) goal command transitions > set, guard, edit, pause, resume, and clear [1.10ms]
(pass) goal command transitions > completed goal auto-replaces [0.55ms]
(pass) elapsed rendering > formats persisted plus in-flight time [0.52ms]

test/prompts.test.ts:
(pass) model-facing goal prompts > continuation contains audits, escaped objective, and no usage [0.06ms]
(pass) model-facing goal prompts > objective update and compaction escape user data [0.04ms]

test/runtime.test.ts:
(pass) GoalRuntime continuation > starts one stamped continuation and deduplicates [0.93ms]
(pass) GoalRuntime continuation > gates while a background job is running [0.46ms]
(pass) GoalRuntime continuation > accounts a completed turn and resets the in-flight guard [0.77ms]
(pass) GoalRuntime continuation > three consecutive error turns block the goal [1.46ms]
(pass) GoalRuntime continuation > time budget stops the loop at a turn boundary [6.40ms]
(pass) GoalRuntime continuation > in-turn completion wins over budget and final accounting is preserved [6.54ms]

test/server.test.ts:
(pass) server plugin contracts > registers tools and enforces create/update semantics [1.45ms]
(pass) server plugin contracts > rewrites a set command into the first continuation and injects an artifact [0.96ms]

 22 pass
 0 fail
 74 expect() calls
Ran 22 tests across 7 files. [135.00ms]
```

## Typecheck

Exit: 0

```text
$ tsc --noEmit
```

## Scope

This script proves deterministic package, hook, unit, and type contracts. Live OpenCode/model smoke results are recorded separately in devlogs.md because they require configured providers and a real TUI.
