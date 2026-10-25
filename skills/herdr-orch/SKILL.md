---
name: herdr-orch
description: Orchestrate coding agents in herdr panes from the current pane. The calling pane stays the orchestrator; worker agents (Claude Code, Codex, Gemini, Antigravity or any other kind herdr supports) open on demand in the same tab, in a grid sized to the terminal. Use when the user invokes /herdr-orch or asks to split work across several agents or panes in herdr. Requires HERDR_ENV=1 and Node.js 18 or later.
---

# herdr-orch

You are the orchestrator in pane `$HERDR_PANE_ID`. Plan the work, split it, brief workers, check their results and integrate them. Keep planning, synthesis and the final review in this pane.

The helper is `scripts/orch.mjs` in this skill's directory. Run it with Node and an absolute path, for example `node "<skill directory>/scripts/orch.mjs" ls`; it is written `orch` below. For herdr commands it does not cover, read `herdr --skill`.

First run `test "${HERDR_ENV:-}" = 1` (PowerShell: `$env:HERDR_ENV -eq "1"`); if it fails, say you are not inside herdr and stop. Work in a tab of its own. Workers fill the tab toward a grid that fits its current size: every pane keeps at least 80x24 cells (`ORCH_MIN_PANE`) and there are at most five workers (`ORCH_MAX_WORKERS`). `orch ls` shows how many fit, and `spawn` refuses when no room is left.

## Commands

```
orch spawn <name> <kind> [--cwd DIR] [--mcp] [-- agent args]
orch send <name> "<prompt>"                      # or - to read stdin; returns once the worker starts
orch wait [<name>...] [--any] [--timeout SEC]    # block until workers finish; print report summaries
orch ask <name> "<prompt>"                       # send, then wait for that worker
orch ls
orch stop <name>... | --all                      # the agent exits; its pane stays as a free slot
orch close [--force]                             # close free slots; --force closes busy ones too
```

- `spawn` reuses a free slot in the same directory before opening a new pane. Run spawns one at a time.
- `kind` is a herdr agent kind; `herdr agent` lists them. Claude Code workers start without MCP servers (`--strict-mcp-config`) to keep startup context and memory small; add `--mcp` when the task needs those tools. Pass model or effort flags after `--`, for example `-- --model sonnet`.
- `send` appends a report contract: the worker writes the full result to a report file whose first lines are status, changed files and a one-line summary, and replies with only the path. `wait` prints the path and those lines.
- `wait` without names waits for every worker that has an unfinished report.

## When to use a worker

- Do small tasks yourself. If your harness has its own subagents, they are cheaper than a pane for short lookups that nobody needs to watch.
- Use a pane worker for longer implementation, review or research that the user may watch or steer, or when another agent kind is wanted.
- Roles are not fixed; choose the kind per task. Follow the user's instructions about which agents to use and how sparingly. Without such instructions, use your own kind.

## Saving tokens

- Wait without polling. If your harness can run a command in the background and notify you when it exits (Claude Code: Bash with `run_in_background: true`), run `orch wait` that way and keep working. Otherwise run `orch wait` in the foreground; it blocks without spending tokens. Use `--any` to handle results as they arrive. Never loop on sleep, `herdr agent read` or `orch ls` to check progress.
- Write self-contained prompts: goal, files or directories, constraints and done criteria. Point to paths instead of pasting content. Put shared project context in one brief file and reference it from each prompt.
- Read a full report only when its summary is not enough. To hand one worker's result to another, pass the report path.
- Check results in proportion to their risk: spot-check the claims that matter instead of redoing the worker's task.
- Send follow-up work in the same area to the same worker, whose context is already loaded. Stop a worker when its area is done, when you move to unrelated work, or when its context has grown large, and spawn a fresh one if needed.

## Coordination

- Never give two workers overlapping files. For parallel writers, run `git worktree add <path> -b <branch>`, spawn with `--cwd <path>`, and merge the branches yourself.
- If `spawn` says the worker is blocked at startup, read the screen it prints. A folder trust prompt for a git worktree you created from the repository the user is working in may be accepted with `herdr agent send-keys <name> <keys>`; ask the user about any other prompt.
- If `wait` reports `blocked` or no report, read the screen with `herdr agent read <name> --source recent-unwrapped --lines 40`. Do not answer approval dialogs yourself; ask the user.
- Some agents, such as Antigravity, can look idle while background work continues, so trust the report file rather than the state.
- A timeout or error does not prove the prompt was lost. Inspect the worker before sending it again.
- Never stop or close panes that `orch` did not create.
- When the work is done, run `orch stop --all` and then `orch close`.
