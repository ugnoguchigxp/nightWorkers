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
```

Use `bun run verify:full` only when you explicitly need the slow suite: all
non-live Vitest tests, E2E and accessibility, dependency audit, desktop
build/smoke, all without provider credentials. External-provider canaries run
only through explicit `bun run verify:live`. Release changes must pass
`bun run verify:release`.

Dependency updates require an explicit compatibility review. JavaScript changes
must update and commit `bun.lock`; Rust changes must update and commit
`src-tauri/Cargo.lock`.

Moderate+ audit exceptions are temporary. Every entry in
`config/dependency-audit-allowlist.json` must include `advisoryId`, `package`,
`owner`, `reason`, `mitigation`, and a future ISO `expiresAt`. Expired or invalid
entries fail the audit again.

## Version and Release Policy

`package.json` is the canonical version source. Keep
`src-tauri/tauri.conf.json`, the dated CHANGELOG section, release notes, Git tag,
and artifact manifest on the same version. Use Semantic Versioning: breaking
contracts require a major increment, backward-compatible features a minor
increment, and compatible fixes a patch increment.

Prepare a release with `bun run release:create`; it runs the complete release
gate and performs a dry run. Only `bun run release:create -- --execute` creates
the annotated tag. Artifact publication remains a separate, reviewable action.

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
