# Agentic Skill Retrieval Plan

## Goal

Supervisor の SKILL を Round 2 prompt へ強制注入する設計をやめ、エージェントが必要なときに `read_skill` / `search_skill` で能動取得する形へ変更する。

StateCard は会話継続文脈として自動注入を維持する。SKILL は実行手順知識として分離し、StateCard には混ぜない。

## Non-Goals

- Round 1 / Round 2 方式自体は廃止しない。
- StateCard の自動注入を tool 化しない。
- `llm-provider` に用途別 SystemContext や jobType 判断を追加しない。
- SKILL 本文を StateCard や task message に保存しない。
- 初期実装で別 agent / conductor / multi-agent orchestration を追加しない。
- `api/services/supervisor/skills/builtin/` の phase/reference routing を今回の主題にしない。

## Current Problem

現状の `runSupervisorLoop(...)` は Round 2 の各 iteration で次を行う。

```ts
const skill = loadFlatSkill(currentJobType);
const round2SystemPrompt = buildRound2ToolCallPrompt({
  projectRoot: repoRoot,
  jobType: currentJobType,
  skill,
  tools: allowedTools,
});
```

`buildRound2ToolCallPrompt(...)` は `[Skill]` セクションとして SKILL 全文を prompt に入れる。

この設計は安全側ではあるが、次の問題がある。

- 同じ run 内で jobType が変わっていなくても SKILL 本文が繰り返し prompt に入る。
- Round 1 / Round 2 の分割と合わせて、prompt が手順文書中心になりやすい。
- 実行対象の文脈は StateCard で十分なのに、SKILL が毎回ノイズとして混ざる。
- LLM が本当に手順詳細を必要とする場面と、単純編集で不要な場面を区別できない。
- `skill.loaded` event は runtime の強制ロードを表すだけで、エージェントが実際に必要とした証拠にならない。

## Design Principle

Context を 2 種類に分ける。

```text
conversation context:
  StateCard
  latest user request
  previous final report
  target files / relevant small target contents

procedure context:
  SKILL documents
  jobType-specific workflow rules
  tool usage guidance
```

StateCard は自動注入する。これは「前回までの会話と作業対象」を失わないための最低文脈。

SKILL は自動注入しない。これは「必要時に参照する手順知識」であり、LLM が必要と判断したときだけ tool で取得する。

ただし、SKILL 未読でも危険な実行にならないよう、最低安全契約は Round 2 system prompt に残す。

## Target Flow

```text
run starts:
  latest user message + previous StateCard
  -> Round 1 chooses jobType and goal

Round 2 iteration:
  system prompt:
    - jobType
    - minimal safety contract
    - allowed tools
    - skill tools are available
    - current loadedSkillSummaries

  user prompt:
    - latestUserMessage with StateCard
    - goal
    - currentJobType
    - toolResults
    - loadedSkillSummaries

  LLM chooses one:
    - read_skill / search_skill when procedure detail is needed
    - normal worker tool when it can proceed
    - finalize_answer when complete
```

## New Tools

Add Supervisor-only tools. These are not repository worker tools and must not write files.

### `read_skill`

Reads one flat SKILL by jobType and returns a compact result.

Input:

```json
{
  "jobType": "minor_code_edit"
}
```

Output payload:

```json
{
  "jobType": "minor_code_edit",
  "path": "skills/minor_code_edit.md",
  "digest": "sha256:...",
  "summary": {
    "useWhen": "...",
    "procedure": [
      "対象パスが分かっている場合は read_file",
      "対象パスが不明な場合だけ search_files",
      "編集後は対象ファイルを確認",
      "完了時は finalize_answer"
    ],
    "requiredRules": [
      "tool result がない作業を実行済みと書かない",
      "worker tool だけで repo を読み書きする"
    ]
  }
}
```

### `search_skill`

Searches available flat SKILL names and summaries. Initial implementation may be deterministic name/description matching, not semantic search.

Input:

```json
{
  "query": "small code edit target path known",
  "maxResults": 5
}
```

Output payload:

```json
{
  "matches": [
    {
      "jobType": "minor_code_edit",
      "path": "skills/minor_code_edit.md",
      "score": 1,
      "summary": "小さい変更タスク、単一ファイルまたは少数ファイルの明確な変更。"
    }
  ]
}
```

## Session Memory

Add run-local memory in `supervisor-loop.ts`.

```ts
type LoadedSkillSummary = {
  jobType: JobType;
  path: string;
  digest: string;
  summary: {
    useWhen: string | null;
    procedure: string[];
    requiredRules: string[];
  };
  loadedAtStep: number;
};
```

Round 2 user prompt should include only loaded summaries, not full SKILL markdown.

```json
{
  "loadedSkillSummaries": [
    {
      "jobType": "minor_code_edit",
      "digest": "sha256:...",
      "procedure": ["対象パスが分かっている場合は read_file", "..."]
    }
  ]
}
```

If a jobType switch happens, keep previous summaries but make `currentJobType` explicit. The LLM may call `read_skill` for the new jobType.

## Prompt Changes

### Round 1

Keep Round 1 lightweight.

Current output:

```json
{ "jobType": "<job type>", "goal": "<short concrete goal>" }
```

Optional future extension:

```json
{
  "jobType": "minor_code_edit",
  "goal": "foo条件を追加する",
  "recommendedSkillQueries": ["minor code edit existing target file"]
}
```

Initial implementation does not need to change Round 1 output. Avoid widening schema unless tests show it is necessary.

### Round 2

Remove `[Skill] input.skill` from `buildRound2ToolCallPrompt(...)`.

Add this instead:

```text
[Skill Access]
SKILL documents are not preloaded.
Use read_skill when procedure detail is needed.
Use search_skill when the appropriate SKILL is unclear.
If loadedSkillSummaries already contains the current jobType and digest, prefer that summary instead of reading again.
```

Keep this minimal safety contract in system prompt regardless of SKILL state:

```text
[Minimum Execution Contract]
- latestUserMessage is the source user request; if it contains <STATE_CARD>, use its target and Relevant code as current continuity context.
- If target path is known, read_file before editing.
- Use search_files only when target path is unknown or cross-repo search is needed.
- Do not claim tool execution without an observation in toolResults.
- Repository reads/writes must use worker tools.
- After apply_patch succeeds, inspect changed target files before finalize_answer.
```

## Tool Validation

Add `read_skill` and `search_skill` to `toolRegistry`.

Allow them for these jobTypes:

- `planning`
- `minor_code_edit`
- `major_code_edit`
- `script_code_edit`
- `review`
- `investigation`
- `runtime_debug`
- `test_and_verification`
- `research`
- `docs`
- `git_release`
- compatibility aliases like `code`, `refactor`, `test`, `config`, `dependency`, `data_migration`, `blueprint`, `ui_ux`, `git`, `release`

`general_answer` may omit skill tools initially to keep simple answers cheap.

`getExecutableWorkerToolName(...)` should not route `read_skill` / `search_skill` into `executeWorkerTool(...)`. Handle them inside `supervisor-loop.ts` before worker dispatch.

## Events

Replace runtime-forced `skill.loaded` semantics with agent-requested events.

Keep event type name if desirable, but payload must indicate tool-driven load:

```json
{
  "agentEventType": "skill.loaded",
  "source": "read_skill",
  "jobType": "minor_code_edit",
  "skillPath": "skills/minor_code_edit.md",
  "digest": "sha256:...",
  "summary": { "...": "..." }
}
```

Add optional event:

```text
skill.searched
```

If adding a new event type creates too much UI/test churn, represent search as a normal `tool.finished` event with `toolName=search_skill`.

## Files To Modify

Modify:

```text
api/services/supervisor/prompt.ts
api/services/supervisor/supervisor-loop.ts
tests/services.supervisor.test.ts
```

Likely add:

```text
api/services/supervisor/skill-tools.ts
tests/services.supervisor-skills.test.ts
```

Do not modify:

```text
api/services/supervisor/llm-provider/*
api/services/conversation-context/*
api/services/agent-runtime/*
api/services/supervisor/skills/builtin/**
```

`api/services/conversation-context/*` is explicitly out of scope because StateCard injection remains enabled and separate.

## Implementation Steps

### Step 1: Add Skill Tool Helpers

Create `api/services/supervisor/skill-tools.ts`.

Responsibilities:

- list available flat SKILL files
- read skill markdown by jobType
- compute digest
- derive compact summary
- search by jobType/name/description

Initial summary extraction can be deterministic:

- `#` heading -> jobType
- `## Use When` section -> `useWhen`
- `## Procedure` section bullet/number lines -> `procedure`
- selected safety lines from `## Completion` / `## Output` -> `requiredRules`

Avoid LLM summarization in the first implementation.

### Step 2: Add Tools To Prompt Registry

In `prompt.ts`:

- add `read_skill`
- add `search_skill`
- include them in allowed tool lists except `general_answer`
- remove `skill` from `buildRound2ToolCallPrompt(...)` input
- remove `[Skill]` section
- add `[Skill Access]`
- keep `[Minimum Execution Contract]`

### Step 3: Handle Skill Tools In Supervisor Loop

In `supervisor-loop.ts`:

- remove unconditional `loadFlatSkill(currentJobType)`
- remove forced `skill.loaded` event on jobType changes
- add `loadedSkillSummaries` map
- include summaries in Round 2 user prompt
- when toolCall is `read_skill`, call helper and update map
- when toolCall is `search_skill`, return matches in toolResults
- do not call `executeWorkerTool(...)` for skill tools

### Step 4: Preserve StateCard Path

No code change needed if current StateCard injection remains.

Review check:

- `latestUserMessage` stays in Round 2 user prompt
- `buildPromptWithStateCard(...)` output is still passed to supervisor loop
- StateCard is not copied into skill summaries

### Step 5: Tests

Update existing tests:

- Round 2 prompt no longer contains `# minor_code_edit` full markdown.
- Round 2 prompt contains `[Skill Access]`.
- Round 2 prompt still contains minimum execution contract.
- `read_skill` toolCall returns compact summary.
- second Round 2 call includes `loadedSkillSummaries`.
- same jobType does not force `skill.loaded` before LLM asks.
- normal `minor_code_edit` can still apply_patch without reading skill first.
- jobType switch allows reading new skill.

Suggested test names:

```text
does not preload flat skill markdown into Round 2 prompt
lets the supervisor read a skill on demand
passes loaded skill summaries to later Round 2 calls
keeps minor code edit minimum contract without reading skill
does not execute read_skill through worker tools
```

## Rollout Order

1. Add helper and focused tests for parsing/searching skills.
2. Add `read_skill` / `search_skill` registry entries.
3. Remove `[Skill]` injection from Round 2 prompt.
4. Add in-loop handling for skill tools.
5. Update service tests and transcript expectations.
6. Run targeted tests.
7. Run full typecheck.

## Verification Commands

```bash
pnpm vitest run tests/services.supervisor.test.ts tests/services.supervisor-skills.test.ts
pnpm typecheck
```

If UI transcript rendering changes:

```bash
pnpm vitest run tests/thread-timeline-edit-summary.test.ts tests/thread-timeline-streaming.test.ts
```

## Review Checklist

- [ ] StateCard remains auto-injected and separate from SKILL.
- [ ] Round 2 prompt no longer includes full SKILL markdown.
- [ ] Minimal safety contract remains always present.
- [ ] `read_skill` / `search_skill` cannot write repository files.
- [ ] Skill tools are handled before worker dispatch.
- [ ] Loaded skill summaries are run-local and not persisted into StateCard.
- [ ] Repeated SKILL loading only happens when LLM explicitly asks or jobType changes.
- [ ] Tests prove simple edits can proceed without reading SKILL.

## Open Questions

1. Should `general_answer` get `read_skill`? Initial recommendation: no.
2. Should `read_skill` return full markdown on request? Initial recommendation: no; compact summary only.
3. Should `search_skill` be deterministic only? Initial recommendation: yes for first implementation.
4. Should skill digest changes invalidate summaries mid-run? Initial recommendation: compute digest at read time; no active file watching.

