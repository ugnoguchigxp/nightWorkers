# Adoption Checklist

Use this checklist before trying NightWorkers on a repository that matters.

## Local-Only Personal Use
- Confirm you can run:
  - `bun install`
  - `bun run db:migrate`
  - `bun run db:seed`
  - `bun run dev`
- Keep `API_AUTH_REQUIRED=false` only for local personal use.
- Start with a throwaway Project Folder or a repository where changes can be
  reviewed before commit.
- Send a read-only investigation request before asking for code edits.
- Review the Workbench timeline and Artifact Pane before trusting a run result.

## Provider Credential Connection
- Use a provider credential scoped for local evaluation.
- Run the Settings smoke test before starting Workbench execution.
- Confirm secret fields are masked when settings are read back.
- Expect provider calls to include the current user request, supervisor prompt
  context, optional StateCard continuity context, and relevant run/artifact
  summaries.
- Check local `llm_usage_records` or the Overview usage summary when evaluating
  provider cost and usage behavior.

## Project Repo Registration
- Register the actual repo root you want NightWorkers to inspect or edit.
- Configure `allowedPaths`, `deniedPaths`, and `blockedCommands` if the repo has
  sensitive paths or risky commands.
- Keep destructive command patterns blocked.
- Avoid registering directories that contain unrelated secrets or large
  generated artifacts.
- Review diffs before committing any NightWorkers-produced change.

## Worker Tools, MCP, and Hooks
- Keep MCP servers OFF unless you intentionally enable them.
- Connect only MCP servers you trust.
- Do not expect MCP auth headers, bearer tokens, API keys, cookies, or
  secret-like env values to be accepted in the current implementation.
- Keep Agent Hooks disabled until you understand their event payload and command
  or HTTP behavior.
- Treat hook commands and hook HTTP endpoints as local automation that you own.
- Confirm failed hook summaries are useful but redacted.

## Desktop Artifact Use
- Build and smoke-test the desktop app before using it for real work:
  - `bun run desktop:build`
  - `bun run desktop:smoke`
- Remember desktop runtime state is under the macOS app data directory, not the
  repo checkout.
- Check `desktop.log`, `sidecar.log`, and `api.log` when the packaged app does
  not start cleanly.
- Treat DMG creation and signing as separate release gates.

## OSS Contributor Reading Path
1. [README](../../README.md)
2. [First Run Orientation](./first-run-orientation.md)
3. [Trust Model](./trust-model.md)
4. [Feature Tour](./feature-tour.md)
5. [Architecture and Module Boundaries](./architecture.md)
6. [Runtime Configuration Reference](./configuration.md)
7. [CONTRIBUTING](../../CONTRIBUTING.md)
8. [SECURITY](../../SECURITY.md)

## Current Non-Goals To Know
- NightWorkers does not automatically create PRs, merge code, or deploy.
- NightWorkers does not provide parallel multi-agent orchestration in the
  current implementation.
- An external memory service is not required for baseline local use.
- The repository does not currently include a fixed sample Project Folder, demo
  seed transcript, demo GIF/video, or `demo:*` workflow.
