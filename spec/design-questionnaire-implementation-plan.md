# Design Questionnaire Implementation Plan

## 1. Summary
Objective: Blueprint 後に残る DB Design 以外の仕様未決定事項を、LLM が複数質問のフォームとして生成し、ユーザー回答を Decision Review と design decision draft に変換できるようにする。

Expected outcome: ユーザーは上部の Blueprint ボタンから仕様サブ資料 Workspace を開き、複数 Blueprint、DB Design、Design Questionnaire、Decision Review、後続計画への参照をタブで見返せる。質問回答は一問ずつのチャットではなくカテゴリ別フォームで処理し、回答結果は設計判断、後回し事項、未解決事項として確認できる。

User value: 仕様策定の抜けを減らし、実装前に必要な判断を可視化する。LLM の質問攻めをフォーム体験に変換し、回答負荷と転記負荷を下げる。

Current status: Concept approved direction. No implementation has started in this plan.

## 2. Scope
### In Scope
- Blueprint artifact を入力にした unresolved spec gap extraction。
- 複数質問をまとめた Design Questionnaire form の生成。
- 推奨回答、選択肢、トレードオフ、分岐条件を含む structured output contract。
- Questionnaire Session の保存、再表示、途中回答。
- 回答に応じた follow-up question set の生成。
- Decision Review の表示。
- 回答結果から design decision draft を生成。
- 上部 Blueprint ボタンから開く Blueprint Specification Workspace。
- 複数 Blueprint artifact のタブ表示。
- Blueprint に紐づく DB Design、Questionnaire、Decision Review、implementation planning reference の資料集約。
- shared schema、supervisor workflow intent、skill reference の追加。
- backend service、API route、frontend form surface の最小実装。
- feature flag または明示的 UI entrypoint による段階的 rollout。

### Out of Scope
- LLM が一問ずつ質問し続けるチャット UI。
- DB table、column、relation、binding、DDL の具体化。
- migration や物理 database 変更。
- implementation queue への自動投入。
- 回答結果の無確認な設計文書反映。
- Blueprint root schema への未検討な自由 key 追加。
- 既存 Blueprint / DB Design / Design Token adoption の責務変更。

### Non-goals
- すべての仕様判断を初回フォームで網羅すること。
- 質問数を多くして網羅性だけを上げること。
- questionnaire を implementation plan の代替にすること。
- provider 側に用途別の分類ロジックや keyword 判定を分散させること。
- Questionnaire を通らない既存 Blueprint flow を弱くすること。
- すべての仕様サブ資料を AppBlueprint artifact 本体に埋め込むこと。

## 3. Background and Current State
NightWorkers の現行境界では、通常の App Blueprint generation は visual application structure を扱う。screen、section、component choice、visual intent、sample props、implementation task hints が主責務であり、DB table、column、relation、binding、DDL は DB Design workflow に分離されている。

既存文書では、Blueprint artifact は `markdown_document` task message として保存され、structured metadata に App Blueprint を持つ。Blueprint Preview では governed preview design settings、DB Design revisions、adoption state を扱う。adoption state は artifact content ではなく、session/task ID と source message ID に紐づく別 persistence である。

Design Questionnaire は、この構造の上に追加する。Blueprint の中に未決定仕様を無制限に詰め込むのではなく、Blueprint artifact を入力として質問票を生成し、回答結果を別の design decision draft として扱う。

ただし UI 上は、Blueprint を仕様サブ資料の入口として扱う。上部の Blueprint ボタンは単一の最新 Blueprint だけを開くのではなく、複数 Blueprint と関連資料をタブで見返せる Blueprint Specification Workspace を開く導線にする。

## 4. Target State
### User-facing behavior
- 上部の Blueprint ボタンから Blueprint Specification Workspace を開ける。
- Workspace 内で複数 Blueprint artifact をタブで切り替えられる。
- Workspace 内の Questionnaire タブまたは Blueprint artifact context から Design Questionnaire を開始できる。
- 初期画面には複数カテゴリの質問フォームが表示される。
- 各質問には推奨回答、選択肢、短いトレードオフ、補足入力がある。
- ユーザーはカテゴリ単位または全体で回答を保存できる。
- 回答によって追加質問が必要な場合は、次の question set としてまとめて表示される。
- 回答後に Decision Review が表示される。
- Decision Review では、決定済み、後回し、未解決、設計文書反映予定の内容を確認できる。

### System behavior
- LLM は raw conversational answer ではなく schema-valid question set を返す。
- structured output の parse / schema validation に失敗しても、LLM の本文が存在する場合は固定エラーメッセージで差し替えない。
- Questionnaire Session は source Blueprint artifact と task / repository に紐づく。
- 回答、follow-up、Decision Review、design decision draft は後から evidence として追える。
- Design Questionnaire の開始や採用は、Blueprint / DB Design adoption を上書きしない。
- Source Blueprint message is never mutated by questionnaire generation, answering, review, or adoption.
- Blueprint Specification Workspace is an aggregation view. It reads linked artifacts and adoption state without becoming the source of truth for those artifacts.

### Success criteria
- Blueprint から上位 5 から 10 件の未決定事項を質問フォームにできる。
- ユーザーが一問ずつチャットせず、複数質問をまとめて回答できる。
- 回答結果が設計判断形式に変換される。
- 未回答、後回し、未解決が Decision Review で隠れない。
- 既存 Blueprint Preview と DB Design workflow が壊れない。
- Blueprint ボタンから複数 Blueprint と仕様サブ資料を見返せる。

## 5. Architecture and Design Decisions
### Decision: Design Questionnaire is a separate workflow from Blueprint and DB Design
Rationale: Blueprint の責務を visual application structure に保ち、DB Design の data contract 責務と混ざらないようにする。
Alternatives considered: Blueprint schema に questionnaire fields を直接追加する。
Trade-offs: 別 workflow にすると API と persistence は増えるが、責務境界が明確になる。
Reversibility: 専用 session state から published task message を再生成できるため、UI artifact の出し方は後から変えられる。

### Decision: Generate grouped forms, not one-question chat turns
Rationale: ユーザーの回答負荷を下げ、未決定事項の一覧性を高める。
Alternatives considered: `grill-me` style の逐次質問チャット。
Trade-offs: フォーム生成には structured contract が必要だが、回答結果を設計文書に変換しやすい。
Reversibility: question set 単位の follow-up を持てば、将来チャット補助を併用できる。

### Decision: Decision Review is required before design document synthesis
Rationale: 回答をそのまま正式な設計判断にすると、LLM の解釈違いやユーザーの保留が混入しやすい。
Alternatives considered: 回答保存時に即 design document へ反映する。
Trade-offs: 1ステップ増えるが、確認と修正が可能になる。
Reversibility: Review artifact を source evidence として残せるため、後から再合成できる。

### Decision: Prompt and skill references own routing behavior
Rationale: NightWorkers の方針として、user text keyword 判定や provider 側の用途別 SystemContext 分散を避ける。
Alternatives considered: frontend labels or user text から heuristic に questionnaire intent を判定する。
Trade-offs: prompt / workflow の整備が必要だが、実行判断の根拠が明示される。
Reversibility: workflow intent を追加しても、provider 責務は JSON 抽出、schema 検証、最小互換正規化に限定できる。

### Decision: Use dedicated editable state for sessions and artifact messages for published reviews
Rationale: 部分回答、follow-up、review edit を扱うには、`task_messages` だけでは更新単位と query が弱い。編集中状態は専用 table に置き、採用済み Decision Review は既存 timeline / artifact evidence として task message に残す。
Alternatives considered: すべてを `task_messages.metadataJson` に保存する。
Trade-offs: v1 から schema migration が必要になるが、途中保存、再開、retry、adoption state を明確に扱える。
Reversibility: 専用 table の内容から published artifact message を再生成できるため、表示形式は後から変更できる。

### Decision: Blueprint button opens a Specification Workspace, not a single artifact
Rationale: ユーザーは仕様検討中に複数 Blueprint、DB Design revision、Questionnaire、Decision Review を行き来する。上部の Blueprint ボタンを仕様サブ資料の集約入口にすると、保存責務を混ぜずに見返しやすくなる。
Alternatives considered: 最新 Blueprint artifact だけを開く、または Questionnaire を独立画面として分離する。
Trade-offs: Workspace read model とタブ UI が必要になるが、資料の所在が分散しにくい。
Reversibility: Workspace は aggregation view なので、各 artifact の保存形式を保ったままタブ構成を後から変えられる。

## 6. LLM Output Contract
Initial contract should be schema-first and versioned.

```ts
type DesignQuestionnaire = {
  version: 1;
  source: {
    taskId: string;
    repositoryId: string;
    blueprintMessageId: string;
    blueprintVersion?: number;
  };
  title: string;
  summary: string;
  questionSets: DesignQuestionSet[];
  openQuestions: DesignOpenQuestion[];
  dbDesignHandoffNotes: DbDesignHandoffNote[];
};

type DesignQuestionSet = {
  id: string;
  title: string;
  category: string;
  purpose: string;
  questions: DesignQuestion[];
};

type DesignQuestion = {
  id: string;
  topic: string;
  question: string;
  why: string;
  answerType: "single_choice" | "multi_choice" | "boolean" | "free_text" | "ranked";
  recommendedAnswerId?: string;
  options?: DesignQuestionOption[];
  allowsCustomAnswer?: boolean;
  blocks: string[];
  outputSection: string;
  dependsOn?: DesignQuestionDependency[];
};

type DesignQuestionOption = {
  id: string;
  label: string;
  tradeoff: string;
  recommended?: boolean;
};

type DesignQuestionDependency = {
  questionId: string;
  operator: "equals" | "not_equals" | "includes" | "excludes";
  value: string | boolean | string[];
};

type DesignOpenQuestion = {
  id: string;
  topic: string;
  reason: string;
  blocks: string[];
  suggestedOwner?: "user" | "designer" | "engineer" | "db-design" | "later";
};

type DbDesignHandoffNote = {
  id: string;
  summary: string;
  sourceQuestionIds: string[];
  constraint: string;
};

type DesignDecisionDraft = {
  id: string;
  outputSection: string;
  decision: string;
  rationale: string;
  alternativesConsidered: string[];
  tradeoffs: string[];
  sourceQuestionIds: string[];
  unresolvedQuestionIds: string[];
};

type BlueprintSpecificationWorkspace = {
  taskId: string;
  repositoryId: string;
  generatedAt: string;
  blueprintArtifacts: BlueprintWorkspaceArtifact[];
  dbDesignArtifacts: BlueprintWorkspaceArtifact[];
  questionnaireSessions: BlueprintWorkspaceQuestionnaire[];
  decisionReviews: BlueprintWorkspaceArtifact[];
  implementationReferences: BlueprintWorkspaceReference[];
};

type BlueprintWorkspaceArtifact = {
  id: string;
  kind: "blueprint" | "db-design" | "decision-review";
  title: string;
  sourceMessageId: string;
  createdAt: string;
  adoptionState?: "adopted" | "not_adopted" | "unknown";
  sourceBlueprintMessageId?: string;
};

type BlueprintWorkspaceQuestionnaire = {
  id: string;
  sourceBlueprintMessageId: string;
  status: "draft" | "answering" | "review_ready" | "accepted" | "needs_edit" | "abandoned";
  answeredCount: number;
  totalQuestionCount: number;
  latestReviewId?: string;
};

type BlueprintWorkspaceReference = {
  id: string;
  kind: "implementation-plan" | "queue-candidate";
  title: string;
  sourceMessageId?: string;
  taskId: string;
};
```

Contract requirements:
- IDs use the same lowercase kebab-case style as Blueprint artifacts.
- Questions must include `why` and `blocks`; otherwise they are not actionable.
- DB schema specifics must be represented as DB Design handoff notes, not as table or column proposals.
- Follow-up questions are emitted as a new `questionSet`, not as one chat turn.
- Raw LLM output must remain inspectable for debugging.
- Decision drafts must cite source question IDs so review text can be traced back to answers.
- Workspace items must cite their source message ID, session ID, or review ID. The Workspace does not duplicate artifact content as source of truth.

## 7. Data and Migration Plan
### Storage model
Use dedicated tables for editable questionnaire state, and use task messages for published evidence.

```text
design_questionnaire_sessions
design_questionnaire_question_sets
design_questionnaire_answers
design_questionnaire_reviews
```

`task_messages` should remain the evidence and timeline layer. A generated questionnaire summary or accepted Decision Review can be published as a `markdown_document` message with structured metadata, but partial answers and in-progress review edits should not rely on append-only message updates.

The Blueprint Specification Workspace should be a read model over existing Blueprint messages, DB Design messages, Design Questionnaire tables, accepted review messages, adoption state, and implementation plan references. It should not require a separate table unless later performance or cross-task project views need caching.

### Proposed columns
`design_questionnaire_sessions`

| Column | Notes |
| --- | --- |
| `id` | UUID primary key |
| `task_id` | Source task |
| `repository_id` | Denormalized for task-scoped access and future project views |
| `source_blueprint_message_id` | Required source artifact |
| `status` | `draft`, `answering`, `review_ready`, `accepted`, `needs_edit`, `abandoned` |
| `created_at` / `updated_at` | Session lifecycle |

`design_questionnaire_question_sets`

| Column | Notes |
| --- | --- |
| `id` | UUID primary key |
| `session_id` | Questionnaire session |
| `sequence` | Initial set is `1`; follow-up sets increment |
| `questionnaire_json` | Schema-valid generated question set |
| `raw_output` | Raw LLM output for diagnostics |
| `validation_status` | `valid` or `invalid` |

`design_questionnaire_answers`

| Column | Notes |
| --- | --- |
| `id` | UUID primary key |
| `session_id` | Questionnaire session |
| `question_id` | Stable generated question ID |
| `answer_json` | Selected option IDs and optional free text |
| `answered_at` | Last answer timestamp |

`design_questionnaire_reviews`

| Column | Notes |
| --- | --- |
| `id` | UUID primary key |
| `session_id` | Questionnaire session |
| `review_json` | Decisions, deferred items, open questions, DB Design handoff notes |
| `published_message_id` | Optional task message for accepted review |
| `status` | `draft`, `accepted`, `needs_edit`, `left_unadopted` |

### Data that must be retained
- source task, repository, and Blueprint message ID
- workspace item source refs for Blueprint, DB Design, Questionnaire, Review, and implementation plan messages
- generated question sets
- raw LLM output
- schema validation result
- user answers and timestamps
- follow-up generation inputs and outputs
- Decision Review draft
- adopted / rejected / needs-edit decision for the review

### Migration safety
- Use additive schema changes only.
- Migrations must be idempotent and backward-compatible with existing task and Blueprint rows.
- Existing Blueprint, DB Design, and Design Token adoption rows must remain compatible.
- Rollback should be feature-flag disable plus leaving stored questionnaire artifacts readable.
- Do not delete or rewrite source Blueprint messages.

## 8. API, Interface, and Contract Changes
Initial endpoints should be explicit and intent-based.

```text
POST /api/tasks/:id/design-questionnaire
GET  /api/tasks/:id/design-questionnaire
GET  /api/tasks/:id/design-questionnaire/:sessionId
POST /api/tasks/:id/design-questionnaire/:sessionId/answers
POST /api/tasks/:id/design-questionnaire/:sessionId/follow-up
POST /api/tasks/:id/design-questionnaire/:sessionId/review
POST /api/tasks/:id/design-questionnaire/:sessionId/review/accept
POST /api/tasks/:id/design-questionnaire/:sessionId/review/leave-unadopted
GET  /api/tasks/:id/blueprint-specification-workspace
```

The API must make clear whether a request is generating questions, saving user answers, generating follow-up, or synthesizing review. UI should not patch arbitrary task status or Blueprint adoption state.

Contract behavior:
- Existing clients continue to work when the feature is disabled.
- Source Blueprint message ID is required for generation.
- Missing source Blueprint returns a recoverable validation error.
- Schema-valid generated questionnaire creates a session artifact.
- Schema-invalid output is stored as diagnostic evidence and surfaced without replacing real LLM text with a fixed fallback.
- Accepting a Decision Review may publish a task message, but must not mutate source Blueprint, DB Design adoption, or task queue state.
- The workspace endpoint returns an aggregation view for tabs and source refs. It must not be used to edit artifact content directly.

## 9. UI Surfaces
### Entry point
- The top Blueprint button opens Blueprint Specification Workspace.
- The button should show whether there are multiple Blueprint artifacts or pending spec materials when the existing shell can support a compact indicator.
- Opening the button should not auto-adopt, auto-generate, or mutate any artifact.

### Blueprint Specification Workspace
- Top-level tabs: `Blueprints`, `DB Design`, `Questionnaire`, `Decisions`, `Implementation`.
- `Blueprints` tab shows multiple Blueprint artifacts as sub-tabs or a tab strip, including generated time, adoption state, and source message reference.
- `DB Design` tab shows data contract revisions and adoption state without applying migrations.
- `Questionnaire` tab shows active questionnaire sessions, answer progress, follow-up status, and start/resume actions.
- `Decisions` tab shows accepted or draft Decision Reviews, open questions, deferred items, and DB Design handoff notes.
- `Implementation` tab shows linked implementation plan or queue-candidate references without queuing automatically.
- Each tab should link back to the source task message, session, or review evidence.

### Questionnaire form
- Category navigation with unanswered counts.
- Question cards with stable layout and compact controls.
- Recommended option indicator.
- Option tradeoff text.
- Optional free-text supplement.
- Save progress.
- Generate follow-up when answers require additional clarification.

### Decision Review
- Shows decisions grouped by output section.
- Shows deferred items.
- Shows unresolved open questions.
- Shows DB Design handoff notes without turning them into schema details.
- Shows source questionnaire session and Blueprint artifact reference.
- Allows user to accept, edit, or leave unadopted.

## 10. Security, Privacy, and Compliance
- Treat questionnaire answers as project design data and persist them under the same task/repository boundary as other Workbench artifacts.
- Do not log sensitive answer text outside existing task message / event evidence channels.
- Validate all generated structured output before rendering.
- Escape rendered markdown and option text.
- Do not allow generated questionnaire content to trigger tool execution.
- Keep least-privilege API access aligned with existing task access rules.
- Keep raw LLM output available for diagnosis, but do not expose it in places where users expect a polished review unless explicitly opened.

## 11. Testing Strategy
Backend tests:
- Generate questionnaire from a source Blueprint message.
- Reject generation without a source Blueprint.
- Persist structured question sets and raw output.
- Save partial answers and reload them.
- Generate follow-up question set from saved answers.
- Generate Decision Review with decisions, deferred items, and open questions.
- Publish an accepted Decision Review message without mutating the source Blueprint message.
- Preserve existing Blueprint / DB Design adoption behavior.

Frontend tests:
- Top Blueprint button opens the Specification Workspace.
- Multiple Blueprint artifacts render as tabs without losing existing Blueprint Preview behavior.
- Workspace tabs show Blueprint, DB Design, Questionnaire, Decisions, and Implementation sections from source refs.
- Questionnaire start/resume action appears only when a source Blueprint artifact is available.
- Multiple questions render as a form, not chat turns.
- Recommended options and tradeoffs are visible.
- Unanswered counts update.
- Follow-up question set appears as a grouped form.
- Decision Review shows decided, deferred, and unresolved sections.

Contract tests:
- LLM output schema accepts valid question sets.
- LLM output schema rejects table / column proposals in questionnaire-specific fields when they should be DB Design handoff notes.
- Parse failures preserve raw output for diagnostics.
- Prompt / skill routing tests verify Design Questionnaire uses an explicit workflow intent, not user-text keyword fallback.

Regression tests:
- Existing Blueprint Preview opens unchanged.
- DB Design panel still launches `design_blueprint_data`.
- Existing task message timeline still renders older Blueprint artifacts.
- Existing top Blueprint button behavior is replaced by the Workspace without removing access to the latest Blueprint preview.

## 12. Observability and Operations
Track user-impact metrics before broad rollout.

Metrics:
- questionnaire generation success rate
- schema validation failure rate
- average question count per session
- answer completion rate
- follow-up generation rate
- Decision Review acceptance rate
- skipped / abandoned questionnaire sessions
- workspace open rate
- number of Blueprint artifacts per task

Logs and evidence:
- generation label and schema name
- source task ID and Blueprint message ID
- validation result
- follow-up generation reason
- review synthesis result
- accepted review published message ID
- workspace item counts by tab

Alerts are not required for the first local-first slice, but validation failure spikes should be visible in existing LLM usage and diagnostic views.

## 13. Rollout Plan
1. Ship backend contract and schema tests behind a feature flag.
2. Add database tables and service skeleton with no visible UI.
3. Add UI entry point disabled by default.
4. Enable for internal development sessions.
5. Validate against existing Blueprint artifacts.
6. Enable by default only after Decision Review, persistence, and rollback behavior are verified.

Pause rollout if:
- generated questions include DB schema details instead of DB Design handoff notes
- existing Blueprint or DB Design flows regress
- schema validation failures are common and not diagnosable
- users cannot recover from partial answers
- workspace hides older Blueprint artifacts or makes adopted state ambiguous

## 14. Rollback and Mitigation Plan
Primary rollback: disable the Design Questionnaire feature flag.

Rollback expectations:
- Existing Blueprint, DB Design, and Design Token adoption remain unaffected.
- Stored questionnaire artifacts remain readable as task evidence.
- No source Blueprint messages are modified.
- If dedicated tables are added, schema rollback is not required for feature disable; forward-compatible unused tables may remain.

Mitigation:
- If generation fails, show diagnostic state and preserve raw LLM output.
- If review synthesis fails, keep answers saved and allow retry.
- If follow-up generation fails, users can still continue to Decision Review with unresolved questions.

## 15. Risks and Assumptions
| Risk | Impact | Likelihood | Mitigation | Owner |
| --- | ---: | ---: | --- | --- |
| Question count becomes overwhelming | High | Medium | Limit first generation to top 5-10 blocking questions and group by category | Product / UX |
| Answers remain Q&A logs instead of design decisions | High | Medium | Require Decision Review synthesis before design document handoff | Backend / LLM |
| Questionnaire drifts into DB Design | High | Medium | Prompt contract emits DB Design handoff notes instead of schema proposals | Supervisor |
| Schema validation failures hide useful LLM output | Medium | Medium | Preserve raw output and show recoverable diagnostic state | Backend |
| Existing Blueprint / DB Design workflows regress | High | Low | Feature flag, regression tests, separate intent and persistence path | Full stack |
| In-progress sessions are hard to recover | Medium | Medium | Dedicated session / answers / review tables with reload tests | Backend |
| Workspace makes source of truth ambiguous | High | Medium | Treat Workspace as read model only and show source refs/adoption state per item | Full stack |

## Assumptions
- A usable Blueprint artifact exists before starting Design Questionnaire.
- Initial implementation targets task-scoped sessions before project-wide analytics.
- The user prefers grouped form answering over sequential chat.
- DB Design remains the only workflow that concretizes App Blueprint data contracts.
- The top Blueprint button can become the entrypoint to a task-scoped specification Workspace.

## Open Questions
- Should Decision Review adoption mirror existing Blueprint adoption controls?
- Should Workspace tabs be inside the existing Artifact Pane, a route-level panel, or a modal-style workspace?
- Should question categories be fixed initially or generated per Blueprint?
- How should design decision drafts be inserted into future implementation plans?
- How much status should the top Blueprint button show without becoming visually noisy?

## 16. Implementation Phases
### Phase 1: Contract and persistence
Goal: Establish the schema, tables, and service boundaries without changing visible user flows.

| Task | Owner | Dependencies | Acceptance Criteria |
| --- | --- | --- | --- |
| Add shared Design Questionnaire schemas | Backend | Existing shared schema conventions | Valid and invalid fixtures are covered by tests |
| Add additive DB migration | Backend | Persistence decision | Existing DB bootstrap and migration smoke tests pass |
| Add service skeleton | Backend | Shared schema | Service can create, read, and update draft sessions in tests |
| Add workspace read model skeleton | Backend | Existing task message and adoption repositories | Read model returns Blueprint, DB Design, Questionnaire, Review, and Implementation sections |
| Add feature flag | Full stack | Config convention | Disabled flag leaves existing Blueprint flow unchanged |

Validation:
- Schema fixture tests pass.
- Existing Blueprint / DB Design route and service tests pass.

### Phase 2: Generation and answer capture
Goal: Generate grouped question sets from a Blueprint artifact and persist user answers.

| Task | Owner | Dependencies | Acceptance Criteria |
| --- | --- | --- | --- |
| Add explicit supervisor workflow intent | Supervisor | Phase 1 schemas | Routing does not rely on user-text keyword fallback |
| Add generation endpoint | Backend | Service skeleton | Valid source Blueprint creates a questionnaire session |
| Add workspace endpoint | Backend | Read model skeleton | Task-scoped workspace returns multiple Blueprint artifacts and related spec materials |
| Add answer endpoint | Backend | Question set persistence | Partial answers reload correctly |
| Add initial workspace UI | Frontend | Workspace endpoint | Top Blueprint button opens tabs with multiple Blueprint artifacts |
| Add initial form UI | Frontend | API endpoints | Questionnaire tab renders multiple categories and questions as a form |

Validation:
- Generation, answer persistence, and reload tests pass.
- Workspace endpoint and top-button UI tests pass.
- UI test verifies grouped form behavior.

### Phase 3: Follow-up and Decision Review
Goal: Turn answers into follow-up question sets and reviewable design decisions.

| Task | Owner | Dependencies | Acceptance Criteria |
| --- | --- | --- | --- |
| Add follow-up generation | Backend / Supervisor | Saved answers | Follow-up is emitted as a question set, not chat text |
| Add review synthesis | Backend / LLM | Answers and follow-up state | Review contains decisions, deferred items, open questions, DB Design handoff notes |
| Add Decision Review UI | Frontend | Review endpoint | Decisions tab lets user accept, edit, or leave unadopted |
| Publish accepted review message | Backend | Review acceptance | Published message cites questionnaire session and source Blueprint |

Validation:
- Review synthesis tests pass.
- Accepted review does not mutate source Blueprint or adoption state.

### Phase 4: Rollout hardening
Goal: Make the feature safe to enable beyond internal testing.

| Task | Owner | Dependencies | Acceptance Criteria |
| --- | --- | --- | --- |
| Add observability counters | Backend | Generation and review paths | Validation failure and completion rates are visible |
| Add regression coverage | Full stack | UI and API complete | Existing Blueprint Preview, multiple Blueprint tabs, and DB Design tests pass |
| Verify feature flag disable path | Release owner | All phases | Disabling flag hides entrypoint and preserves readable stored evidence |
| Add user-facing empty/error states | Frontend | API diagnostics | Missing source Blueprint and schema failure states are recoverable |

Validation:
- Feature flag rollout checklist passes.
- Manual internal session can complete generation, answering, follow-up, review, and accept.

## 17. Timeline and Milestones
| Milestone | Exit Criteria | Owner |
| --- | --- | --- |
| Design approved | Scope, contracts, persistence model, and UI surface are agreed | Product / Engineering |
| Backend contract ready | Schema, service skeleton, and generation route tests pass | Backend |
| Workspace UI ready | Top Blueprint button opens Workspace and multiple Blueprint tabs render | Frontend |
| Form UI ready | Questionnaire tab renders grouped questions and saves answers | Frontend |
| Decision Review ready | Review synthesis displays decisions, deferred items, and open questions | Full stack |
| Regression validated | Blueprint Preview and DB Design tests pass unchanged | Full stack |
| Feature flag rollout | Internal sessions can use the flow and disable path is verified | Release owner |

## 18. Readiness Checklist
Before implementation starts:
- [ ] Objective and non-goals are accepted.
- [ ] Dedicated session / answer / review persistence model is accepted.
- [ ] LLM output contract is versioned.
- [ ] UI entry point is chosen.
- [ ] Workspace tab model and multiple Blueprint behavior are accepted.
- [ ] Feature flag name and default state are defined.
- [ ] Migration and rollback expectations are accepted.
- [ ] DB Design boundary is represented in prompt and tests.
- [ ] Acceptance criteria are testable.

Before enabling by default:
- [ ] Existing Blueprint Preview regression tests pass.
- [ ] Multiple Blueprint tabs are visible from the top Blueprint button.
- [ ] Existing DB Design workflow regression tests pass.
- [ ] Questionnaire generation success and failure states are visible.
- [ ] Partial answer recovery works.
- [ ] Decision Review can be accepted, edited, or left unadopted.
- [ ] Accepted review publishes evidence without mutating source Blueprint.
- [ ] Feature flag disable path is verified.

## Top 3 Risks
1. The questionnaire becomes too large and recreates chat fatigue inside a form.
2. The output remains an answer log instead of becoming explicit design decisions.
3. The Workspace makes artifact source of truth ambiguous if source refs and adoption state are not visible.

## Go / No-Go Checklist
- Go if the workflow is separate from Blueprint and DB Design, the top Blueprint button opens a read-only aggregation Workspace, question sets are schema-valid, and Decision Review is required before synthesis.
- No-go if the implementation relies on keyword routing, rewrites source Blueprint artifacts, or cannot preserve raw LLM output on schema failure.

## Suggested First Implementation Ticket
Add the task-scoped Blueprint Specification Workspace read model and endpoint behind a disabled feature flag, returning multiple Blueprint artifacts and placeholder sections for DB Design, Questionnaire, Decisions, and Implementation without mutating any source artifact.
