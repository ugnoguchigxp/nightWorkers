# Review Mode Implementation Plan

## Purpose

NightWorkers に Review Mode を追加し、完了済みまたは確認待ちの run evidence を、採用判断、修正依頼、follow-up Goal、contextStill knowledge candidate へつなぐ。

この計画は `spec/docs/review-and-autonomous-goals-concept.md` の初期実装計画である。Review Mode は、コードレビュー機能、脆弱性診断、実装中セルフレビューを再実装しない。既存の Todo closeout、quality gate、self-review、optional security plugin evidence、Queue evidence、Mission proposal trace を受け取り、ユーザーが必要な断面だけ確認できる review workspace を作る。

初期実装の目的は次の4点に絞る。

- run 完了後に lightweight deterministic review recommendation を作る。
- Workbench のチャット欄を Review Mode に切り替え、Status をメイン artifact として必要な review section を選べるようにする。
- Review finding を action disposition 付きで保存し、follow-up Goal / Task proposal / contextStill candidate へつなぐ。
- minor task では review を optional / skip 可能にし、high-risk または evidence mismatch がある run だけ required にする。

## Confirmed Baseline

現状の実装には次の土台がある。

- `ReviewEvidencePack`
  - run status、diff、verification、policy、final report、selected events、既存 review result を持つ。
- review rubrics
  - deterministic evaluator、LLM reviewer、firewall、merger、replay evaluator がある。
- `ReviewResult`
  - reviewer、verdict、findings、humanCallouts、agentFollowUps、suggestedNextTasks、evidenceRefs を持つ。
- run event schema
  - `review.rubric_loaded`, `review.evaluation_started`, `review.llm_started`, `review.llm_finished`, `review.evaluation_finished`, `human.review_submitted` がある。
- Queue resilience
  - queue execution は安定化され、Queue / run / task status と recovery evidence を review input にできる前提になった。
- Mission Decomposition
  - Goal から Mission planning result / task proposal を作る計画が進んでいる。
- optional security plugins
  - vulnWorkbench のような専門診断プロジェクトは plugin / connector 的に見つけられる場合だけ利用し、Review Mode は診断そのものを担わない。
- 実装中 closeout
  - Todo 主体の完了報告、quality gate、LLM self-review の結果を evidence として扱える。

現状の弱点:

- Review を開始するかどうかの lightweight recommendation がない。
- Review が Plan Mode のような dedicated workspace になっておらず、Status 起点で必要断面を選べない。
- Review finding の disposition がなく、人間確認、agent follow-up、Goal 化、contextStill candidate 化の区別が保存できない。
- Review result から Mission / Goal / Task proposal へつながる明示 bridge がない。
- contextStill に送る前の knowledge candidate preview / edit / discard がない。

## Design Direction

### Review Mode は Workbench mode として扱う

Review Mode は独立した大画面ではなく、Workbench Session のチャット欄を review 用 guided workspace に切り替える。

```text
Workbench Session
  -> normal chat / plan mode / implementation
  -> run completed
  -> review recommendation
  -> Review Mode
```

Review Mode の primary artifact は `review_status` とする。Plan Mode が future-oriented な `feature_plan` を中心にするのに対し、Review Mode は evidence-oriented な `review_status` を中心にする。

### Status 画面をメインにする

Review Status は review 全体のホームである。ここで以下を表示する。

- recommendation level
- review に入る理由
- review section 一覧
- 各 section の requirement / progress
- blocking finding の有無
- final action の可否
- follow-up Goal / contextStill candidate の候補数

ユーザーは Status から必要な section だけ実行する。minor task では review を skip できる。

### Review section は必要なものだけ生成する

Plan Mode の dedicated view と同じく、Review Mode の section は常に全部生成しない。review recommendation の reasons と run evidence に応じて `required` / `recommended` / `optional` / `omitted` を決める。

初期 section:

- `acceptance_evidence`
- `verification_evidence`
- `self_review_followups`
- `queue_recovery`
- `security_review`
- `findings`
- `proposed_goals`
- `knowledge_candidates`

### Review は診断ではなく action routing

Review Mode は external security plugin や実装中 self-review と重複しない。

- optional security plugin: 脆弱性診断と scanner evidence を作る。vulnWorkbench はその代表例だが、NightWorkers 本体へ移植しない。
- self-review / quality gate: 実装中に改善を促す。
- Review Mode: 既存 evidence を読み、採用判断、修正依頼、Goal 化、knowledge 化へ分配する。

### LLM reviewer は初期導入しない

Phase 1-5 では deterministic recommendation と deterministic findings を優先する。LLM reviewer は Phase 6 の optional lane とし、verdict authority ではなく、説明文、follow-up prompt、knowledge candidate の整形に限定する。

LLM reviewer が deterministic blocking finding を消すことは禁止する。

### Review state は execution status ではなく overlay

Review recommendation は run evidence の上に載る判断 layer であり、既に terminal になった `task_runs.status` を巻き戻さない。Plan Mode 中であることを Kanban status にしないのと同じく、Review Mode 中であることも Kanban column / task execution status にしない。

Initial rule:

- completed run に `required` review が付いた場合、run は completed のまま、review session が required / unresolved を保持する。
- task / run / queue entry の execution status は `completed` のまま維持する。
- Kanban では card badge / overlay action として `review_required`, `review_recommended`, `blocking_findings` を表示する。
- queue entry terminal state は Review Mode の開始・終了で変更しない。
- final action が `request_changes` または `needs_human` の場合は、follow-up Goal / Task proposal / task status で次アクションを表す。

## Terms

### Review Recommendation

run 完了後に作られる lightweight deterministic 判定。

```ts
type ReviewRecommendationLevel =
  | 'none'
  | 'optional'
  | 'recommended'
  | 'required';

type ReviewRecommendation = {
  version: 1;
  runId: string;
  taskId: string;
  level: ReviewRecommendationLevel;
  defaultAction: 'skip' | 'offer_review' | 'require_review';
  reasons: ReviewRecommendationReason[];
  createdAt: string;
};

type ReviewRecommendationReason = {
  code:
    | 'minor_no_review_needed'
    | 'large_diff'
    | 'many_changed_files'
    | 'verification_missing'
    | 'verification_failed'
    | 'acceptance_evidence_missing'
    | 'todo_unresolved'
    | 'self_review_unresolved'
    | 'queue_recovery_present'
    | 'queue_run_status_mismatch'
    | 'security_sensitive_change'
    | 'security_plugin_missing'
    | 'schema_or_migration_change'
    | 'public_contract_change'
    | 'final_report_evidence_mismatch';
  severity: 'info' | 'warning' | 'blocking';
  label: string;
  evidenceRefs: ReviewEvidenceRef[];
};
```

### Review Section

Review Mode 内で確認する evidence の断面。

```ts
type ReviewSectionKind =
  | 'acceptance_evidence'
  | 'verification_evidence'
  | 'self_review_followups'
  | 'queue_recovery'
  | 'security_review'
  | 'findings'
  | 'proposed_goals'
  | 'knowledge_candidates';

type ReviewSectionRequirement =
  | 'required'
  | 'recommended'
  | 'optional'
  | 'omitted';

type ReviewSectionProgress =
  | 'not_started'
  | 'running'
  | 'done'
  | 'blocked'
  | 'needs_human';

type ReviewStatusArtifact = {
  version: 1;
  reviewSessionId: string;
  runId: string;
  taskId: string;
  recommendation: ReviewRecommendation;
  sections: Array<{
    kind: ReviewSectionKind;
    requirement: ReviewSectionRequirement;
    progress: ReviewSectionProgress;
    reason: string;
    artifactId: string | null;
    findingCounts: {
      blocking: number;
      warning: number;
      info: number;
    };
  }>;
  finalActionGate: {
    canApprove: boolean;
    blockingReason: string | null;
    unresolvedBlockingFindingIds: string[];
    requiredSectionKindsRemaining: ReviewSectionKind[];
  };
};
```

### Review Status Artifact

Review Mode の primary artifact。各 section の requirement / progress と final action gating を持つ。

### Review Finding Disposition

finding を次にどう扱うかを示す。

```ts
type ReviewFindingDisposition =
  | 'human_callout'
  | 'agent_followup'
  | 'proposed_goal'
  | 'security_plugin_handoff'
  | 'knowledge_candidate'
  | 'accepted_risk'
  | 'ignored';
```

### Knowledge Candidate

contextStill に送る前の preview artifact。Review finding をそのまま送らず、再利用可能な rule / procedure / failure pattern に一般化したもの。

## Scope

In scope:

- Review recommendation を run closeout 後に deterministic に生成する。
- Review Mode state を Workbench Session に追加する。
- `review_status` primary artifact を追加する。
- Status から review sections を実行できる UI を作る。
- ReviewEvidencePack を Queue / self-review / optional security plugin evidence / Mission trace で拡張する。
- deterministic findings を追加する。
- finding disposition を保存する。
- finding から proposed Goal / Task proposal candidate を作る。
- finding から contextStill knowledge candidate preview を作る。
- contextStill への送信 action を Review Mode から実行できるようにする。
- required section / blocking finding による final action gating。
- Focused backend / UI tests。

Out of scope:

- PR review 風 UI。
- Review Mode / Plan Mode を Kanban column や task execution status として追加すること。
- vulnWorkbench や同等 security plugin の診断ロジック再実装。
- 実装中 self-review / quality gate の再実装。
- LLM verdict による approve / reject 主導。
- Review Mode から人間承認なしに Queue へ自動投入すること。
- 初期実装で全 section を常時生成すること。
- contextStill に file read / shell exec / project side effect を持たせること。
- Mission progress dashboard の実装。

## Target Behavior

### Run completion

- run 完了時に `ReviewRecommendation` が作られる。
- `none` / `optional` / `recommended` の場合、run は通常どおり completed にできる。
- `required` の場合、completed run を巻き戻さず、Review Mode card と unresolved required state で Review Mode を促す。
- `required` review は execution status ではなく review overlay として保持する。
- recommendation は deterministic であり、LLM call を必要としない。

### Kanban behavior

- Kanban columns remain execution-lifecycle oriented.
- Review Mode and Plan Mode do not create columns.
- Completed tasks stay in `completed` even when review is required or recommended.
- Cards may show review badges:
  - `review_required`
  - `review_recommended`
  - `blocking_findings`
  - `followup_goal_created`
  - `knowledge_candidate_pending`
  - `security_plugin_missing`
- Card actions can open Review Mode, but Review section details stay inside Review Mode artifacts.

### Review entry

- Workbench timeline に compact な review recommendation card を表示する。
- ユーザーは `Start Review`, `Skip`, `Create follow-up` を選べる。
- `required` の場合、`Skip` は無効または accepted risk 記録が必要。

### Review Mode

- チャット欄が Review Mode に切り替わる。
- primary artifact として `review_status` が表示される。
- Status から required / recommended / optional section を実行できる。
- omitted section は理由だけ表示する。
- section 実行後、Status に progress と findings が反映される。

### Final actions

初期 action:

- `approve`
- `request_changes`
- `create_followup_goal`
- `security_plugin_handoff`
- `save_knowledge_candidate`
- `accept_risk`
- `exit_review`

Rules:

- required section が未完了なら `approve` は無効。
- blocking finding が unresolved なら `approve` は無効。
- blocking finding を `accepted_risk` にする場合は note と evidence refs を必須にする。
- `create_followup_goal` は Goal / Task proposal を作るだけで、Queue へは入れない。
- contextStill 送信は knowledge candidate preview をユーザーが確認した後に行う。

## Recommendation Rules

Recommendation は section artifact を生成しない。既存 run evidence と metadata から軽く判定し、Review Mode に入る価値だけを決める。

### `none`

追加 review を出さない。

例:

- diff なしの general answer。
- no-op run。
- 短い read-only investigation。

### `optional`

完了扱いのまま、軽い review option を出す。

例:

- small copy change。
- docs-only change。
- focused verification が明確に pass。
- Todo / final report / diff が整合している。

### `recommended`

完了扱いは可能だが、review entry を目立たせる。

例:

- changed files が多い。
- diff size が大きい。
- self-review warning が残っている。
- verification が partial。
- final report が changed files を十分説明していない。
- Queue retry / recovery が発生した。
- follow-up candidate がある。

### `required`

Review Mode を通さないと review acceptance を完了扱いにしない。既に completed の run 自体は巻き戻さず、unresolved required review として表示する。

例:

- DB migration / schema change。
- auth / permission / secret / payment / security-sensitive path の変更。
- public API / worker tool / MCP tool contract の変更。
- security plugin scan が必要そうだが、利用可能な plugin evidence がない。
- Todo が open / blocked / failed のまま。
- verify pass evidence がないのに final report が pass を主張している。
- Queue / run / task status に不整合がある。
- deterministic blocking finding がある。

## Review Sections

### `acceptance_evidence`

目的:

Task / Mission proposal の acceptance criteria と evidence の対応を見る。

Inputs:

- task objective / acceptance criteria
- Mission proposal metadata
- final report
- selected run events
- verification events
- changed files

Findings:

- missing acceptance evidence
- partial acceptance evidence
- final report claims without evidence

### `verification_evidence`

目的:

verify / test / coverage / migration gate の結果を確認する。

Inputs:

- verification events
- test results
- coverage autonomy result
- migration Todo / migration evidence
- final report

Findings:

- verification missing
- verification failed
- coverage gate unresolved
- migration apply/verify evidence missing

### `self_review_followups`

目的:

実装中 self-review の warning / improvement が解消されたかを見る。

Inputs:

- self-review events
- Todo updates
- diff after self-review
- final report

Findings:

- unresolved self-review item
- self-review item marked resolved without supporting diff/event

### `queue_recovery`

目的:

Queue retry / recovery / lease reconciliation が成果に影響したかを見る。

Inputs:

- queue entry evidence
- recovery events
- run retry history
- task messages

Findings:

- recovery not explained in final report
- terminal run / queue status mismatch
- retryable failure left without follow-up

### `security_review`

目的:

security-sensitive change に対して external security plugin evidence が必要か確認する。

Inputs:

- changed file path classification
- optional security plugin discovery result
- external security scan result link
- security-sensitive diff metadata
- final report

Findings:

- security plugin unavailable
- security plugin scan missing
- external security finding unresolved
- accepted risk missing note

### `findings`

目的:

section findings を統合し、severity と disposition を決める。

Inputs:

- all section findings
- deterministic rubric output
- optional LLM assisted classification

Outputs:

- merged ReviewFindings
- disposition per finding
- final action gating state

### `proposed_goals`

目的:

`proposed_goal` disposition の finding から Goal / Task proposal candidate を作る。

Rules:

- evidence refs が解決できない finding は Goal 化しない。
- code change Goal は人間承認なしに Queue へ入れない。
- Mission Decomposition の Task Proposal と同じく、initial prompt、expected outcome、acceptance criteria、verification gate を持つ。

### `knowledge_candidates`

目的:

`knowledge_candidate` disposition の finding を contextStill に送れる候補へ一般化する。

Rules:

- Review finding をそのまま送らない。
- 単発のファイル名 / 行番号だけに依存する内容は候補にしない。
- `rule`, `procedure`, `failure_pattern` のどれとして保存するかを明示する。
- ユーザーが preview / edit / discard できる。

## Data Model

Initial implementation should keep Review Mode persistence separate from existing `ReviewResult` event payloads. `ReviewResult` remains the compact outcome record; `review_sessions`, `review_artifacts`, and `review_findings` are the review workspace state.

### `review_recommendations`

```ts
type ReviewRecommendationRow = {
  id: string;
  runId: string;
  taskId: string;
  repositoryId: string;
  level: ReviewRecommendationLevel;
  defaultAction: 'skip' | 'offer_review' | 'require_review';
  reasonsJson: ReviewRecommendationReason[];
  createdAt: Date;
  updatedAt: Date;
};
```

### `review_sessions`

```ts
type ReviewSessionStatus =
  | 'not_started'
  | 'in_progress'
  | 'approved'
  | 'changes_requested'
  | 'needs_human'
  | 'cancelled';

type ReviewSessionRow = {
  id: string;
  runId: string;
  taskId: string;
  repositoryId: string;
  status: ReviewSessionStatus;
  recommendationId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  finalAction: string | null;
  finalNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

### `review_artifacts`

Initial implementation can store section artifacts as JSON rows.

```ts
type ReviewArtifactRow = {
  id: string;
  reviewSessionId: string;
  runId: string;
  taskId: string;
  kind: 'review_status' | ReviewSectionKind;
  status: ReviewSectionProgress;
  artifactJson: unknown;
  sourceEvidenceRefsJson: ReviewEvidenceRef[];
  createdAt: Date;
  updatedAt: Date;
};
```

### `review_findings`

```ts
type ReviewFindingRow = {
  id: string;
  reviewSessionId: string;
  runId: string;
  taskId: string;
  severity: 'info' | 'warning' | 'blocking';
  title: string;
  body: string | null;
  disposition: ReviewFindingDisposition | null;
  dispositionStatus:
    | 'unresolved'
    | 'accepted'
    | 'converted'
    | 'dismissed';
  evidenceRefsJson: ReviewEvidenceRef[];
  createdGoalId: string | null;
  createdTaskProposalId: string | null;
  contextStillCandidateId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

### `review_knowledge_candidates`

```ts
type ReviewKnowledgeCandidateStatus =
  | 'draft'
  | 'sent'
  | 'discarded'
  | 'send_failed';

type ReviewKnowledgeCandidateRow = {
  id: string;
  reviewSessionId: string;
  findingId: string;
  candidateType: 'rule' | 'procedure' | 'failure_pattern';
  title: string;
  body: string;
  avoid: string | null;
  prefer: string | null;
  status: ReviewKnowledgeCandidateStatus;
  contextStillCandidateId: string | null;
  sendError: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

Procedure candidates must be generated with the expected `Use when` / `Workflow` / `Verification` / `Avoid` structure before send.

## API Surface

Initial routes:

- `GET /api/runs/:id/review-recommendation`
- `POST /api/runs/:id/review-sessions`
- `GET /api/review-sessions/:id`
- `POST /api/review-sessions/:id/sections/:section/run`
- `POST /api/review-sessions/:id/findings/:findingId/disposition`
- `POST /api/review-sessions/:id/proposed-goals`
- `POST /api/review-sessions/:id/knowledge-candidates`
- `POST /api/review-sessions/:id/knowledge-candidates/:candidateId/send`
- `POST /api/review-sessions/:id/final-action`

Notes:

- Existing `/api/runs/:id/reviewer-evaluations` remains available for rubric evaluation.
- Review Mode section generation may reuse review-rubrics services, but user-facing Review Mode should not require LLM reviewer in Phase 1.

## UI Surface

### Workbench recommendation card

Displayed after run completion when recommendation is not `none`.

Content:

- recommendation level
- top 3 reasons
- action buttons
  - `Start Review`
  - `Skip`
  - `Create follow-up`

`required` recommendation:

- `Skip` disabled unless accepted risk note is supported by product policy.

### Review Mode chat state

When Review Mode starts:

- Workbench composer switches to review-aware prompts.
- Chat timeline shows guided review messages.
- Artifact pane opens `review_status`.
- Normal implementation actions are hidden or disabled unless the user exits Review Mode.

### Review Status artifact

Displays:

- recommendation level
- reasons
- sections grouped by requirement
- progress
- findings summary
- final action gate
- proposed goals count
- knowledge candidates count

Example:

```text
Review Status

Recommendation: Recommended

Required
- Acceptance Evidence       done
- Queue / Recovery          pending

Recommended
- Self-review Follow-ups    pending
- Proposed Goals            not started

Optional
- Knowledge Candidates      not started

Omitted
- Security Review           no security-sensitive changes detected
```

### Section artifact

Each section has:

- evidence summary
- findings
- recommended actions
- evidence refs
- actions for disposition

### Knowledge candidate preview

Displays:

- title
- type: `rule` / `procedure` / `failure_pattern`
- body
- avoid / prefer when relevant
- source findings
- send / edit / discard actions

## Phases

### Phase 1. Recommendation and Status artifact

Deliverables:

- Add `ReviewRecommendation` schema.
- Generate deterministic recommendation after run terminal state.
- Add `review_status` artifact schema.
- Add Workbench recommendation card.
- Add Review Mode session start API.
- Add Status artifact UI with static section requirement calculation.

Verification:

- minor task produces `optional` or no recommendation.
- schema change / security-sensitive change / missing verify produces `required`.
- Workbench can enter Review Mode and render Status.
- `bunx vitest run` targeted review / workbench tests.

### Phase 2. ReviewEvidencePack expansion and deterministic sections

Deliverables:

- Extend ReviewEvidencePack with queue recovery, Todo closeout, self-review, optional security plugin link, Mission proposal trace.
- Implement `acceptance_evidence`, `verification_evidence`, `queue_recovery`, `security_review` deterministic section generators.
- Persist section artifacts.
- Update Status progress after section completion.

Verification:

- missing acceptance evidence creates finding.
- queue recovery without final report mention creates warning.
- security-sensitive change without available security plugin evidence creates finding.
- omitted sections show deterministic reasons.

### Phase 3. Findings and disposition routing

Deliverables:

- Add `review_findings` persistence.
- Merge section findings into `findings` artifact.
- Add disposition API and UI.
- Gate final actions based on required sections and unresolved blocking findings.

Verification:

- blocking unresolved finding prevents approve.
- accepted risk requires note and evidence refs.
- `agent_followup`, `human_callout`, `security_plugin_handoff`, `proposed_goal`, `knowledge_candidate` dispositions persist.

### Phase 4. Proposed Goals bridge

Deliverables:

- Convert `proposed_goal` findings into Review-owned proposed Goal records first.
- Preserve evidence refs and review session trace.
- Do not auto-create Queue entries.
- Show Proposed Goals section in Review Mode.
- Add an adapter that can materialize a Review proposed Goal into Mission Planner input or a Task proposal when that target flow is available.

Verification:

- evidence-less finding cannot become Goal.
- approved proposed Goal creates a review-owned proposed Goal without queue admission.
- materialization uses the Mission Planner / Task proposal boundary when available and preserves review evidence refs.
- Goal execution remains human-approved.

### Phase 5. contextStill knowledge candidate flow

Deliverables:

- Convert `knowledge_candidate` findings into preview candidates.
- Allow edit / discard / send.
- Use an explicit contextStill integration boundary. The initial backend should call a configured contextStill MCP/server integration if available; otherwise it should keep the candidate in `draft` and show the missing integration state.
- Store send result and candidate id.

Verification:

- local file-specific finding is not sent without generalization.
- procedure candidate includes required structure when save type is procedure.
- send failure leaves candidate editable and not marked sent.

### Phase 6. Optional LLM assisted review

Deliverables:

- Add LLM assisted classification for explanation / follow-up prompt / knowledge candidate drafting.
- Keep deterministic blocking findings authoritative.
- Add degraded handling for unknown evidence refs.

Verification:

- LLM finding with unresolved evidence ref is downgraded or degraded.
- LLM cannot clear deterministic blocking finding.
- token usage is only incurred after user starts Review Mode or required review begins.

## Final Action Semantics

### `approve`

Allowed when:

- required sections are done
- unresolved blocking findings are absent
- accepted risk findings have notes

Effect:

- Review session -> `approved`
- optional `ReviewResult` persisted
- run / task / queue entry execution status remains unchanged

### `request_changes`

Effect:

- Review session -> `changes_requested`
- selected findings become `agent_followup` or `proposed_goal`
- user can create follow-up Goal / Task proposal
- original completed task stays completed unless a separate follow-up task is created

### `needs_human`

Effect:

- Review session -> `needs_human`
- execution status is not changed by Review Mode itself
- a follow-up task, proposed Goal, or human callout records the next action

### `exit_review`

Allowed when review was optional / recommended.

Effect:

- Review session can remain `in_progress` or `cancelled`
- no forced Goal / candidate creation

## Interaction With Mission Decomposition

Mission Decomposition creates Task Proposals from user goals.

Review Mode creates follow-up Goal / Task Proposal candidates from run evidence.

They should share these principles:

- Proposal is not Task.
- Task is not Queue Entry.
- Human selects proposal before Task materialization.
- Queue admission remains explicit.
- Evidence / traceability is preserved through proposal -> task -> run.

Initial integration:

- Review finding `proposed_goal` creates a Review-owned proposed Goal with evidence refs.
- If Mission Planner tables and APIs are available, materialize the proposed Goal through that API boundary.
- If Mission Planner is not available, keep the proposed Goal as a review artifact and expose it for later Task creation.
- Review Mode must not write directly into Mission Planner internals if the Mission lifecycle is still in progress.

## Interaction With External Security Plugins

Review Mode does not own security scanning. It discovers optional security plugins / connectors and can hand off review findings only when a compatible integration is available.

vulnWorkbench is the expected first-class optional integration, but it remains a separate specialized project. NightWorkers must not migrate its scanner, reproduction, DAST, ranking, or report implementation into this repository.

Initial behavior:

- Detect security-sensitive changes deterministically.
- Discover available security integrations by configured plugin / connector metadata.
- If a compatible security plugin is available and evidence exists, link it.
- If a compatible plugin is available but evidence is missing, create finding with disposition `security_plugin_handoff`.
- If no compatible plugin is available, create warning or required finding based on change risk, with action `install/configure plugin` or `accept risk`.
- User can create a handoff request or defer with accepted-risk note.
- Review Mode stores the handoff request/result as evidence; the external plugin remains responsible for scan execution and vulnerability judgment.

Out of scope:

- scanner rule design
- vulnerability ranking
- exploit reproduction
- vulnWorkbench report UI duplication
- moving vulnWorkbench code or schemas into NightWorkers core

## Interaction With contextStill

Review Mode can create knowledge candidates, but Review findings are not knowledge by default.

Rules:

- Only generalized lessons are sent.
- Candidate preview is required before send.
- contextStill remains advisory / durable knowledge, not source of truth.
- NightWorkers stores review finding and send result regardless of contextStill outcome.
- Sending to contextStill is never required for `approve`; it is a post-review learning action.

## Risks

### Review becomes too heavy for minor tasks

Mitigation:

- deterministic recommendation defaults minor work to `none` or `optional`.
- section artifacts are generated on demand.
- LLM assisted review is Phase 6 and opt-in / required-only.

### Review duplicates existing quality gates

Mitigation:

- Review reads quality gate output as evidence.
- Review does not rerun verify / coverage / self-review unless user explicitly asks.

### Review becomes another planning mode

Mitigation:

- primary artifact is `review_status`, not a new plan.
- sections are evidence-oriented.
- proposed goals are outputs, not the main review body.

### contextStill receives noisy findings

Mitigation:

- knowledge candidate preview required.
- file-specific finding must be generalized.
- send action is explicit.

## Acceptance Criteria

- Completed run can produce a deterministic ReviewRecommendation.
- Review recommendation can classify none / optional / recommended / required.
- Workbench can enter Review Mode from a recommendation card.
- Review Mode renders `review_status` as the primary artifact.
- Status lists required / recommended / optional / omitted sections.
- User can run a section and see persisted findings.
- Blocking finding gates approve until resolved or accepted risk is recorded.
- Finding disposition can create proposed Goal / Task proposal candidate without queue admission.
- Knowledge candidate preview can be created from finding and sent explicitly to contextStill.
- Minor tasks are not forced through heavy review by default.
- LLM assisted review is not required for Phase 1-5.
