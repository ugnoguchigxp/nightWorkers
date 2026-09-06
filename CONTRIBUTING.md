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

## Coverage and startup checks

`bun run test:coverage` runs the non-live suite once across isolated shards and
partitions its results into `coverage/backend` and `coverage/frontend`. Backend
coverage includes `api`, `shared`, and Mission Pilot backend/contracts; frontend
coverage includes `src` and Mission Pilot frontend. Missing production roots
fail report generation. Global and critical-branch thresholds are unchanged.
Use `test:coverage:backend` or `test:coverage:frontend` for a single report.
`NIGHTWORKERS_COVERAGE_SHARDS` accepts 1–8 (default: up to 3); each shard has a
finite timeout. Normal and coverage tests share `vitest.shared.ts`.

`verify:full` and `verify:release` use this coverage run for the full non-live
suite, without a separate full test run beforehand. Focused supervisor and
desktop runtime checks remain in their existing phases.

E2E starts separate API and Vite processes, and waits for both API readiness
and the web entry point. Run E2E after the unit/coverage suite to avoid local
resource contention.

For desktop changes, the **Desktop matrix** workflow can be launched manually
to verify macOS, Linux, and Windows independently. It retains diagnostics and
package evidence. `desktop:verify-target` checks staged file presence and the
actual runtime hash; `desktop:smoke-sidecar` verifies startup and bounded
shutdown. A local check on one OS does not establish that the other OS packages
install or launch successfully.

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
