# Goal plugin validation

Started: 2026-08-15T20:31:16.660Z
Finished: 2026-08-15T20:31:17.477Z

## Static/runtime contract checks

- PASS: server package entry
- PASS: TUI package entry
- PASS: goal_get tool
- PASS: goal_update tool
- PASS: no goal_create tool
- PASS: command hook
- PASS: idle event hook
- PASS: compaction hook

## Unit tests

Exit: 0

```text
bun test v1.3.14 (0d9b296a)

 22 pass
 0 fail
 77 expect() calls
Ran 22 tests across 7 files. [162.00ms]
```

## Typecheck

Exit: 0

```text
$ tsc --noEmit
```

## Scope

This script proves deterministic package, hook, unit, and type contracts. Live OpenCode/model smoke results are recorded separately in devlogs.md because they require configured providers and a real TUI.
