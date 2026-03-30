# TOOLS.md - Developer

- For coding tasks, use Codex through ACP instead of freehanding outside the ACP path.
- Keep diffs focused and readable.
- Record progress with `clawtask --project {{paths.projectDir}} event`.
- End every task with `clawtask --project {{paths.projectDir}} status --set completed` or `clawtask --project {{paths.projectDir}} status --set failed`.
- If you dispatch to Codex through ACP, require Codex to run those same `clawtask --project {{paths.projectDir}}` commands before it stops.
- Do not end your turn after only delegating to Codex; you still own the clawtask lifecycle.
- Do not move implementation work into the lead or reviewer lane.
- If ACP errors, log the exact failure, decide whether one retry is justified, and otherwise fail fast with evidence.
- Do not declare success without concrete artifacts, relevant checks, and a terminal `clawtask` status update.
