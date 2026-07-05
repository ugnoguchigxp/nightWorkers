# Plan Mode Questionnaire Decision Layer リファクタリング計画

## 目的

Plan Mode の Questionnaire を、初回だけの固定成果物ではなく、Plan Mode 中いつでも追加判断を積める decision layer として扱う。

後続の Blueprint、Data Model、API Contract、Zod Schema、Flow、Feature Plan 生成中に見えた矛盾や不足を、LLM が勝手に丸めず、必要な場合だけ追加質問としてユーザーに確認できる状態にする。

ただし、質問を増やすこと自体を目的にしない。既存資料から合理的に決められる事項は質問せず、実装判断に影響する未決定だけを扱う。

## スコープ

対象:

- Plan Mode 中いつでも追加質問を生成できる backend endpoint / service。
- Questionnaire session / question set の metadata 拡張。
- 既存質問との重複防止。
- blocking / non-blocking の分類。
- Status / Plan Mode UI での追加質問 badge と回答導線。
- Feature Plan 生成前の blocking question gate。
- Questionnaire 生成 context の強化。
- focused tests と既存 Plan Mode 回帰確認。

非対象:

- Questionnaire 回答形式の全面刷新。
- 既存回答データの大規模 migration。
- Plan View generator 全体の再設計。
- Feature Plan 本文の大幅なフォーマット変更。
- 通知、メール、外部連携。
- すべての追加質問を必須化すること。

## 現状

- 初回 Questionnaire は Plan Mode の早い段階で生成される。
- 各 Plan View は Questionnaire 後に作られるため、後続資料で初めて見える矛盾や不足がある。
- 既存 follow-up は Questionnaire session の不足補完に寄っており、Plan Mode 全体の任意タイミングの追加判断キューとしては扱いづらい。
- Feature Plan 生成時は Questionnaire answers を参照できるが、未回答の重要論点を gate として扱う契約が弱い。
- Status には Questionnaire artifact が見えるが、追加質問の有無、blocking 状態、任意回答状態が分かりにくい。
- DB は `design_questionnaire_question_sets.questionnaire_json` に question set JSON を保存している。metadata 専用 column は無い。

## 採用判断

- DB migration は行わない。追加 metadata は `questionnaire_json` の schema 拡張で保存する。
- 既存 `follow-up` route は互換維持する。新しい任意追加は `additional` route として追加し、既存 route を破壊しない。
- Status UI に Questionnaire を複数カードとして増やさない。1 つの Questionnaire 領域に session / question set 状態を集約する。
- Feature Plan 生成前の gate は backend で強制する。frontend の warning は補助表示であり、source of truth にはしない。
- 追加質問が 0 件でも正常結果として扱う。UI は失敗ではなく「追加質問なし」を表示する。

## Target Behavior

### Questionnaire layer

Plan Mode では Questionnaire を 1 つの表示領域として扱い、その中に複数の question set を持たせる。

想定 source:

- `initial`
- `follow_up`
- `user_requested`
- `artifact_triggered`
- `pre_feature_plan_gate`

UI 上は Questionnaire を重複表示しない。

表示例:

- `回答済み 8`
- `未回答 2`
- `要回答 1`
- `追加質問あり`

### 追加質問生成

Plan Mode 中いつでも追加質問を生成できる。

入力 context:

- Task
- Target Project Context
- 既存 Questionnaire answers
- 未回答 Questionnaire
- Blueprint
- Data Model
- API Contract
- Zod Schema
- User / Activity / Sequence Flow
- Decision Review
- 既存 Feature Plan
- 直近の user prompt

生成結果:

- 0 件なら「追加質問なし」として記録できる。
- 1-5 件を基本上限にする。
- 実装判断に影響する質問だけを出す。
- 既存資料から合理的に決められる事項は質問しない。

### blocking / non-blocking

`blocking`:

- 回答なしに Feature Plan を作ると仕様が危険に曖昧になる。
- auth / permission、data ownership、migration、破壊的操作、外部連携、API / validation 矛盾などが該当する。
- Feature Plan 生成前に回答を促す。
- ユーザーが明示的に「未回答のまま進める」を選んだ場合だけ、assumption として扱う。

`non-blocking`:

- 回答すれば精度は上がるが、既存資料や project convention で安全に進められる。
- Feature Plan 生成を止めない。
- 未回答なら質問自体は採用しない。Feature Plan は既存資料から合理的に固定できる前提だけを使う。

## Data Contract

既存 DB schema を変えず、Questionnaire JSON schema を拡張する。

対象:

- `shared/schemas/design-questionnaire.schema.ts`
- `api/modules/questionnaire/questionnaire-parser.service.ts`
- `api/modules/questionnaire/questionnaire-validation.ts`

追加する schema:

```ts
type QuestionnaireDecisionKey = string; // /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

type QuestionnaireQuestionSetMetadata = {
  source:
    | 'initial'
    | 'follow_up'
    | 'user_requested'
    | 'artifact_triggered'
    | 'pre_feature_plan_gate';
  blocking: boolean;
  reason: string;
  generatedFromMessageIds: string[];
  decisionKeys: string[];
};
```

`DesignQuestionSet` に optional `metadata` を追加する。

```ts
type DesignQuestionSet = {
  id: string;
  title: string;
  category: string;
  purpose: string;
  metadata?: QuestionnaireQuestionSetMetadata;
  questions: DesignQuestion[];
};
```

`DesignQuestion` に optional field を追加する。

```ts
type DesignQuestion = {
  // existing fields
  decisionKey?: QuestionnaireDecisionKey;
  blocking?: boolean;
  blockingReason?: string;
};
```

`decisionKey` 例:

- `auth.scope.todo`
- `api.todo.status_update_contract`
- `data.todo.updated_at_strategy`
- `ui.todo.empty_state_behavior`

互換性:

- 既存 question set に metadata が無い場合は `source = initial`, `blocking = true`, `decisionKeys = []` 相当として helper 側で扱う。
- 既存 question に `decisionKey` が無い場合は `topic + outputSection + normalized question` から fallback key を作る。
- 既存回答の読み取りを壊さない。
- 追加 metadata が無くても UI は従来表示できる。
- DB migration は不要。`questionnaire_json` の JSON payload だけを拡張する。

## 重複防止

追加質問生成前に、既存の answered / unanswered questions から decision inventory を作る。

重複扱い:

- `decisionKey` が同じ。
- 既存未回答に同じ `decisionKey` がある。
- `topic + outputSection + normalized question` が近い。
- 選択肢集合が実質同じ。

動作:

- 回答済み decisionKey は再質問しない。
- 未回答の同じ decisionKey がある場合は新規作成せず、既存質問を再提示対象にする。
- LLM 出力に重複が含まれる場合は保存前に除去する。
- 全件重複なら「追加質問なし」として扱う。

## Baseline 採取

実装前に次を確認する。

```bash
bunx vitest run tests/services.design-questionnaire-prompts.test.ts tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts tests/specification-status-view.test.tsx tests/specification-document-generation.test.ts
```

期待結果:

- 既存 Questionnaire 作成、回答保存、review accept が通る。
- Status workspace が既存 Questionnaire session を集計できる。
- Feature Plan 生成が既存 session を参照できる。

実装前にコード上で確認する source of truth:

- question set 保存先は `design_questionnaire_question_sets.questionnaire_json`。
- answer 保存先は `design_questionnaire_answers.answer_json`。
- session view は `designQuestionnaireSessionSchema`。
- workspace summary は `planModeWorkspaceQuestionnaireSchema`。
- Feature Plan 生成入口は `generateFeaturePlanArtifact`。

失敗時は保存層、parser/schema、UI model の順で切り分ける。

## Backend 実装計画

### 1. Schema / parser 拡張

対象:

- `shared/schemas/design-questionnaire.schema.ts`
- `api/modules/questionnaire/questionnaire-parser.service.ts`
- `api/modules/questionnaire/questionnaire-validation.ts`

実装:

- question set metadata を追加する。
- question metadata に `decisionKey`, `blocking`, `source`, `reason` を追加できるようにする。
- legacy question は metadata 無しでも parse できる。
- normalized decision inventory helper を追加する。

完了条件:

- 既存 Questionnaire session がそのまま読める。
- 新規 question set は source / blocking / decisionKeys を保持できる。

### 2. 追加質問生成 service

対象:

- `api/modules/questionnaire/questionnaire.service.ts`
- `api/services/structured-generation/prompts/design-questionnaire.ts`
- `api/modules/questionnaire/questionnaire-additional.service.ts`

実装:

- `questionnaire-additional.service.ts` に `generateAdditionalDesignQuestionnaireQuestions(taskId, input)` を追加する。
- 対象 task に既存 Questionnaire session があれば、最新の non-abandoned session を使う。
- 既存 session が無い場合は、追加質問が 1 件以上残った時だけ新規 session を作成する。
- 最新 session が `accepted` の場合、追加質問保存後に status を `answering` に戻す。
- Plan Mode 全体 context を集める。
- answered / unanswered inventory を LLM prompt に渡す。
- LLM に 0-5 件の追加質問だけを返させる。
- 保存前に重複除去する。
- 追加質問が 0 件なら question set は作成しない。既存 session が無い場合は session も作成しない。
- question set を保存する場合、`sequence` は対象 session の既存最大 sequence + 1 にする。
- 保存成功前に session status を進めない。
- LLM / parse 失敗時は mutation しない。既存 session に invalid question set を追加しない。

入力:

```ts
type GenerateAdditionalQuestionsInput = {
  source: 'user_requested' | 'artifact_triggered' | 'pre_feature_plan_gate';
  reason?: string;
  maxQuestions?: number; // default 5
};
```

出力:

```ts
type GenerateAdditionalQuestionsResult = {
  sessionId: string | null;
  createdQuestionSetId: string | null;
  addedCount: number;
  skippedDuplicateCount: number;
  blockingCount: number;
  nonBlockingCount: number;
};
```

完了条件:

- Plan Mode 中いつでも追加質問生成を呼べる。
- 同じ context で連打しても重複 question set が増えない。
- blocking / non-blocking が保存される。
- 既存 session が無い task でも、追加質問が 1 件以上あれば user requested 追加確認から session が作成される。

追加質問用 structured output:

既存 `questionnaireChoiceFormSchema` は metadata を持てないため、追加質問生成には専用 schema を使う。

```ts
type AdditionalQuestionnaireDraft = {
  title: string;
  rationale: string;
  questions: Array<{
    decisionKey: string;
    text: string;
    type: 'radio' | 'checkbox';
    options: string[];
    blocking: boolean;
    reason: string;
  }>;
};
```

保存時に既存 `DesignQuestionnaire` 形式へ変換する。

- `text` は `question` へ変換する。
- `type=radio` は `answerType=single_choice`。
- `type=checkbox` は `answerType=multi_choice`。
- option id は既存 parser と同じ kebab normalize を使う。
- `decisionKey`, `blocking`, `reason` は question metadata と question set metadata に保存する。
- `blocks` は `reason` を 1 件入れる。`reason` が空の場合だけ `decisionKey` を入れる。
- `outputSection` は decisionKey の prefix から `auth`, `api`, `data`, `ui`, `scope`, `verification` のいずれかへ寄せる。判定できない場合は `implementation`。

### 3. API route

対象:

- `api/modules/questionnaire/questionnaire-route-definitions.ts`
- `api/modules/questionnaire/questionnaire.routes.ts`

追加 route:

```http
POST /api/tasks/:id/design-questionnaire/additional
```

request:

```json
{
  "source": "user_requested",
  "reason": "追加で確認",
  "maxQuestions": 5
}
```

response:

```json
{
  "session": "...designQuestionnaireSessionSchema or null...",
  "result": {
    "sessionId": "... or null",
    "createdQuestionSetId": "...",
    "addedCount": 2,
    "skippedDuplicateCount": 1,
    "blockingCount": 1,
    "nonBlockingCount": 1
  }
}
```

error:

- `409 PLAN_MODE_READ_ONLY`: terminal task では追加できない。
- capability disabled error: 既存 `assertPlanModeCapabilityEnabled('questionnaire')` に従う。
- `404 TASK_NOT_FOUND`: task が無い。
- LLM / parse 失敗: 500 系 error を返し、question set は保存しない。

完了条件:

- 既存 session が無く、追加質問が 1 件以上ある場合は新規 session を作り、source を `user_requested` にする。
- 既存 session が無く、追加質問が 0 件の場合は `session: null`, `sessionId: null`, `addedCount: 0` を返す。
- 既存 session が `abandoned` だけの場合は新規 session を作る。
- 既存 session が `accepted` の場合は、追加質問保存後に `answering` へ戻す。
- task が terminal status の場合は既存 Plan Mode mutable guard と同じ 409 を返す。
- capability `questionnaire` が disabled の場合は既存 capability guard と同じ error を返す。
- LLM が 0 件を返した場合も 200 を返す。

### 4. Feature Plan preflight gate

対象:

- `api/modules/specification/specification-generation.service.ts`
- `api/modules/specification/specification-route-definitions.ts`
- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`

実装:

- Feature Plan 生成前に unanswered blocking questions を確認する。
- unanswered blocking がある場合、通常は 409 を返す。
- request に `proceedWithUnansweredBlocking: true` がある場合だけ続行できる。
- 続行時は Feature Plan context に `Unanswered Blocking Assumptions` として渡す。
- `proceedWithUnansweredBlocking` は route request schema に optional boolean として追加する。
- assumption は「質問文」「decisionKey」「未回答のまま進めた事実」だけを短く渡し、LLM に勝手な回答を作らせない。

response 例:

```json
{
  "error": "BLOCKING_QUESTIONNAIRE_ANSWERS_REQUIRED",
  "blockingQuestions": [
    {
      "id": "q-auth-scope",
      "decisionKey": "auth.scope.todo",
      "question": "/todo を public / protected のどちらに置きますか？"
    }
  ]
}
```

完了条件:

- blocking 未回答がある場合、Feature Plan は黙って生成されない。
- ユーザーが明示的に続行した場合だけ assumption として残る。
- non-blocking 未回答は Feature Plan 生成を止めない。
- 既存 `questionnaireSessionId` 指定がある場合は、その session の blocking 未回答を優先して判定する。未指定の場合は最新 session を使う。

## Frontend 実装計画

### 1. Questionnaire Status 表示

対象:

- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/planMode/PlanModeQuestionnaire.tsx`
- `src/modules/planMode/PlanModeWorkspacePanels.tsx`
- `src/modules/specification/planModeWorkspaceModel.ts`

workspace model に追加する集計:

```ts
type PlanModeWorkspaceQuestionnaire = {
  // existing fields
  answeredCount: number;
  totalQuestionCount: number;
  unansweredCount: number;
  blockingUnansweredCount: number;
  nonBlockingUnansweredCount: number;
  latestAdditionalQuestionSetId?: string;
};
```

表示:

- Questionnaire は Status 内で 1 領域にまとめる。
- `回答済み`, `未回答`, `要回答`, `任意` の counts を表示する。
- blocking 未回答がある場合は `要回答` badge。
- non-blocking のみなら `追加質問あり` badge。
- 追加質問が無い場合は既存表示を維持し、余計な badge は出さない。

操作:

- `追加確認` button を追加する。
- 追加質問生成中は loading。
- 0 件なら「追加質問はありません」を短く表示する。
- 追加質問がある場合は既存 Questionnaire 回答 UI に追加 set として表示する。
- 追加質問生成後は workspace を再取得し、Status counts と回答 UI を同期する。
- 既存 `QuestionnaireForm` の group 表示を使い、追加 question set を別 section として表示する。

### 2. Feature Plan button preflight

対象:

- `src/modules/planMode/PlanModeWorkspaceViewer.tsx`
- `src/modules/planMode/planViewCommands.ts`

動作:

- blocking 未回答がある場合、Feature Plan 生成 button 近くに warning を出す。
- クリック時に回答画面へ誘導する。
- `未回答のまま進める` は明示 confirm を挟む。
- non-blocking 未回答では生成を止めず、badge だけ出す。
- backend 409 を受けた場合は blockingQuestions を表示し、回答 UI への導線を出す。
- confirm 後は `proceedWithUnansweredBlocking: true` を付けて再実行する。

## Prompt 方針

追加質問 prompt は短く、次の契約を守る。

- 既存回答と同じ decisionKey は出さない。
- 未回答の同 decisionKey がある場合は新規生成しない。
- 既存資料から合理的に決められることは質問しない。
- 実装判断に影響しない好み質問は出さない。
- auth / permission は public / protected / auth / admin の混在や配置不明がある場合だけ聞く。
- 質問は radio / checkbox のみ。
- 追加質問は最大 5 件。
- 質問不要なら空配列を返す。

## 検証計画

Focused backend:

```bash
bunx vitest run tests/services.design-questionnaire-prompts.test.ts tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts
```

追加ケース:

- 追加質問生成 route が question set を追加する。
- 回答済み decisionKey は再質問されない。
- 未回答の同 decisionKey がある場合、新規 question は追加されない。
- blocking / non-blocking counts が response に出る。
- 追加質問 0 件の結果を扱える。

Focused frontend:

```bash
bunx vitest run tests/specification-status-view.test.tsx tests/artifact-workspace-viewer.test.ts
```

追加ケース:

- Questionnaire Status に `要回答` badge が出る。
- non-blocking のみなら `追加質問あり` badge が出る。
- `追加確認` button が route command を呼ぶ。
- 0 件結果で UI が壊れない。

Feature Plan gate:

```bash
bunx vitest run tests/specification-document-generation.test.ts tests/specification-generation-timeout.test.ts
```

追加ケース:

- blocking 未回答があると Feature Plan 生成が 409 になる。
- `proceedWithUnansweredBlocking` で明示続行できる。
- non-blocking 未回答では止まらない。
- 明示続行時の assumption が Feature Plan context に入る。

Full related regression:

```bash
bun run typecheck
bun run test run tests/services.design-questionnaire-prompts.test.ts tests/nightworkers-routes/routes-nightworkers-03-part01.test.ts tests/specification-status-view.test.tsx tests/artifact-workspace-viewer.test.ts tests/specification-document-generation.test.ts tests/specification-generation-timeout.test.ts
```

## 完了条件

- Plan Mode 中いつでも追加質問を生成できる。
- Questionnaire は Status 上で 1 領域にまとまり、追加質問の状態が badge で分かる。
- 回答済み / 未回答の decisionKey が重複質問を防ぐ。
- blocking 未回答は Feature Plan 生成前に検知される。
- non-blocking 未回答は Feature Plan 生成を止めない。
- ユーザーが明示続行した blocking 未回答は assumption として Feature Plan に渡る。
- 既存 Questionnaire session と回答が壊れない。
- focused tests と typecheck が通る。

## 実装順序

1. Schema / parser に metadata と decisionKey の互換対応を追加する。
2. Decision inventory helper と重複判定を追加する。
3. 追加質問生成 prompt / service を実装する。
4. 追加質問生成 route を追加する。
5. Workspace model に unanswered / blocking counts を出す。
6. Status UI に badge と `追加確認` button を追加する。
7. Feature Plan preflight gate を追加する。
8. Focused tests を追加し、typecheck と関連 regression を通す。

## リスクと対策

- 質問が増えすぎる: 最大 5 件、重複除去、質問不要時の空結果で抑える。
- 既存 session 互換を壊す: metadata optional と legacy fallback を必須にする。
- blocking が強すぎて作業が止まる: 明示的な `未回答のまま進める` を用意する。
- UI が Questionnaire を重複表示する: Status は 1 領域に集約し、question set を内部表示にする。
- LLM が同じ質問を言い換える: decisionKey と normalized fallback の両方で保存前に除去する。

## 追加改善案: Feature Plan 生成品質の強化

この章は初回リファクタリング時点では実装済み範囲に含めない追加候補だった。2026-07-05 の追加実装で、追加 Questionnaire の仕組みを前提に、Feature Plan がより短く、契約に強く、未決事項の少ない設計書になるための改善として実装対象に含めた。

### 1. 検証コマンドの実在確認

対象:

- `api/modules/specification/specification-generation.service.ts`
- `api/modules/planViews/planView-generation.service.ts`
- Target Project Context 収集処理

改善:

- Feature Plan に検証コマンドを書く前に、対象 project の `package.json` scripts を context として渡す。
- 存在しない `verify:e2e` などの script 名を推測で出さない。
- focused unit command は、追加予定 test file がある場合だけ具体名を出す。判断できない場合は blocking ではなく、`project scripts に存在する最小検証` へ寄せる。

期待する変化:

- 検証計画に実行不能な command が混ざらない。
- `追加した unit test 実行コマンド` のような空見出しを出さない。

完了条件:

- script が存在する場合だけ Feature Plan に command が出る。
- script が存在しない場合は、存在する代替 command か、追加確認対象として扱われる。

### 2. API Contract / Zod Schema の shape 反映

対象:

- `api/services/structured-generation/prompts/plan-api-contract.ts`
- `api/services/structured-generation/prompts/plan-zod-schema.ts`
- `api/modules/specification/specification-document-renderer.ts`

改善:

- Feature Plan には型名だけでなく、request / response / error の最小 JSON shape を反映する。
- Zod Schema がある場合は、必須 field、optional field、enum、validation error shape を要約する。
- 詳細すぎる schema 全文は貼らず、実装者が迷う項目だけを短く残す。

期待する変化:

- `TodoItemResponse` のような型名だけで終わらない。
- API handler と UI 実装者が同じ入出力契約を参照できる。

完了条件:

- API Contract / Zod Schema が存在する plan では、Feature Plan の API 章に JSON shape が含まれる。
- schema が無い場合は推測で shape を作らず、既存資料か追加質問で補う。

### 3. Auth / permission 判断根拠の明示

対象:

- Questionnaire prompt
- Feature Plan prompt
- Plan Mode Context builder

改善:

- public / protected / auth / admin が混在する project では、配置と権限が不明な場合に追加質問へ回す。
- Blueprint や Questionnaire で判断済みの場合は、Feature Plan に `auth decision` として根拠を1行で書く。
- 混在していない project では不要な auth 質問を出さない。

期待する変化:

- `protected 前提` のような結論だけでなく、なぜそう判断したかが分かる。
- auth only project では質問が増えず、混在 project では判断漏れが減る。

完了条件:

- auth / permission が仕様に影響する場合、回答済み decision または project convention の根拠が Feature Plan に残る。
- 根拠が無いまま危険に固定される場合は blocking 追加質問になる。

### 4. 曖昧な API / DB 契約の追加質問化

対象:

- Additional Questionnaire generator
- Feature Plan preflight gate
- Feature Plan prompt

改善:

- `空または削除結果`, `現在の status または切替指示`, `作成順` のような曖昧表現を検出する。
- 実装 convention から決められる場合は具体化する。
- 決められない場合は、DELETE response、toggle semantics、id generation、sort direction、migration strategy などを追加質問にする。

期待する変化:

- 実装者が endpoint や DB 挙動をその場で決める必要が減る。
- Feature Plan の contract が実装可能な単一解になる。

完了条件:

- Feature Plan の API / DB 契約に `A または B` 型の未決表現が残らない。
- 残す場合は明示的な assumption として扱う。

### 5. Blueprint 由来の UI 再現情報の短縮反映

対象:

- Blueprint summary builder
- Feature Plan prompt
- Specification renderer

改善:

- 採用 section 名だけでなく、画面再現に必要な構造を短く渡す。
- table なら列、行操作、empty/loading/error の表示位置を要約する。
- form なら配置、作成/編集の切替、validation 表示位置を要約する。
- 装飾説明や marketing copy は増やさない。

期待する変化:

- `Top Navigation / DataTable / Form` の列挙だけで終わらない。
- 実装者が Blueprint の見た目と操作構造を再現しやすくなる。

完了条件:

- Feature Plan の UI 章に、採用 section と主要 interaction の再現情報が短く含まれる。
- Blueprint に無い UI 要素を推測で追加しない。

### 6. Traceability の本文圧縮

対象:

- Feature Plan renderer
- Specification prompt

改善:

- Questionnaire / Blueprint / Data Model / API Contract / Zod Schema は生成 context として必ず使う。
- 最終 Feature Plan には ID 羅列を原則出さず、採用判断として本文に反映する。
- 監査用途の ID は必要な場合だけ metadata 側に残す。

期待する変化:

- 設計書本文が実装者向けの判断と契約に集中する。
- 参照 ID が増えても token を消費しない。

完了条件:

- Feature Plan 本文に不要な traceability ID 羅列が出ない。
- 参照資料の内容は、scope / contract / validation / verification の判断として反映される。

## 追加改善案の非対象

- Feature Plan の長文化。
- 全 artifact ID の本文表示。
- API / Zod Schema 全文の貼り付け。
- auth 質問の常時必須化。
- Blueprint に無い UI の創作。
- 対象 project に存在しない検証 command の推測生成。

## Archive 判定

2026-07-05 時点で、本体リファクタリングと追加改善案は実装・レビュー済み。

確認済み:

- 追加質問 route / service は、既存 session が無い場合の session 作成、重複抑止、blocking / non-blocking counts を扱える。
- Feature Plan preflight gate は unanswered blocking を 409 で止め、明示続行時だけ assumption として進める。
- non-blocking 未回答は Feature Plan 生成を止めない。
- Status / Questionnaire UI は、既存追加質問の有無に関係なく `追加確認` を実行できる。
- Feature Plan 生成 context は package scripts、API / Zod JSON shape、Blueprint interaction/state、圧縮 Traceability を反映する。
- focused regression と `bun run verify` を通して archive 可能。

残作業:

- なし。
