# API Contract and Verification Quality 改修実装計画

## 0. 文書情報

- 状態: Proposed
- 作成日: 2026-08-16
- 対象リポジトリ: `nightWorkers`
- 対象指摘: `M11`, `m3`, `m4`
- 関連する非改修判定: `m2`
- 位置づけ: [改修プログラム索引](./codebase-review-remediation-program-index.md)の API・検証品質作業領域
- 実装開始条件: 最新 HEAD で排他的に baseline を再計測し、既存品質計画の完了事項と差分を確定すること

## 1. 目的

API error contract の揺れを収束させ、coverage gate と UI test が「実行した」という事実だけでなく、実際の失敗分岐と利用者挙動を検証する状態にする。

この領域で扱う指摘は次のとおり。

- `M11`: critical coverage gate の branch coverage 不足が観測された。ただし既存の品質計画では後続改善が完了扱いのため、最新 HEAD の再計測なしに追加修正を開始しない。
- `m3`: global error、route 固有 error、Coding Agent command response で error shape が異なり、consumer に個別分岐が生じる。
- `m4`: 一部の Frontend test が module mock と存在確認に偏り、利用者挙動や失敗分岐を十分に固定していない。

`m2` の 600 行超 file 数と巨大 file の存在自体は事実だが、それが critical coverage failure の原因だという因果は裏づけられなかった。そのため本計画では file-size 制限を緩めず、分割を数値目標にも設定しない。

## 2. 非目標

- coverage threshold を下げて gate を通さない。
- branch 計測を無効化しない。
- test 対象 file を除外して数値だけを改善しない。
- Coding Agent の command protocol を一般 REST error envelope に押し込まない。
- すべての既存 test mock を削除しない。
- 600 行制限を緩和しない。
- file 分割だけを目的とした大規模 refactor をしない。

## 3. 現状認識と baseline の扱い

前回評価時には、coverage 対象 133 file、約 60,461 行、全体約 167,585 行という規模と、一部 critical target の branch gate failure が観測された。一方、既存の `quality-and-tauri-distribution-readiness-implementation-plan.md` は coverage 改善項目を完了扱いとしている。

したがって、上記の数値・失敗対象は実装 backlog ではなく履歴的観測として扱う。最新 baseline は、同一 commit、同一 dependency 状態、並行 coverage process なしで再生成した結果だけを正本にする。

また、global handler の nested error、route utility の flat error、Coding Agent command の typed success/failure は責務が異なる。最初の二つは一般 REST error として統合候補だが、command response は role 固有 protocol として分離を維持する。

## 4. 目標不変条件

1. 一般 REST endpoint の error response は、共有 schema と serializer から生成する。
2. error payload は安定した machine-readable `code` と利用者/開発者向け `message` を持ち、任意の `details` を明示 schema で表す。
3. HTTP status と error code の対応を route ごとに独自解釈しない。
4. Coding Agent command protocol の typed failure は一般 REST envelope と混同しない。
5. Frontend は共有 decoder を使い、response status を成功判定に含める。
6. coverage report と gate 判定は同じ commit・同じ run の artifact を使う。
7. coverage 未計測・対象欠落は成功ではなく明示 failure とする。
8. critical UI test は少なくとも success、loading、error、主要 action、状態遷移を DOM/interaction で検証する。
9. file size は原因を特定するための signal であり、coverage failure の代理指標にしない。

## 5. 所有境界

- 一般 REST error schema、serializer、OpenAPI schema は agent role から独立した API 共通層が所有する。
- route は domain error を共通 error code/status へ写像するが、固定 message で provider/LLM 本文を上書きしない。
- Coding Agent command response schema は Coding Agent role module が所有し、一般 REST helper から再 export しない。
- coverage generation、critical target gate、test quality check は既存の quality tooling 所有境界に置く。
- Frontend の表示 state と Query 移行は [Frontend Server State and UX 改修実装計画](./frontend-server-state-and-ux-implementation-plan.md)が所有する。

## 6. 実装フェーズ

### E0. 排他的 baseline 再計測

対象: `M11`, `m4`

1. 作業開始時の commit、`git status --short`、runtime/dependency version を記録する。
2. coverage process が並行実行されていないことを確認し、run 固有 output directory または既存の排他制御を使用する。
3. full coverage を一度だけ生成し、その artifact に対して critical gate を実行する。
4. 対象 file 欠落、source map 不整合、stale artifact を数値不足と区別して記録する。
5. UI test inventory を作り、module mock 数ではなく assertion の種類、user interaction、error branch、async state transition の有無を分類する。

候補 command は package script を再確認してから確定する。

```bash
git rev-parse HEAD
git status --short
bun run test:coverage
bun run test:coverage:critical
rg -n "vi\.mock|jest\.mock|toBeTruthy\(|toBeDefined\(" tests src --glob "*.test.*" --glob "*.spec.*"
```

完了条件:

- coverage generation と gate の run identity が一致する。
- 最新 gate が全件 pass なら `M11` の追加 test 実装は行わず、再計測 evidence のみで close する。
- failure がある場合だけ、file、metric、閾値、未達 branch を backlog 化する。

### E1. 一般 REST error contract の確定

対象: `m3`

候補正本は次の形とし、既存 `AppError`、global handler、OpenAPI helper、consumer を調査して採用可否を決める。

```ts
type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
```

実装手順:

1. 現行 error response を route/module/status/code 単位で inventory 化する。
2. 認証、validation、not found、conflict、rate limit、internal error の code/status 対応表を作る。
3. schema、serializer、OpenAPI response definition を共通化する。
4. typed domain error から envelope への変換は API boundary で行う。
5. unknown error は内部情報を漏らさず correlation/request id と server log で追跡可能にする。
6. LLM/provider が返した本文を保持すべき typed failure は、既存プロジェクト規則どおり固定文へ差し替えない。

完了条件:

- 新規一般 REST route が共通 schema/helper 以外の error shape を追加できない architecture/test guard がある。
- OpenAPI と runtime payload の schema test が一致する。

### E2. Route と consumer の段階移行

対象: `m3`

1. global handler と高共有 route utility から共通 serializer へ移す。
2. module 単位で route response schema、runtime response、route test を同じ change set で更新する。
3. Frontend API client に一つの decoder を置く。移行期間中は既知の旧 flat shape を限定的に受理し、unknown shape を generic success と解釈しない。
4. 全一般 REST route の移行後に legacy decode branch と旧 helper を削除する。
5. Coding Agent command response は別 contract であることを schema/test 名で明示する。

移行順:

1. 認証・共通 middleware
2. Project/Repository/Settings の共有頻度が高い endpoint
3. Task/Run/Queue endpoint
4. Evaluation/Security/Quality/Git Worktree endpoint
5. 低頻度・internal endpoint

完了条件:

- route ごとの flat/nested 判定が consumer から消える。
- legacy decoder 削除後も全 API integration test が通る。
- command protocol の typed failure が維持される。

### E3. Critical coverage gap の限定補強

対象: `M11`

E0 で未達が再現した場合にだけ実施する。

1. report から未実行 branch を行番号まで特定する。
2. branch を error taxonomy、lifecycle、race、cleanup、provider failure などの意味単位で分類する。
3. private function の行通過だけを狙わず、公開境界または適切な module boundary から failure behavior を固定する。
4. unreachable defensive branch なら schema/type/構造不変条件で到達不能かを確認し、除外 directive を使う場合は個別根拠を残す。
5. 対象 test、critical gate、full coverage の順で再検証する。

既存品質計画で既に全 critical target が閾値を満たしている場合、この phase は `変更不要` として evidence を残す。

### E4. UI test を利用者挙動中心へ強化

対象: `m4`

優先対象は Frontend 計画で変更する Settings、TaskConsole、Repositories、Project Evaluation とする。

各対象で少なくとも次を検証する。

- 初回 loading と成功描画。
- API error の表示と retry。
- 利用者 action による mutation と成功後の画面/cache 更新。
- terminal/empty/disabled など主要分岐。
- 遅延 response、二重 click、再描画のうち当該画面で現実的な競合。

方針:

1. network/API boundary は mock してよいが、対象 component 自体と主要 child を全置換しない。
2. `toBeTruthy()` だけでなく、role、name、text、disabled/busy state、callback/request payload を具体的に検証する。
3. implementation detail の hook 呼出し回数より、利用者に見える結果と公開 request contract を優先する。
4. 既存 test は、新しい behavior test が同じ回帰を覆うことを確認してから重複分だけ整理する。
5. coverage 数値のためだけに無意味な click/assertion を追加しない。

完了条件:

- 優先対象画面ごとに success/error/action の behavior test がある。
- module 全 mock + 存在確認だけの test が critical behavior の唯一の防波堤ではない。

### E5. `m2` の非改修判定を guard する

対象: `m2`（実装対象外）

1. 既存の file-size architecture check と 600 行制限を維持する。
2. E0/E3 で coverage failure が再現しても、file size との因果を branch evidence なしに仮定しない。
3. 巨大 file が実際に test seam を妨げている場合のみ、責務境界に沿った分割を当該領域の計画へ追加する。
4. 行数を減らすための機械的な wrapper/file 移動は実施しない。

## 7. 領域間依存

- [Frontend Server State and UX](./frontend-server-state-and-ux-implementation-plan.md): E1/E2 の decoder を利用し、E4 の behavior test 対象を提供する。
- [Run and Queue State Integrity](./run-queue-state-integrity-implementation-plan.md): lifecycle/race branch が critical target の場合、状態不変条件を E3 の expected behavior に使う。
- [Agent Runtime Boundary and LLM Reliability](./agent-runtime-boundary-and-llm-reliability-implementation-plan.md): provider/command failure 本文保持と typed failure の境界を共有する。
- [Execution Security and Resource Safety](./execution-security-and-resource-safety-implementation-plan.md): security rejection の code/status と secret 非露出を API contract test で固定する。

## 8. 検証計画

### 8.1 API contract

```bash
bun run typecheck
node scripts/run-vitest.mjs run \
  tests/server-extra-coverage.test.ts \
  tests/routes.settings-general.test.ts \
  tests/nightworkers-routes-extra-coverage.test.ts
bun run check:architecture
```

上記は現時点で実在する代表 suite である。移行対象 route の近接 test は実装開始時に
`package.json` と `rg --files tests` で追加確認し、存在しない仮の path を検証済み evidence に使わない。

最低限の contract case:

- validation error
- unauthorized/forbidden
- not found
- conflict/revision mismatch
- retryable upstream failure
- non-retryable provider/schema failure
- unexpected internal error の情報非露出
- Coding Agent command typed failure の非回帰

### 8.2 Coverage

```bash
bun run test:coverage
bun run test:coverage:critical
```

- 二つの command が別 coverage run を暗黙生成する場合は、同じ artifact を明示指定できる script に直す。
- gate output に commit、生成時刻、coverage artifact identity、対象 file の metric を含める。
- full coverage と critical gate を同時並行で実行しない。

### 8.3 UI behavior

```bash
rg --files tests src | rg "(settings|task-console|evaluation|repositories).*(test|spec)"
node scripts/run-vitest.mjs run \
  tests/task-console-page-coverage.test.tsx \
  tests/settings-llm-panel.test.tsx \
  tests/project-evaluation-activity-panel.test.tsx
```

上記の既存 file 名は作業開始 HEAD で存在確認し、対象 suite を個別実行した後に full test を実行する。

### 8.4 全体回帰

```bash
bun run lint
bun run typecheck
bun run test
bun run verify
```

## 9. Rollout と migration

- error envelope は route module 単位で移行し、server と consumer を同一 release で互換にする。
- legacy decoder は期限と削除条件を code comment ではなく本計画の実行記録または Todo に明記する。
- coverage 改修は baseline failure がある target だけに限定する。
- UI test 改善は Frontend 実装 change と同じ PR/change set に含め、後追いの大規模 test rewrite にしない。
- API error telemetry で unknown/legacy shape がゼロになったことを確認して legacy branch を削除する。telemetry がない場合は repository-wide route/consumer search と contract test を削除条件にする。

## 10. リスクと対策

- **error contract の過剰統一**: REST transport error と role 固有 command failure を別 schema として維持する。
- **移行中の互換分岐の恒久化**: legacy decoder に削除 phase と repository-wide search 条件を設定する。
- **stale coverage**: commit と artifact identity を gate output に結びつけ、並行 run を避ける。
- **数値だけの test**: branch ごとの意味と利用者挙動を test 名・assertion に表す。
- **既存完了事項の二重実装**: E0 で pass した target は触らず、evidence だけ更新する。
- **巨大 file への誤帰属**: 実際の未達 branch と test seam を確認するまで分割を開始しない。

## 11. 完了条件

- `M11`, `m3`, `m4` に最新 baseline、実装 diff または変更不要 evidence、test 結果が紐づいている。
- `m2` は根拠不足の因果を復活させず、600 行制限を維持した非改修判定になっている。
- 一般 REST error が共通 schema/serializer/OpenAPI contract を使い、Frontend の route 別 shape 分岐がない。
- Coding Agent command failure の role 固有 typed contract と本文保持が壊れていない。
- critical coverage gate が同一 run artifact に対して全対象 pass する。
- 優先 UI の success/error/action/lifecycle が behavior test で固定される。
- lint、typecheck、対象 test、full test、coverage gate、architecture check が通る。
- 実装完了後、本書を `spec/.archived` へ移し、`spec/docs` に完了計画を残さない。
