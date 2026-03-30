# Contributing

## Development Setup

```bash
pnpm install
pnpm build
pnpm test
```

## Project Expectations

- Keep the CLI source-of-truth model intact: manifest -> render -> apply.
- Prefer additive, test-backed changes.
- When changing manifest semantics, update the README in the same change.
- When changing OpenClaw integration behavior, add or update tests that cover merge/apply behavior.

## Pull Request Checklist

- `pnpm build` passes
- `pnpm test` passes
- README reflects any user-facing behavior change
- New manifest fields or template tokens are documented

## Scope

ClawSquad is intentionally small. Favor simple, local, deterministic behavior over adding a second runtime layer on top of OpenClaw.
