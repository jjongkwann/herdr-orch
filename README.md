# herdr-orch

English | [한국어](README.ko.md)

An agent skill that turns one [herdr](https://herdr.dev) tab into a small team of coding agents. The pane you start it from is the orchestrator. It opens worker panes beside itself as the work needs them, briefs each worker, waits for results without polling, and closes the panes when the work is done. It works in herdr, where workers are panes beside the orchestrator, and in herdr-app, where workers are hidden hc terminals that are children of the orchestrator's terminal.

```
┌──────────────┬──────────────┬──────────────┐
│ orchestrator │ worker       │ worker       │
├──────────────┼──────────────┼──────────────┤
│ worker       │ worker       │ worker       │
└──────────────┴──────────────┴──────────────┘
```

The grid follows the tab size. Every pane keeps at least 80x24 cells, so a laptop screen may fit a 2x2 grid and a wide monitor a 2x3 grid; the layout is recomputed each time a worker opens, including after the terminal is resized. While no terminal shows the herdr server (detached, or the herdr client shows another machine), herdr reports a smaller fallback size for every tab; orch then plans from the size its workers were made for, so the grid comes out right when the terminal shows the tab again.

Workers can be any agent kind herdr recognizes: Claude Code, Codex, Gemini CLI, Antigravity CLI, OpenCode and others. You can mix kinds in one tab.

## herdr-app / herdr-core

The skill also supports herdr-app through native `hc` commands. With
`HC_TERMINAL_ID` set, it uses the [hc procedure](skills/herdr-orch/references/herdr-core.md)
instead of `orch.mjs`: background interactive workers, report files, blocking
waits and cleanup restricted to workers it created. Workers stay hidden unless
you ask to show them; the legacy pane grid and `ORCH_MIN_PANE` do not apply.
The runtime manuals (`hc --skill`, `herdr-app --skill`) define the installed API.

It needs `hc` and herdr-app. Node.js is only required for the older herdr helper
and for `orch.mjs setup`.

- **Role templates:** `skills/herdr-orch/templates/orch-<role>.md` ships one template each for the reviewer, implementer, researcher and debugger roles. When `hc templates` lacks them, the agent offers to install them into `~/.config/herdr-core/templates`, replacing `{{SKILL}}` with the skill's directory and `{{PATH}}` with the folders that hold `claude` and `hc` followed by the system ones (`/usr/bin:/bin:/usr/sbin:/sbin`). Without them it launches workers directly.
- **Run labels:** each worker is launched with `orch.run`, `orch.report` and, when it has one, `orch.worktree` labels. After the orchestrator's context is compacted, `hc ls --all --label orch.run=<id>` lists the run's workers.
- **Other machines:** `--on <machine>` starts a worker on another machine. It writes its report there, and the orchestrator reads it with `hc file read --on <machine> <path>`.
- **Tasks:** work you want as a tracked task, with its own card and an Accept step, belongs to `herdr-task`. herdr-orch delegates parts of the task the session is already doing.

If an agent harness does not pass `HC_TERMINAL_ID` to its command environment,
supply the exact terminal address explicitly after identifying it in Herdr.
The skill never uses the focused pane as a substitute for session identity.
Codex sessions must start with `--no-daemon` so their commands retain hc context.

## Requirements (older herdr)

- herdr 0.9.5 or later, with the agents you want to use installed
- Node.js 18 or later
- An agent that supports skills (Claude Code, Codex, Cursor, Gemini CLI and others)

## Install

```bash
npx skills add jjongkwann/herdr-orch
```

Add `-g` to install it for your user instead of the current project, and `-a <agent>` to choose the agents.

Agents choose skills from a one-line description, and their built-in subagents usually win. So the first time the skill runs, the agent offers to add one rule to your global instructions (`AGENTS.md`, `CLAUDE.md` or `GEMINI.md`) that tells it to use herdr-orch inside herdr and herdr-app (`HERDR_ENV=1` or `HC_TERMINAL_ID`) without being asked. Nothing is written unless you agree, and a no is remembered. `orch.mjs setup` works in both runtimes, and `setup add <file>` replaces an earlier herdr-only wording of the rule in that file. To add the rule yourself, run `node <skill directory>/scripts/orch.mjs setup add ~/.codex/AGENTS.md` with the file your agent loads.

## Use

1. Open a new herdr tab and start your agent in it.
2. Ask for the work, for example `/herdr-orch Add input validation to the signup API and have a second worker review the diff` in Claude Code, or "use the herdr-orch skill to ..." in other agents.

Inside herdr, the agent also uses the skill without being asked when a task has independent parts or a code change should get a second reviewer. Workers are briefed with a role from `references/roles/`: reviewer, implementer, researcher or debugger. Work is split by context rather than by role, and the orchestrator does its own planning. Your own instructions about which agents to use and how sparingly take precedence.

Spawned with `--role`, a worker starts with the model and reasoning effort its role file sets: reviewers and debuggers on Opus at `high`, researchers on Opus at `medium`, and implementers on Sonnet at `medium`, since they work from a complete brief and a reviewer checks their work. The model is a Claude Code alias; other agents keep their configured model and take only the effort. `spawn --model` and `--effort` override the role's values. An implementer whose part needs design judgment, or is a migration or a performance optimization, starts on Opus. A worker that comes back blocked or fails review twice first gets a way to verify its own work, then one effort level more, then the next model up at one effort level less. Effort is not raised past `high`: when Opus at `high` falls short, the next step is Fable at `medium`. `orch` passes them in each kind's form: `--effort` for Claude Code and Antigravity, `-c model_reasoning_effort=` for Codex. Put your own preferences in your agent instructions, for example "Run herdr-orch implementers on Opus." Claude Code runs a level the model does not support at the highest level it does; with Codex, use a model that supports the level.

The orchestrator calls `scripts/orch.mjs`, which you can also run yourself from a herdr pane:

```
node scripts/orch.mjs spawn <name> <kind> [--cwd DIR] [--worktree [--base REF]] [--mcp] [--role ROLE] [--model MODEL] [--effort LEVEL] [-- agent args]
node scripts/orch.mjs send <name> "<prompt>"
node scripts/orch.mjs wait [<name>...] [--any] [--timeout SEC]
node scripts/orch.mjs ask <name> "<prompt>"
node scripts/orch.mjs ls
node scripts/orch.mjs worktrees [--clean] [--base REF]
node scripts/orch.mjs log [--lines N]
node scripts/orch.mjs lessons
node scripts/orch.mjs setup [add <file> | decline]
node scripts/orch.mjs stop <name>... | --all
node scripts/orch.mjs close [--force]
```

Workers that edit files in parallel each get their own git worktree: `spawn --worktree` creates `../<repo>-<name>` on a new branch `<name>` and starts the worker there. After the orchestrator merges the branches, `worktrees --clean` removes the worktrees that are fully merged and no longer in use, and deletes their branches. It keeps anything with uncommitted changes or unmerged commits, and it ignores worktrees that `orch` did not create.

`orch` writes each spawn with the arguments the agent started with, and each prompt, result, stop and close, to a journal for the tab. `log` prints the current run from it, along with the workers whose last prompt is still open: report not yet read, still working, or exited without a report. The orchestrator runs it after its context is compacted or restarted. When `wait` sees a worker blocked at an approval or question, it shows a herdr notification.

`lessons` prints two Markdown files of lessons, one for the current project (keyed by its git remote) and one for all projects. The orchestrator reads them before it opens the first worker. Before the final `close`, it updates them from the journal: each lesson has a trigger, an action, a confidence and the evidence behind it, such as "Codex workers stop at the trust prompt in new worktrees".

## Briefs, reviews and proof

`references/workflow.md` is the orchestrator's side and `references/worker.md` the worker's, in both herdr and herdr-app:

- Every brief ends with a Settings block: role, scope, base, `Review: on, 2 rounds, must fix: major`, `Proof: required`, commit and done criteria.
- Reviewers give each finding a level (blocker, major, minor) and evidence, and name the commit they reviewed. Findings at or above the must-fix level go back to the same implementer; the loop stops when a round finds none or the rounds run out, and only a reviewed final commit is accepted. A finding the implementer rejects is decided from the evidence and reported, never dropped to end the loop.
- Reports start with status, changed files, final commit and a plain summary of at most 160 characters, then details, proof, what is not proven, follow-ups and notes for the repository's `AGENTS.md`. A bug fix shows the same reproduction failing before and passing after; a mocked test does not count as proof of what a person sees.
- A worker that needs a decision asks with its CLI's question tool; the orchestrator puts the question to you and answers with your choice.
- In herdr-app, workers set `orch.status` and `orch.done` labels on their terminals, which `hc get` shows.
- Before each launch the orchestrator checks free memory; `orch spawn` refuses below 15%.

## How it keeps token use down

- `wait` blocks on herdr's agent state, so the orchestrator spends nothing while workers run. Claude Code runs it in the background and is notified when it returns.
- Each worker writes its full result to a report file. The orchestrator reads only the first few lines and passes paths, not content, between workers.
- Pane layout, IDs and JSON stay inside the script instead of in the orchestrator's context.
- Claude Code workers start without MCP servers unless you pass `--mcp`, which keeps their startup context and memory small.
- Workers are reused for follow-up work in the same area and stopped when their area is done. `ls` and `wait` show how many tokens of context each Claude Code worker carries, read from its session transcript, so the orchestrator can replace one whose context has grown large.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ORCH_MIN_PANE` | `80x24` | Smallest pane, in columns x rows; decides how many panes fit the tab |
| `ORCH_MAX_WORKERS` | `5` | Upper limit on workers, however large the tab is |
| `ORCH_MIN_FREE_MEM` | `15` | Percent of memory that must be free for a new worker |
| `XDG_STATE_HOME` | `~/.local/state` (`%LOCALAPPDATA%` on Windows) | Where `herdr-orch/` keeps slot state, journals, lessons and reports |

To say which agents the orchestrator should prefer, put it in your agent instructions (for example `AGENTS.md`): "When orchestrating with herdr-orch, use Claude Code workers by default and Codex only when asked."

## Status

Tested on macOS with herdr 0.9.5: Claude Code as the orchestrator and as workers end to end, and Codex and Antigravity CLI workers for start and stop. The script avoids shell-specific commands so it can run on Windows and Linux, but those platforms have not been tested end to end yet.

The hc procedure was run end to end on 2026-11-10 with hc 0.1.19 and herdr-app 0.1.14 on macOS: Claude Code as the orchestrator; Claude Code, Codex and Antigravity workers on the same machine; Claude Code workers on a second Mac and on Windows through `--on`; and a worker's question answered with `hc keys`.

## License

MIT
