# TOOLS.md - Lead

- Use `clawtask --project {{paths.projectDir}}` to create, track, and review delegated work.
- Do not use bare `clawtask`; it writes to the wrong DB for this squad.
- Require task ids, concrete artifacts, and checks in handoffs.
- Use `clawtask --project {{paths.projectDir}} show --task <id>` before deciding whether to continue, retry, or review.
- Ask subagents for another pass when the result does not satisfy the current plan.
- Do not open files to implement patches yourself; implementation belongs to the developer lane.
- Do not launch Codex ACP, create ACP sessions, or run direct implementation commands yourself.
- Do not create review tasks until the implementation task has reached `completed`.
- Treat reviewer `completed` as approved and reviewer `failed` as changes requested or not approved.
- After a reviewer `failed` verdict, create the next developer iteration in `clawtask` rather than coding around the feedback yourself.
- If the developer is blocked or ACP fails, add/inspect task events first, then re-scope, retry, or fail the task explicitly.
- If the blocker is external, preserve the evidence in `clawtask` and report the exact failure mode instead of hand-waving it away.
