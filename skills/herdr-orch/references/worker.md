# Working as a herdr-orch worker

Read this with your role file. Your brief ends with a Settings block; follow
it, and where the brief's own words say otherwise, they win. Do not start other
agents, panes or hc terminals unless the brief assigns that.

The `Review` line tells you how your work will be reviewed: the orchestrator
runs that review with a separate reviewer. Do not review your own work or
start a reviewer yourself; finish, report, and fix the findings sent back.

## Say how it is going

In herdr-app (`HC_TERMINAL_ID` is set), set your status at the start and at
each natural step, so the orchestrator can check you without reading your
screen:

```sh
hc label "$HC_TERMINAL_ID" orch.status="Fixing the two failing tests" orch.done=40
```

In PowerShell, write `$env:HC_TERMINAL_ID` instead of `"$HC_TERMINAL_ID"`.
`orch.status` is what you are doing now, at most 40 characters. `orch.done` is
how far through the whole task you are, as a percentage. Add
`orch.left=10m` only once you know the work well enough for a real estimate.
In older herdr, skip this; your report is enough.

## Ask, do not guess

When something blocks you or the brief is unclear, first set `orch.status` to
why (herdr-app), then ask with your CLI's question tool: Claude Code's
AskUserQuestion, with two to four clear options and your recommendation first.
Without such a tool, end your message with one full question that names what
you need and why, never a bare "Go?". Then wait for the answer.

## Proof

When the Settings say `Proof: required`, back every claim in your report with a
real check from this run: the command and its real output, a test run, or a
screenshot path. A bug fix first reproduces the bug: the same reproduction
failing before the fix and passing after it. A mocked test does not prove what
a person sees. Never stage a result. Proof files stay out of your commits
unless the brief asks for them.

## Review findings

When you get review findings, fix the ones the orchestrator sends, commit, and
report the new commit. If you judge a finding wrong, do not change the code for
it; say why in your report, with evidence. Never agree with a finding only to
finish.

## The report

Write the full result as Markdown to the report path you were given, even when
blocked or when the brief says not to change files. Its first lines:

```
status: done | blocked | failed
changed: <files, or none>
commit: <final commit on your branch, or none>
summary: <one plain sentence, at most 160 characters>
```

The summary says what changed for the person or what you found, in plain
words: no file names, flags or jargon. Below those lines:

- **Details:** short bullets, one `- ` per line: what changed first, then how it
  was checked. Never one dense paragraph.
- **Proof:** each check with a one-line caption (when the Settings ask for it).
- **Not proven:** what you could not check, and why.
- **Follow-ups:** problems outside the task that you noticed and left alone.
- **AGENTS.md notes:** setup or testing facts you needed that the repository's
  AGENTS.md lacks, one line each. Do not edit AGENTS.md yourself.

Leave out sections with nothing in them.
