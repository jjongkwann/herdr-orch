---
name: herdr-orch
description: Orchestrate coding agents in herdr panes from the current pane. The calling pane stays the orchestrator; worker agents (Claude Code, Codex, Gemini, Antigravity or any other kind herdr supports) open on demand in the same tab, in a grid sized to the terminal. Use when the user invokes /herdr-orch or asks to split work across several agents or panes in herdr, and proactively, without being asked, inside herdr when a task has two or more independent parts or a code change should be reviewed by a second agent. Requires HERDR_ENV=1 and Node.js 18 or later.
---

# herdr-orch

You are the orchestrator in pane `$HERDR_PANE_ID`. Plan the work, split it, brief workers, check their results and integrate them. Keep planning, synthesis and the final review in this pane.

The helper is `scripts/orch.mjs` in this skill's directory. Run it with Node and an absolute path, for example `node "<skill directory>/scripts/orch.mjs" ls`; it is written `orch` below. For herdr commands it does not cover, read `herdr --skill`.

If your prompt says you are a herdr-orch worker, do not use this skill. First run `test "${HERDR_ENV:-}" = 1` (PowerShell: `$env:HERDR_ENV -eq "1"`); if it fails, say you are not inside herdr and stop. Work in a tab of its own. Workers fill the tab toward a grid that fits its current size: every pane keeps at least 80x24 cells (`ORCH_MIN_PANE`) and there are at most five workers (`ORCH_MAX_WORKERS`). `orch ls` shows how many fit, and `spawn` refuses when no room is left.

## Commands

```
orch spawn <name> <kind> [--cwd DIR] [--mcp] [-- agent args]
orch send <name> "<prompt>"                      # or - to read stdin; returns once the worker starts
orch wait [<name>...] [--any] [--timeout SEC]    # block until workers finish; print report summaries
orch ask <name> "<prompt>"                       # send, then wait for that worker
orch ls
orch log [--lines N]                             # this tab's run: past actions and unfinished work
orch lessons                                     # lesson files for this project and for all projects
orch stop <name>... | --all                      # the agent exits; its pane stays as a free slot
orch close [--force]                             # close free slots; --force closes busy ones too
```

- `spawn` reuses a free slot in the same directory before opening a new pane. Run spawns one at a time.
- `kind` is a herdr agent kind; `herdr agent` lists them. Claude Code workers start without MCP servers (`--strict-mcp-config`) to keep startup context and memory small; add `--mcp` when the task needs those tools. Pass model or effort flags after `--`, for example `-- --model sonnet`.
- `send` appends a report contract: the worker writes the full result to a report file whose first lines are status, changed files and a one-line summary, and replies with only the path. `wait` prints the path and those lines.
- `wait` without names waits for every worker that has an unfinished report. When a worker is blocked, `wait` also shows a herdr notification so the user sees it.
- `orch` keeps a journal of spawns, prompts, results, stops and closes for the tab. After your context was compacted or restarted, or whenever you are unsure what is pending, run `orch log`: it lists the run's events and, for each worker's last prompt, whether its report is still unread, the worker is still working, or it exited without a report. A `close` that leaves no slots ends the run.

## When to use a worker

Use workers proactively: when one of these situations comes up, open the worker without waiting for the user to ask.

| Situation | Worker |
|---|---|
| A worker reports `done` on a code change | `reviewer`, given the report path |
| Two or more parts of the task touch different files or modules | `implementer` for each part, each in its own git worktree |
| The task needs research that the implementation does not have to wait for | `researcher` |
| The same build or test failure remains after two fix attempts | `debugger`, given the failing command and what was tried |
| A large or unclear task needs a plan before the work is split | `planner` |

- Brief each worker with its role: start the prompt with `Read <skill directory>/references/roles/<role>.md and follow it.`, then give the task.
- Keep short lookups that nobody needs to watch out of panes: do them yourself or with your harness's own subagents.
- Roles are not tied to kinds; choose the kind per task. A reviewer of another kind, or at least with a fresh context, catches more than the author. Follow the user's instructions about which agents to use and how sparingly; they override this table. Without such instructions, use your own kind.

## Lessons

`orch lessons` prints two lesson files and creates them if they are missing: one for the current project, keyed by its git remote, and one for all projects. Read them before the first spawn and apply the lessons whose trigger fits the work.

Before the final `close`, read `orch log` and update the files with your file tools; skip this when the run showed nothing new.

- Add a lesson when the run shows a pattern worth reusing: an agent kind blocked at startup, a kind of task that came back blocked or failed, a prompt that had to be resent, or a brief that lacked something the worker needed.
- Write each lesson as a section: `## <short-id>`, then lines for `trigger:`, `action:`, `confidence:` (0.3 tentative to 0.9 near certain) and `evidence:` (the date and what happened).
- Raise the confidence of a lesson that held again. Lower it, or delete the lesson, when it proved wrong.
- Lessons about this repository go in the project file; lessons about agent kinds, herdr or briefing in general go in the file for all projects.

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
