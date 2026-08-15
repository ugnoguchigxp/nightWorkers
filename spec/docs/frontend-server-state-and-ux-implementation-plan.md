# Frontend Server State and UX 改修実装計画

## 0. 文書情報

- 状態: Proposed
- 作成日: 2026-08-16
- 対象リポジトリ: `nightWorkers`
- 対象指摘: `M7`, `M8`, `M9`, `m1`, `m6`, `m7`
- 位置づけ: [改修プログラム索引](./codebase-review-remediation-program-index.md)の Frontend 作業領域
- 実装開始条件: 本計画の採用と、対象画面ごとの回帰テスト追加方針の合意

## 1. 目的

Frontend に散在する server state の取得・更新・polling・error 表示を、既存の TanStack Query 基盤へ段階的に寄せる。単なる API 呼び出しの置換ではなく、同一 resource の cache identity、mutation 後の同期、terminal state 後の停止、失敗時の明示表示、i18n を一貫させる。

この領域で解消する問題は次のとおり。

- `M7`: 同じ repository resource に異なる query key が使われ、cache が分断される。
- `M8`: Settings が server state を local state だけで管理し、取得・保存失敗と cache 同期が弱い。
- `M9`: `TaskConsolePage` が error を loading と同じ見た目にし、terminal state 後も polling を継続する。
- `m1`: 主要画面に手書き `fetch` と独自 loading/error 管理が残り、server state の同期方法が統一されていない。
- `m6`: 一部の利用者向け文言が辞書を通らず英語または直接記述になっている。
- `m7`: Project Evaluation の activity event 依存で polling cursor が不必要に再生成されうる。

## 2. 非目標

- Frontend 全体を一括 rewrite しない。
- TanStack Query を別の state library に置き換えない。
- editor draft、dialog の開閉、filter 入力などの純粋な client/UI state を Query cache に移さない。
- WebSocket、stream、terminal output のような連続 event を無条件に query 化しない。
- 本計画の一環として画面デザインを全面変更しない。
- API error payload の正本を Frontend 側だけで決めない。正本は [API Contract and Verification Quality 改修実装計画](./api-contract-and-verification-quality-implementation-plan.md)が所有する。

## 3. 現状認識と実装前の再確認

前回調査時点では、repository 一覧に `['repositories']` と `['projects']` が併存し、Settings では `Promise.all` と local state による独自取得・保存、`TaskConsolePage` では error 時にも spinner を表示する分岐と固定 polling が確認された。また、Overview、Security、Evaluation、Quality、Git Worktree 周辺にも手書き `fetch` が残る。

ただし実装時には、作業開始 HEAD で次を再取得し、変更済み箇所を古い観測で上書きしない。

```bash
rg -n "queryKey|invalidateQueries|setQueryData" src
rg -n "fetch\(" src
rg -n "refetchInterval|setInterval|activityEvent|lastEvent" src
rg -n "window\.confirm|window\.alert|>[[:space:]]*[A-Za-z][^<{]*<" src
```

## 4. 目標不変条件

1. 同一 resource は feature 間で同じ query key factory を使用する。
2. remote snapshot は Query cache、編集中 draft は component/form state が所有する。
3. mutation 成功時は canonical key に対する `setQueryData` または `invalidateQueries` を必ず行う。
4. loading、empty、error、success は相互に区別して描画する。
5. terminal state に入った run/task は定期 polling を停止する。
6. request の前後関係が逆転しても古い response が新しい state を上書きしない。
7. 利用者向け文言は locale dictionary を経由し、確認・失敗・空状態も対象に含める。
8. polling cursor は cursor の意味が変わった時だけ更新し、無関係な activity event で再生成しない。

## 5. 所有境界

- query key、query option、resource API client は、利用 feature から独立して再利用できる frontend module が所有する。
- page/component は query の結果から表示 state を構成し、server state の別コピーを正本にしない。
- API error schema と decoder は API・検証品質領域が所有し、本領域はその公開 contract だけを使う。
- Task/Run の terminal state 定義は Run・Queue 整合性領域の公開 contract を使い、画面内に別定義を作らない。

## 6. 実装フェーズ

### D0. Characterization と canonical query key の確立

対象: `M7`, `m1`

1. repository、settings、task/run、evaluation について、現行 key、取得関数、mutation、polling interval、利用画面を一覧化する。
2. 最初の小さい移行対象として repository resource の query key factory と query options を共通化する。
3. `['repositories']` と `['projects']` のどちらかを文字列置換するのではなく、それぞれが同じ API resource かを route・response schema まで追跡する。同一なら canonical key に統合し、別 resource なら名前で区別できる key に改名する。
4. 旧 key の mutation invalidation が残らないことを test で固定する。

完了条件:

- repository の全 query/mutation が共通 factory を参照する。
- 同一 API response を指す query key の重複がない。
- key 統合後に一覧・選択・作成・削除が stale にならないことを component/integration test で確認できる。

### D1. Settings の server state 移行

対象: `M8`, `m1`

1. provider/model 設定の取得を `useQuery` または共通 query options に移す。
2. 編集開始時に remote snapshot から draft を作るが、その後の cache 更新で編集中の未保存入力を上書きしない。
3. 保存を `useMutation` に移し、成功 response を canonical cache へ反映する。server が正規化した値を返す場合は request payload ではなく response を採用する。
4. 取得失敗、保存失敗、再試行、保存中、保存完了を別 state として表示する。
5. response status と共通 API error decoder を必ず評価し、JSON parse 成功だけを成功条件にしない。
6. 複数設定をまとめて取得する場合も、一部失敗を全成功に見せない。独立表示できる resource は query を分離し、不可分なら aggregate query の typed error とする。

完了条件:

- Settings の server snapshot が local state のみを正本にしていない。
- 読み込み・保存の失敗を利用者が識別でき、再試行できる。
- 保存後に他画面または再描画が古い model/provider 設定へ戻らない。

### D2. TaskConsole の表示 state と polling lifecycle 修正

対象: `M9`, `m6`

1. loading、not found/empty、recoverable error、terminal error、success を明示的な描画分岐にする。
2. error state で spinner を出し続けず、error message、再試行 action、必要なら前画面への導線を出す。
3. `refetchInterval` を callback 化し、公開 terminal state contract に該当する場合は `false` を返す。
4. background/foreground、window focus、network reconnect の既存挙動を確認し、復帰後に必要な一度の再取得は維持する。
5. terminal state 到達直前の in-flight request が戻っても polling が再開しないことを test する。
6. 直接記述された英語文言と `window.confirm` 文言を辞書へ移す。

完了条件:

- request error が無限 loading に見えない。
- terminal state 後に timer-driven request が増えない。
- 既存の実行中更新と focus 復帰時の最新化を壊していない。

### D3. Project Evaluation polling cursor の安定化

対象: `m7`

1. cursor が表す値と更新契機を明文化する。
2. effect/callback の dependency から、cursor の意味を変えない activity event object を外す。
3. 最新値の参照だけが必要なら `useRef` または updater function を使い、subscription/polling の identity を安定させる。
4. Strict Mode の mount/unmount、project 切替、run 切替で重複 polling が発生しない test を追加する。
5. 古い project/run の遅延 response を捨てるため、Query の `signal`、request generation、または resource identity の照合を使う。

完了条件:

- 新規 event 到着だけで timer/subscription が作り直されない。
- project/run 切替時だけ正しく cursor と request identity が更新される。

### D4. 手書き fetch の段階移行

対象: `m1`

優先順は、共有頻度、mutation 後の stale risk、独自 polling の有無、error 不可視性で決める。候補は Overview、Security、Evaluation、Quality、Git Worktree とし、実装前 inventory で確定する。

各 feature は次の単位で移行する。

1. response schema と error decoder を API client に集約する。
2. query key/options と mutation options を定義する。
3. component の `useEffect + fetch + local loading/error` を query/mutation へ置換する。
4. cancellation と stale response 防止を確認する。
5. behavior test を追加してから次 feature へ進む。

stream、long-poll、download、one-shot command など Query 化が不適切な呼び出しは inventory に理由を残して対象外とする。`fetch` の件数をゼロにすること自体を完了条件にしない。

### D5. i18n と accessibility の仕上げ

対象: `m6`

1. 変更対象画面に残る利用者向け直書き文言を抽出する。
2. error、confirm、empty、retry、polling stopped を含めて既存辞書へ登録する。
3. test selector を翻訳文字列へ依存させず、role、label、test id の優先順位を定める。
4. error callout に適切な role、retry button に accessible name、loading に busy 状態を付ける。
5. 少なくとも既定 locale と日本語 locale で欠落 key がないことを検証する。

## 7. 領域間依存

- [Run and Queue State Integrity](./run-queue-state-integrity-implementation-plan.md): terminal state と cancel/resume の公開 contract を D2 が使用する。
- [API Contract and Verification Quality](./api-contract-and-verification-quality-implementation-plan.md): 共通 error schema/decoder を D1、D2、D4 が使用する。
- API error contract の全 route 移行を待たず、decoder が移行期間の旧形式を扱える時点から Frontend 移行を開始できる。

## 8. 検証計画

### 8.1 自動テスト

- query key factory の equality と invalidation 対象。
- Settings の取得失敗、保存失敗、保存成功、未保存 draft 保護。
- TaskConsole の loading/error/success/terminal 表示と polling 停止。
- Project Evaluation の project/run 切替、Strict Mode、遅延 response 排除。
- 変更対象画面の locale key と主要 accessible role。

実在する既存 test path は実装開始時に次で再確認し、近接する suite へ追加する。存在しない path 名を計画から固定実装しない。

```bash
rg --files tests src | rg "(settings|task-console|evaluation|repositories|worktree|quality|security).*(test|spec)"
node scripts/run-vitest.mjs run \
  tests/task-console-page-coverage.test.tsx \
  tests/settings-llm-panel.test.tsx \
  tests/project-evaluation-activity-panel.test.tsx
```

### 8.2 静的検証

```bash
bun run typecheck
bun run lint
bun run check:architecture
```

既存の `check:architecture` が query key や i18n の整合性を検査しない場合は、再発しやすい不変条件だけを既存 architecture check の責務に沿って追加する。画面固有の挙動は architecture check へ押し込まず、component/integration test で検証する。

### 8.3 手動確認

- repository 作成・削除後に関連画面が同じ一覧を表示する。
- Settings 取得失敗と保存失敗が区別され、再試行可能である。
- 実行中 TaskConsole は更新され、完了後は network polling が止まる。
- Evaluation 画面を切り替えても旧 project の結果が混入しない。
- 日本語 locale で新規 error/confirm 文言が欠落しない。

## 9. Rollout と rollback

- feature 単位で移行し、query key の全 consumer と mutation を同一 change set で揃える。
- 旧 key と新 key を長期間二重運用しない。必要な移行期間は明示的な bridge invalidation を限定配置し、後続 change で除去する。
- polling 変更は terminal 判定の telemetry/log を確認してから全画面へ展開する。
- 回帰時は feature 単位で旧取得実装へ戻せる粒度を保つが、error の不可視化や stale cache を rollback の恒久状態にしない。

## 10. リスクと対策

- **draft 消失**: remote snapshot と編集中 draft を分離し、cache refresh が draft を初期化する条件を明示する。
- **key 統合時の stale 表示**: query consumer だけでなく mutation invalidation を同時に検索・更新する。
- **polling 停止の早すぎ**: terminal state は server contract だけを使い、見た目の message で判定しない。
- **Query 化の過剰適用**: stream/event transport は resource snapshot と分け、適用理由を inventory に残す。
- **error contract 移行差**: Frontend decoder は移行期間だけ旧・新を扱い、API 全移行後に旧形式 branch を削除する。

## 11. 完了条件

- `M7`, `M8`, `M9`, `m1`, `m6`, `m7` の各 finding に実装 diff、test、または明示的な対象外根拠が紐づいている。
- 同一 repository resource の query key が一意である。
- Settings、TaskConsole、Project Evaluation の主要失敗・競合・polling lifecycle が behavior test で固定されている。
- 対象画面の利用者向け新規文言が辞書を経由する。
- typecheck、lint、対象 test、関連 architecture check が通る。
- 実装完了後、本書を `spec/.archived` へ移し、`spec/docs` に完了計画を残さない。
