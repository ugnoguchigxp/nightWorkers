# Contributing to NightWorkers

## Scope
Contributions are welcome for runtime reliability, developer experience, docs quality, and test coverage.

## Development Flow
1. Fork and create a feature branch.
2. Keep changes scoped and verifiable.
3. Add or update tests when behavior changes.
4. Run local checks before PR.

Recommended checks:
```bash
bun run verify
bun run test:e2e:smoke
```

## Pull Request Guidelines
- Explain the problem and the concrete behavior change.
- Include affected modules and migration impact if any.
- Attach screenshots for UI changes.
- Link relevant issues/specs.

## Commit Hygiene
- Keep commits focused and reviewable.
- Do not mix unrelated refactors with behavior changes.
- Update docs in the same PR when public behavior changes.

## Issue Reports
Please include:
- Reproduction steps
- Expected vs actual behavior
- Environment (`bun --version`, `node -v` if desktop sidecar work is involved, OS)
- Logs or screenshots when available
