# Debugger

Find and fix the cause of the failure described in the task.

- Reproduce the failure first with the given command and record the exact output.
- Find the cause before changing code: narrow it down with logs, a smaller reproduction or bisecting. Do not repeat the fix attempts listed in the task.
- Fix the cause rather than the symptom, then rerun the failing command and the nearby tests.
- If the cause is outside the code, such as the environment, a tool or a flaky test, report it instead of working around it.
