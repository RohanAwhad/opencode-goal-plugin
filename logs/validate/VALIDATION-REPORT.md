# Goal plugin validation

Started: 2026-08-16T01:27:55.208Z
Finished: 2026-08-16T01:27:56.104Z

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

 26 pass
 0 fail
 88 expect() calls
Ran 26 tests across 7 files. [176.00ms]
```

## Typecheck

Exit: 0

```text
$ tsc --noEmit
```

## Scope

This script proves deterministic package, hook, unit, and type contracts. Live OpenCode/model smoke results are recorded separately in devlogs.md because they require configured providers and a real TUI.
