# S11t integration audit

## Canary

- S11t commit: `f3fa8cb8d15f603f1c838446b0868fe75f2e48c1`
- Catalog digest:
  `sha256:77cec64ec1b5268e5de836e1f3de11640105744b0f611a2e1dc8cf6ff265b44a`
- Canonical aliases: none

## Binding ownership

`api/systemContexts/catalog.ts` reads General Settings `language` and maps `ja` to
`ja-JP` and `en` to `en-US`. It always uses `fallbackLocales = []`.

`api/modules/nightworkers/run-orchestration/start-task-run.ts` creates or restores
the run binding. `run-system-context.ts` reuses it when constructing the Coding
Agent context. The persisted binding is reused by Codex, Native API, context
packet recovery, and run resume.

## API usage

### `bindRequest()`

`bindSystemContextCatalogSnapshot()` owns the direct runtime call. Audited
production consumers are:

- `api/modules/codingAgent/runtime/codex-sdk/codex-sdk-runtime-prompt.ts`
- `api/modules/codingAgent/runtime/native-api-runner/native-api-tool-history.ts`
- `api/modules/review/rubrics/llm-reviewer.ts`
- `api/services/structured-generation/prompts/structured-output-repair.ts`
- `api/services/structured-llm/index.ts`
- `api/modules/missionPilot/agent/mission-pilot-provider.port.ts`

### `bind()`

`bindSystemContextCatalog()` exposes direct single-invocation binding. It is
currently exercised by catalog tests; compound production audit paths use
`bindRequest()` so their render trace is retained.

### `bindText()`

`api/systemContexts/catalog.ts` owns text binding. Application prompt builders
use the shared `p()` facade; HTTP requests and worker/run entrypoints establish
an immutable request-local binding before application code executes. Explicit
`bindText()` remains only at persisted Coding Agent run/context restoration
boundaries.

```bash
rg -l 'bindSystemContextTextCatalog' api --glob '*.ts'
```

### `p()` and `createTextRenderer()`

NightWorkers exports a simple request-scoped `p()` facade, but does not create a
S11t live renderer. Mission Pilot, mission planner, project evaluation,
questionnaire selection, plan views, task generation, review test evidence,
and other prompt builders call `p()` directly. Provider-facing structured
calls are wrapped by `bindRequest()` at the shared structured-LLM boundary.

## Manifest persistence

- Codex emits `model_response_started` with a UUID `requestId`, the request
  audit, final manifest, rendered hash, and user-prompt digest. The ledger maps
  it to `model.request_started` under the run ID.
- Native API emits the same event for each provider attempt. Its request ID is
  `<runId>:<turnId>:<attemptIndex>`.
- Structured LLM calls use their UUID `callId` as `requestId` in request trace,
  `model.request_started`, and usage metadata. A raw composed system prompt is
  represented by `providerExecution.system-prompt`; execution-policy developer
  instructions retain their own manifest under the same request ID.
- Mission Pilot tool turns bind their system and developer instructions from
  the runtime's immutable locale snapshot. The provider result carries a UUID
  request ID and both manifests; `llm_usage_records.call_id` stores that UUID
  and `metadata_json.systemContextAudit` stores the matching manifests.
- Reviewer events retain the same SystemContext audit in `review.llm_started`.

The event record therefore associates provider prompt digests and S11t
manifests with both a request ID and the owning run ID.

## Trust changes

The following variables moved from trusted raw profiles to `untrusted.text`
(`delimited-context` plus `json-string`):

- `codingAgent.plan-mode-gate.projectRoot`
- `codingAgent.runtime-system.registeredRepositoryRoot`
- `codingAgent.runtime-system-without-task-goal.registeredRepositoryRoot`
- `codingAgent.workspace-context.executionRoot`
- `codingAgent.workspace-context.registeredRepoRoot`
- `codingAgent.workspace-context.workspaceSource`
- `supervisor.codex-guidance.safeGuidance`
- `supervisor.codex-guidance.lifecycleSummaries`
- `supervisor.round1.projectRoot`

EvidencePack is not a trusted S11t variable. Reviewer evidence is serialized as
escaped runtime JSON inside `UNTRUSTED_EVIDENCE_PACK_JSON`.

## Locale coverage

The `en-US` coverage result is:

- direct: 4
- fallback: 0
- missing: 79

Direct English contexts are `providerExecution.system-prompt`,
`review.llm-reviewer`, `supervisor.codex-guidance`, and `supervisor.round1`.
Missing translations fail closed instead of silently rendering Japanese.
