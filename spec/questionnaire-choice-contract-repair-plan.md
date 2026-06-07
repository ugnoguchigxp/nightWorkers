# Questionnaire Choice Contract and JSON Repair Plan

## 1. 目的
Questionnaire 初版を、ユーザーが Radio button / Checkbox を選ぶだけのフォームに縮小する。

LLM の責務は「実装前に確認したい論点を、複数選択肢つきの質問に圧縮すること」だけに限定する。質問の意味分類、DB Design handoff、Decision Review、分岐条件、自由記述、推奨理由、トレードオフは初版の Questionnaire JSON から外す。

また、LLM はこの程度の JSON でも typo、コードフェンス混入、末尾欠落、余計な説明文を出す可能性があるため、Zod schema validation の前に JSON repair / extraction を必ず通す。

## 2. 現状確認
### Questionnaire
現行 Questionnaire は `shared/schemas/design-questionnaire.schema.ts` で、`questionSets -> questions -> options / dependsOn`、`openQuestions`、`dbDesignHandoffNotes`、`DecisionReview` まで持つ。初回導入時点から Zod schema は重く、その後 Plan mode intake 対応で `sourceKind` と nullable source が追加され、生成プロンプトと JSON Schema もより厳格化された。

現行の問題は、LLM が質問生成だけでなく、以下まで同時に出す必要があること。

- `source` の task / repository / blueprint 関連 ID。
- `questionSets` の id / title / category / purpose。
- `question` の id / topic / why / answerType / blocks / outputSection。
- `option` の id / label / tradeoff / recommended。
- `dependsOn` の相互参照。
- `openQuestions`。
- `dbDesignHandoffNotes`。

これは初版のユーザー体験「選択肢から選ぶ」には過剰。

### 既存 JSON repair
`api/services/supervisor/llm-provider/json.ts` に `jsonFixWrapper` が存在する。

現在できること:

- raw JSON の直接 parse。
- markdown code fence から JSON 候補を抽出。
- raw text 内の `{ ... }` 候補を抽出。
- 末尾の `}` / `]` / string quote が欠けた JSON の balance。
- repair 済みの場合に `model.response_repaired` event を出せる。

ただし Blueprint / DB Design は `callStructuredJsonLLM` 後に、各 service 内で再度 `extractJsonCandidate + JSON.parse` を実行している。共通 repair 済み `sourceText` を返しているとはいえ、parse/validate 層が分散しており、repair の責務が分かりにくい。

## 3. 初版の Questionnaire 契約
Zod schema を source of truth にする。手書き JSON Schema は使わない。

```ts
import { z } from 'zod';

export const questionnaireChoiceQuestionSchema = z.object({
  text: z.string().min(1),
  type: z.enum(['radio', 'checkbox']),
  options: z.array(z.string().min(1)).min(2).max(6),
});

export const questionnaireChoiceFormSchema = z.object({
  title: z.string().min(1).default('実装前に決めたいこと'),
  questions: z.array(questionnaireChoiceQuestionSchema).min(1).max(10),
});
```

LLM へ渡す JSON Schema は必ず `z.toJSONSchema(questionnaireChoiceFormSchema)` から生成する。

LLM の出力例:

```json
{
  "title": "実装前に決めたいこと",
  "questions": [
    {
      "text": "最初のリリース範囲はどれにしますか？",
      "type": "radio",
      "options": ["最小CRUDのみ", "一覧・詳細・編集まで", "通知や履歴も含める"]
    },
    {
      "text": "必要なユーザー権限を選んでください",
      "type": "checkbox",
      "options": ["管理者", "編集者", "閲覧者", "ゲスト"]
    }
  ]
}
```

### 明示的に削るもの
- LLM 生成 JSON 内の `id`。
- `source`。
- `group` / `category` / `purpose`。
- `why`。
- `recommended` / `tradeoff`。
- `blocks` / `outputSection`。
- `dependsOn`。
- `openQuestions`。
- `dbDesignHandoffNotes`。
- `free_text` / `boolean` / `ranked`。
- question set の入れ子。

## 4. サーバ側補完
LLM JSON は保存・UI 表示用の内部形式に変換する。

サーバ側で補完するもの:

- `question.id`: `q1`, `q2`, ...
- `option.id`: `q1-o1`, `q1-o2`, ...
- `source`: `taskId`, `repositoryId`, `sourceKind`, `sourceBlueprintMessageId`。
- session status。
- answered count / total count。

初版では現行 v1 `DesignQuestionnaire` へ adapter 変換して UI 互換を保つ案と、UI を choice form 専用に切る案がある。

推奨は段階的に進めること。

1. `QuestionnaireChoiceForm` Zod schema を追加。
2. `QuestionnaireChoiceForm -> DesignQuestionnaire v1` adapter を追加。
3. 既存 DB table と既存 UI に接続し、破壊的 migration を避ける。
4. 安定後に UI / type / persistence を choice form 専用へ縮小するか判断する。

## 5. JSON repair 計画
### 共通関数
`api/services/supervisor/llm-provider/json.ts` の `jsonFixWrapper` を、LLM structured output の共通 repair 関数として明示的に使う。

追加する関数案:

```ts
export function parseRepairedJsonWithSchema<T>(
  raw: string,
  schema: z.ZodType<T>
): {
  ok: true;
  value: T;
  sourceText: string;
  repaired: boolean;
  repairKind: JsonFixWrapperResult['repairKind'];
} | {
  ok: false;
  error: unknown;
  rawOutput: string;
};
```

責務:

1. `jsonFixWrapper(raw)` を実行。
2. repair できなければ失敗。
3. `schema.safeParse(jsonFix.parsedJson)` を実行。
4. 成功時は normalized value と repair metadata を返す。
5. 失敗時は raw output を保持して失敗。

この関数は provider 側ではなく、LLM structured output を domain schema に変換する境界に置く。provider は provider call / JSON extraction / schema-first debug event に集中させ、domain normalization は service 側で扱う。

### Questionnaire への適用
`parseDesignQuestionnaireRaw` を次の順に変更する。

1. `parseRepairedJsonWithSchema(rawOutput, questionnaireChoiceFormSchema)` を試す。
2. 成功したら `QuestionnaireChoiceForm -> DesignQuestionnaire v1` に変換する。
3. 互換のため、既存 v1 schema parse を次に試す。
4. 既存 legacy flat normalizer は最後に試す。
5. どれも失敗した場合だけ `validationStatus: invalid` として raw output を保存する。

これにより mini 系モデルが `title` typo や末尾欠落を起こしても、repair 可能な JSON は保存可能になる。

### Blueprint / DB Design への適用
今後つける対象:

- `api/services/blueprints/llm-draft.ts`
- `api/services/blueprints/data-design.ts`

計画:

1. 各 file の local `extractJsonCandidate + JSON.parse` を共通 repair 関数へ寄せる。
2. `parseRepairedJsonWithSchema(rawOutput, appBlueprintSchema)` を使う。
3. その後に既存 `validateAppBlueprint` を実行する。
4. repair された場合は `generation` diagnostics に `jsonRepair` を残す。
5. `model.response_repaired` event は `callStructuredJsonLLM` 側で既に出るが、domain parse 側でも diagnostics を保存する。

Blueprint 通常生成では、引き続き `databaseSchema: {tables: [], relations: []}` と `dataBindings: []` を守る。DB Design workflow だけが `databaseSchema` / `dataBindings` を具体化する。

## 6. Prompt 計画
Questionnaire prompt は短くする。

```text
あなたは実装前の確認フォームを作ります。
ユーザーが Radio button または Checkbox で選べる質問だけを作ってください。
自由記述、説明文、DB設計、分岐条件、id は作らないでください。
質問は 3-8 件、各 options は 2-6 件。
type は単一選択なら radio、複数選択が自然なら checkbox。
JSON root は {title, questions} のみ。
```

入力は次に限定する。

- latest user prompt または source Blueprint summary。
- task / repository ID は LLM に出力させない。
- 現行 v1 の session / answers は follow-up 以外では渡さない。

## 7. UI 計画
初版 UI は choice form 専用。

- `radio`: 1 option を選ぶ。
- `checkbox`: 複数 option を選ぶ。
- `Later` は残してよいが、Questionnaire JSON には含めない。
- Free text textarea は初版では出さない。
- `Blocks` 表示は削る。
- 推奨 badge / tradeoff 表示は削る。

回答保存 JSON は既存互換を優先するなら以下に写像する。

- `radio`: `selectedOptionIds: [optionId]`
- `checkbox`: `selectedOptionIds: optionIds`
- `deferred`: UI 側の Later checkbox
- `freeText`, `rankedOptionIds`, `booleanValue`: 空または未使用

## 8. テスト計画
### Unit
- `jsonFixWrapper` が fenced JSON を抽出する。
- `jsonFixWrapper` が末尾欠落 object / array を補完する。
- `parseRepairedJsonWithSchema` が repair 後に Zod schema で成功する。
- schema validation 失敗時は raw output を捨てない。

### Questionnaire route
- valid choice form JSON から session が `answering` になる。
- fenced choice form JSON から session が `answering` になる。
- 末尾欠落 choice form JSON が repair される。
- `radio` / `checkbox` の回答が保存される。
- plain text は `needs_edit` になり raw output が残る。
- 既存 v1 Questionnaire output は後方互換で保存できる。

### Blueprint / DB Design
- Blueprint raw output の fenced JSON を共通 repair 経由で parse できる。
- DB Design raw output の fenced JSON を共通 repair 経由で parse できる。
- repair 後も `validateAppBlueprint` が失敗すれば generation error になる。
- 通常 Blueprint は `databaseSchema` / `dataBindings` が空である。
- DB Design は `databaseSchema` / `dataBindings` の整合 validation を通る。

## 9. 実装順
1. `QuestionnaireChoiceForm` Zod schema を追加する。
2. `parseRepairedJsonWithSchema` を共通 JSON utility として追加する。
3. Questionnaire 生成 schema を `z.toJSONSchema(questionnaireChoiceFormSchema)` に変更する。
4. choice form adapter を追加し、既存 v1 session 保存へ接続する。
5. Questionnaire UI を Radio / Checkbox 中心へ縮小する。
6. Questionnaire tests を追加・更新する。
7. Blueprint / DB Design の local parse を共通 repair 関数へ寄せる。
8. Blueprint / DB Design tests を追加・更新する。
9. `pnpm verify` または該当 Vitest を実行する。

## 10. 非目標
- Questionnaire 初版で自由記述を扱うこと。
- options ごとの意味タグ、推奨理由、トレードオフを持たせること。
- DB handoff を Questionnaire 生成時に作ること。
- Decision Review を Questionnaire JSON に混ぜること。
- Blueprint / DB Design の schema 自体を広げること。
- provider 側に domain-specific な正規化を入れること。

