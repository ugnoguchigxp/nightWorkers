# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning where practical.

## [Unreleased]
### Added
- Japanese README (`README.ja.md`).
- OSS documentation baseline (`CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`, `SUPPORT`, `GOVERNANCE`).
- Expanded README with architecture, operations, and documentation map.
- `spec/docs` reference set and `public/docs` runtime docs split.
- Adoption-focused documentation for Good Fit / Not Good Fit, the first
  read-only run, Run Evidence review, Blueprint/Data Model adoption questions,
  and final report expectations.

### Changed
- Git closeout now requires persisted Test Mode, Review Run, Security Oracle,
  and blocking-finding evidence. Review-applied fixes invalidate older tests.
- Reorganized documentation structure from legacy template-oriented README.
- Improved first-run documentation around `bun run setup`, throwaway
  repository evaluation, and evidence-based adoption checks.
- Refined GitHub Pages landing-page copy and navigation for first-time
  evaluation.
- Kept `verify` and `verify:full` credential-free by isolating external LLM
  canaries to the explicit `verify:live` target.

### Fixed
- Release metadata and documentation drift are now rejected by automated gates.

### Removed
- Nothing.

## [0.1.0] - 2026-07-10

### Added
- Local-first Project, Workbench, Implementation Queue, Plan Mode, Test Mode,
  Review Mode, and evidence inspection workflows.
- Tauri desktop packaging with a managed backend sidecar and packaged smoke
  verification.
- A fixed-seed Support Ops CRM demo that performs a real disposable repository
  change and records verification and review evidence without credentials.
- Release metadata, checksum manifest, documentation consistency, and unified
  release verification commands.

### Changed
- Package metadata is the canonical release version; Tauri, Git tags,
  changelog sections, release notes, and artifact manifests must match it.
- Release readiness now requires the full tests, E2E smoke, dependency policy,
  desktop build/smoke, metadata checks, and deterministic demo smoke.

### Fixed
- Version drift between package and desktop configuration is detected before a
  release tag can be created.
- Completed implementation plans are linked from `spec/archive/` instead of
  remaining in the active plan directory.

### Removed
- Reliance on live provider credentials or production repositories for the
  documented first demo lifecycle.
