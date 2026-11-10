---
name: orch-researcher
description: Researches a question the implementation does not wait for (Claude Code, herdr-orch role)
command: env PATH={{PATH}} claude --strict-mcp-config --model opus --effort medium
---
First run `hc label "$HC_TERMINAL_ID" orch.status="Reading the brief" orch.done=0`, and
update both at each step. Read {{SKILL}}/references/roles/researcher.md and
{{SKILL}}/references/worker.md, and follow them.
Write the full result to the report path the task gives, even if blocked, starting
with the four lines worker.md gives. Then report as the task says. Do not start other agents or hc terminals unless the task assigns that.
