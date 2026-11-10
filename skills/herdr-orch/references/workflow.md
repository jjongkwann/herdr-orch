# Briefing, reviewing and accepting work

These rules apply in both runtimes, older herdr (`orch`) and herdr-app (`hc`).
Workers follow [worker.md](worker.md); this file is the orchestrator's side.

## Before a launch: memory

Check free memory on the machine that will run the worker before each launch,
and launch only when at least 15% is free (`ORCH_MIN_FREE_MEM` if set). With
less, wait for a running worker to finish, or tell the user what is using the
memory and ask before starting more. Each Claude Code or Codex worker takes
several hundred MB to a few GB, and a machine out of memory can end every
agent at once.

| Machine | Command | Read |
|---|---|---|
| macOS | `memory_pressure -Q` | `System-wide memory free percentage: N%` |
| Linux | `grep -E 'MemTotal\|MemAvailable' /proc/meminfo` | MemAvailable / MemTotal |
| Windows | `powershell -NoProfile -Command "$o=Get-CimInstance Win32_OperatingSystem; [int](100*$o.FreePhysicalMemory/$o.TotalVisibleMemorySize)"` | the number |

On macOS, Node's `os.freemem()` leaves out reclaimable memory and reads near
0%; use `memory_pressure`. `orch spawn` runs this check itself. For an hc
worker on another machine, run the command there with `hc exec --on <machine>`.

## Raising a worker's model or effort

Roles start at the model and effort their files set. Depart from them in this
order; the user's preferences come first.

- Start an implementer on `opus` when its part needs design judgment, or is a
  migration or a performance optimization: a clear spec does not make those easy.
- When a worker comes back blocked or fails review twice:
  1. Check that the brief gave it a way to verify its own work, such as a test,
     a build or a command in `Done when`. If not, add one and send the task again.
  2. Raise the effort one level (an implementer to `high`).
  3. Move to the next model up, one effort level lower than the smaller model
     used (an implementer to `opus` at `medium`).
- Do not raise effort past `high`. A reviewer or debugger for which `opus` at
  `high` falls short goes to `fable` at `medium`, then `high`.

A changed model or effort means a new worker: stop the old one and give the new
one the earlier report path.

## The brief

Every worker prompt states the goal, the files or directories in scope, the
constraints and when it is done, and ends with a Settings block. The worker
follows the block; words in the brief that say otherwise win.

```
Settings
- Role: implementer
- Scope: src/parser/, tests/parser/
- Base: main at 3f2a9c1
- Review: on, 2 rounds, must fix: major
- Proof: required
- Commit: on its branch | none
- Done when: `npm test` passes and the new flag parses `--x=1`
```

- **Review:** `on` or `off`, the most review rounds, and the lowest level that
  must be fixed (`blocker`, `major` or `minor`). Default for code changes:
  on, 2 rounds, must fix major. Off for research, read-only work and changes
  the user will review themselves.
- **Proof:** `required` for behavior someone will see or rely on; `not needed`
  for research, documentation and refactors whose tests already cover them.
- Leave out lines that do not apply to the role (a researcher needs no Commit).

## The review loop

Run it for each change whose Settings say `Review: on`.

1. When the implementer reports `done`, check that its report names its final
   commit (or, without commits, the files) and gives the proof the Settings
   ask for. Send back a report that lacks them before any review.
2. Launch a reviewer with a fresh context, of another agent kind when the user's
   preferences allow. Give it the brief, the implementer's report path, the
   base and the commit to review, and the must-fix level.
3. The reviewer reports findings, each with a level and evidence, and the
   commit it reviewed. Send the findings at or above the must-fix level to the
   same implementer, which fixes them, commits and reports again. Findings
   below the level go into your final response as follow-ups.
4. Review the new commit again: the same reviewer, told what changed since the
   last round, is fine. Stop when a round finds nothing at or above the level,
   or when the rounds are used up.
5. Accept only a final commit that a round reviewed. If commits came after the
   last reviewed one, review them or report them as unreviewed.

The implementer may reject a finding with a reason. Decide it yourself from the
evidence, and never accept or drop a finding just to end the loop: put each
rejected or unresolved finding, with both sides, in your final response. Rounds
used up with findings still open: stop and ask the user, with the open findings.

## Accepting work

Read the report itself, not only its first lines, before accepting:

- **Proof:** each claim it makes has a real check behind it from this run (a
  command and its output, a test run, a screenshot path). A bug fix shows the
  same reproduction failing before and passing after. A mocked test does not
  prove what a person sees. Spot-check the claims that matter; send back a
  report whose proof is missing or staged.
- **Not proven:** what the worker could not check. Carry it into your final
  response.
- **AGENTS.md notes:** setup or testing facts the worker needed that the
  repository's AGENTS.md lacks. Workers never edit AGENTS.md themselves. Add a
  note when the user's task allows changing that file and the fact will hold
  for the next agent; otherwise list it in your final response. In older
  herdr, a note about how herdr-orch or an agent kind behaves belongs in
  `orch lessons` instead.

## Questions from workers

A worker that needs a decision sets its status and asks with its CLI's question
tool (see worker.md), so it shows as blocked. Read its screen, then put the
question to the user with the worker's options and its recommendation, in the
user's language. Answer the worker with the user's choice: keys for an open
question dialog, or a follow-up message. Answer only questions the brief
already settles yourself; never approve permission prompts or choose for the
user.

## Worktrees after the work

When the work is merged, remove the worktrees and branches you created for it.
Keep one that has uncommitted changes (generated output such as caches does not
count), commits not in the branch it merged into, or a worker still running in
it, and say in your final response which
you kept and why. Never touch worktrees you did not create. Older herdr:
`orch worktrees --clean`. herdr-app: the commands in
[herdr-core.md](herdr-core.md#worktrees).
