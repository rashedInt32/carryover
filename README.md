# Carryover

Task state that survives Claude Code compaction.

When Claude Code compacts a long session, the summary tends to drop the exact
things you needed kept: the precise wording of your instructions, which files
were touched, which commands ran, where the task list stood. Carryover writes
those facts down right before compaction and hands them back right after.

No model is involved. The ledger is extracted mechanically from the transcript,
so it holds exactly what happened, not a paraphrase.

## What the model sees after compaction

```
Context was just compacted. Below is a ledger extracted mechanically from the transcript
right before compaction: the user's exact words, the task list, files edited, and commands run.
It is not a summary. Where the compaction summary and this ledger disagree, trust the ledger,
and keep following the user's verbatim instructions.

# Carryover ledger
Written before compaction (auto) at 2026-09-28T04:10:12.000Z.
Session: Fix the login redirect loop
Working directory: /work/app
Branch: fix/login

## The user's instructions, verbatim (first one is the original goal)
1. "Fix the redirect loop on /login when the session cookie is expired. Do not touch the signup flow."
2. "Also keep the fix under 20 lines."

## Task list at compaction time (latest TodoWrite)
- [x] Find the redirect source
- [~] Guard against expired cookie loop
- [ ] Add regression test

## Files edited (most recent first)
- /work/app/src/auth/middleware.ts (2 edits)
- /work/app/src/auth/__tests__/loop.test.ts

## Recent commands run
- `grep -rn redirect src/auth`
- `npm test`

## Last assistant message before compaction
The guard is in place and the loop test passes. Next I will run the full suite.
```

## Install

```
claude plugin marketplace add rashedInt32/carryover
claude plugin install carryover@carryover
```

No dependencies. Two hooks:

- `PreCompact` runs `hooks/pre-compact.mjs`. It reads the session transcript,
  extracts the ledger, and writes it to `~/.local/state/carryover/<session>.md`.
  It prints nothing, because PreCompact output cannot shape the summary.
- `SessionStart` with matcher `compact` runs `hooks/session-start.mjs`. It reads
  the ledger for the session and returns it as `additionalContext`.

Neither hook runs on a normal prompt, so there is no per-prompt latency.

## What goes in the ledger

- Every prompt a human typed, verbatim, oldest first. When there are more than
  12, the first one (the original goal) and the 11 most recent are kept.
  Tool results, injected system text, and slash commands are excluded.
- The most recent `TodoWrite` task list with statuses.
- Files edited by `Edit`, `Write`, `MultiEdit`, or `NotebookEdit`, most recent
  first, with edit counts. Subagent edits are excluded.
- The last 15 distinct `Bash` commands.
- The last assistant message before compaction.
- Session title, working directory, branch, and how many compactions happened
  earlier in the session.

The whole ledger is capped at 12,000 characters. Low-priority sections drop
first; your instructions and the task list drop last.

## Guardrails

- Secret-looking strings are redacted before anything is written: common API key
  prefixes, GitHub and Slack tokens, AWS and Google keys, JWTs, Bearer headers,
  PEM blocks, and `password=`/`token=`-style assignments.
- The transcript path must resolve inside the Claude config directory. Session
  ids are validated before they become file names.
- Ledgers are written atomically with owner-only permissions into an owner-only
  directory, and pruned after 14 days.
- Both hooks exit 0 on every failure path. They never block compaction or
  session start.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `CARRYOVER_DISABLE` | unset | Set to `1` to turn both hooks off |
| `CARRYOVER_STATE_DIR` | `~/.local/state/carryover` | Where ledgers are stored |
| `CARRYOVER_MAX_CHARS` | `12000` | Ledger size cap |
| `CARRYOVER_RETENTION_DAYS` | `14` | Days before a ledger is pruned |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Root transcripts must live under |

## Development

```
npm test
```

Tests run both hooks end to end against a synthetic transcript in `test/fixture`.

## License

MIT
