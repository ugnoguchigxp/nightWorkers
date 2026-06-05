# User Text Heuristic Routing Cleanup Plan

## 目的

NightWorkers の実行判断や Workbench 状態判定から、ユーザー文言を正規表現・keyword・固定 phrase で分類する残存実装を取り除く。

この計画は、`AGENTS.md` の以下の方針に合わせるための TodoList である。

- ユーザー文言を正規表現や keyword 判定で分類し、処理を分ける実装をしない。
- 実行判断は workflow と prompt 指示に基づかせる。
- Supervisor の実行方針は prompt 側で定義し、llm-provider 側や周辺 runtime に用途別判断を分散させない。

## 現状

現在の main Workbench intake path は、`callSupervisorLLM(buildRound1JobTypePrompt(...))` の `jobType` を使って routing / immediate run / Blueprint generation を決めている。この部分は基本方針に沿っている。

一方で、古い `task-intake` モジュールと一部の metadata fallback に、文言ベース分類が残っている。

## Tauri / folder-first 体験で問題化する理由

NightWorkers は Codex app 形式の folder-first 操作体験を採用する。ユーザーは git repository ではなく、ローカル folder / workspace を選び、その folder に対して自然文で作業を依頼する。

Tauri 化すると、この体験は開発中の Web UI ではなく、普通に起動して使う desktop app の体験になる。その状態で runtime 側に user text keyword / regex / fixed phrase による routing が残ると、次のように見える。

- 「確認して」「テストもお願い」「よろしく」などの自然な入力が、理由不明に review / verification / needs_human へ寄る。
- `metadata.title` に `plan` が含まれるだけで、implementation plan や Queue-ready evidence として扱われる。
- LLM Round 1 が判断した `jobType` / workflow とは別に、runtime 側が別の分類を混ぜているように見える。
- ユーザーからは、アプリが folder に対する依頼を素直に処理しているのではなく、内部 keyword に反応して気まぐれに振る舞っているように見える。

したがって、この cleanup は単なる内部整理ではなく、Tauri 化前後の folder-first desktop app 体験を安定させるための信頼性整理である。

## 対象範囲

対象:

- `api/services/task-intake/` の heuristic / fallback 分類
- `tests/services.task-intake.test.ts` の heuristic 挙動固定
- `api/modules/nightworkers/nightworkers.service.ts::hasImplementationPlanEvidence`
- `src/modules/nightworkers/workbenchSelectors.ts::inferDocumentArtifactKind`
- conversation context の path 抽出を、実行判断ではなく補助 context として明確化すること

対象外:

- command / path / secret safety policy の regex
- schema validation regex
- JSON fenced block extraction
- HTML/content parsing
- Hook matcher regex
- LLM provider response parsing

## 方針

1. 実行判断に関係する分類は、LLM Round 1 の schema-first `jobType` / routing metadata / explicit UI intent に寄せる。
2. `metadata.title` の keyword fallback は、可能な限り explicit `metadata.intent` / structured metadata に置き換える。
3. `task-intake` は production 未使用なら削除または dormant 化し、将来再利用されても heuristic fallback が復活しない形にする。
4. StateCard の file path 抽出は workflow 分類ではないため残してよいが、実行判断に使わないことをテストか命名で固定する。
5. Tauri / desktop app 化後も、folder-first の入力が runtime keyword 判定ではなく schema-first workflow 判断に流れることを受け入れ条件として固定する。

## TodoList

### Phase 1: 現状固定と影響確認

- [x] `rg -n "planTaskIntake\\(|inferTaskType\\(|heuristicPlan\\(|hasImplementationPlanEvidence|inferDocumentArtifactKind|extractConservativePaths" api src tests` で残存箇所を再確認する。
- [x] `planTaskIntake` の production 呼び出しがないことを再確認する。
- [x] `task-intake` の型だけが `procedures` / `todo-context` で使われているか確認する。
- [x] `hasImplementationPlanEvidence` が Queue eligibility に与える影響箇所を確認する。
- [x] `inferDocumentArtifactKind` が UI artifact 表示だけに閉じていることを確認する。

### Phase 2: task-intake heuristic の撤去

- [x] `planTaskIntake` の `generatePlan` なし fallback を廃止する。
- [x] `heuristicPlan` を削除する。
- [x] `splitPromptIntoTodoCandidates` を削除する。
- [x] `inferTaskType` を削除する。
- [x] `isAmbiguousPrompt` を削除する。
- [x] generated plan の todo に `taskType` が欠けている場合は、文言から推定せず `needs_human` または explicit default policy にする。
- [x] fallback plan を作る場合も、文言判定ではなく `taskType: "investigation"` など安全側の単一 default に固定する。
- [x] `TaskIntakePlan["source"]` から `heuristic` が不要なら削除する。
- [x] `tests/services.task-intake.test.ts` から heuristic 挙動テストを削除または更新する。
- [x] malformed generated output の fallback test を、keyword 推定なしの安全 fallback に更新する。

### Phase 3: implementation plan evidence の title fallback 撤去

- [x] `hasImplementationPlanEvidence` を `metadata.intent` ベースに限定する。
- [x] `title.includes("plan")` / `title.includes("implementation plan")` fallback を削除する。
- [x] 既存データ互換が必要なら migration ではなく read-only compatibility path を別名関数に分離し、新規判断 path からは呼ばない。
- [x] Queue admission / dashboard tests に、title だけでは plan-ready にならないケースを追加する。
- [x] `metadata.intent: "implementation_plan"` / `"draft_spec"` で plan-ready になるケースを維持する。

### Phase 4: artifact kind inference の title fallback 撤去

- [x] `inferDocumentArtifactKind` を explicit metadata に限定する。
- [x] `metadata.title.includes("plan")` fallback を削除する。
- [x] `markdown_document` で intent がない場合の default を `spec` に固定する。
- [x] UI selector tests に、title に `plan` を含んでも intent がなければ `implementation_plan` にならないケースを追加する。
- [x] `metadata.intent: "implementation_plan"` の場合は従来どおり `implementation_plan` になることを確認する。

### Phase 5: conversation context の補助抽出境界を固定

- [x] `deriveTargetFiles` / `extractConservativePaths` が workflow / jobType / taskType を変更しないことを確認する。
- [x] 必要なら関数コメントを追加し、これは prompt context 用の conservative file hint であり実行判断ではないと明示する。
- [x] tests に、path 抽出が classification を変更しないことを示す最小ケースを追加する。
- [x] `renderStateCard` の `CODE_EDIT_JOB_TYPES` が metadata-derived classification の表示補助であり、user text 分類ではないことを確認する。

### Phase 6: ドキュメント同期

- [x] `spec/docs/architecture.md` に、Workbench intake の実行判断は schema-first Round 1 の `jobType` / routing metadata によることを追記する。
- [x] `spec/docs/configuration.md` に変更が必要か確認する。
- [x] README の current capabilities に影響がある場合のみ更新する。
- [x] この計画書の Todo を実装状況に合わせて更新する。

### Phase 7: Tauri / folder-first 受け入れ基準の固定

- [x] folder-first 操作では、git repository の有無を routing 判断の前提にしないことを確認する。
- [x] `確認して` / `テストもお願い` / `よろしく` などの user text が runtime regex によって workflow / taskType / execution path を決めないことを確認する。
- [x] Workbench intake の routing source が `intakeJobSelection` / `routingHypothesis` / explicit `intent` のいずれかとして説明できることを確認する。
- [x] Tauri 化後の入口でも、folder 選択後の自然文入力が同じ Workbench intake path に入り、別の desktop-only keyword path を追加しないことを計画上の制約にする。
- [x] UI に表示される plan / artifact / Queue readiness は、title keyword ではなく explicit metadata に基づくことを確認する。

### Phase 8: 検証

- [x] `pnpm test run tests/services.task-intake.test.ts`
- [x] `pnpm test run tests/routes.nightworkers-workbench.test.ts`
- [x] `pnpm test run tests/nightworkers.workbench-selectors.test.ts`
- [x] `pnpm test run tests/services.conversation-context.test.ts tests/services.conversation-context-integration.test.ts`
- [x] `pnpm verify`
- [ ] 必要に応じて `pnpm verify:full`

## 完了条件

- `task-intake` に user text keyword / regex / fixed phrase による `taskType` 推定が残っていない。
- `hasImplementationPlanEvidence` が `metadata.title` の keyword に依存しない。
- `inferDocumentArtifactKind` が `metadata.title` の keyword に依存しない。
- conversation context の path 抽出が、実行判断ではなく補助 context であることがコードまたはテストで明確になっている。
- folder-first / Tauri entrypoint でも、自然文入力から runtime keyword path へ分岐する設計を追加していない。
- routing の説明責任が、schema-first `jobType` / `routingHypothesis` / explicit UI `intent` に集約されている。
- 関連テストと `pnpm verify` が通る。

## リスク

- 古い task message で `metadata.intent` が欠けている場合、plan evidence / artifact kind が以前より控えめに判定される。
- `task-intake` を将来再利用する予定がある場合、LLM generated plan を必須にするか、caller が explicit workflow/taskType を渡す設計へ寄せる必要がある。
- title fallback を消すことで、過去データの UI 表示が一部 `Spec` に戻る可能性がある。これは新規 runtime 判断の安全性を優先する。

## 修正後に残してよい regex

- schema ID/path validation
- command safety policy
- path safety policy
- secret redaction / secret detection
- Markdown / JSON fenced block extraction
- content parsing
- hook matcher

これらはユーザー文言から workflow / taskType / execution path を分類するものではないため、本計画の撤去対象外とする。
