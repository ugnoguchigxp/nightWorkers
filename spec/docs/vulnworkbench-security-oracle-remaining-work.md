# vulnWorkbench Security Oracle / Ontology 連携 残作業計画

## Status

implemented / representative verification passed (2026-07-10)

## 目的

NightWorkers から vulnWorkbench の scanner-backed evidence を利用し、Security Oracle の
実行基盤は Project 規模にかかわらず常時有効にする。そのうえで、計測済み source LOC に応じて
runtime へ渡す tool set を切り替える。小規模 Project には scanner-backed diagnostic を中心とする
標準 tool set、50,000 行以上の Project には ontology / Static Intelligence を含む拡張 tool set を渡す。

元の全体設計は
`spec/archive/vulnworkbench-cli-security-oracle-plan.md` を参照する。ただし、同文書にある
複数 CLI コマンド案や `nightworkers-quality.json` への security 設定追加は現行実装と異なるため、
以降は本書を残作業の正本とする。

## 現在の実装事実

### NightWorkers

- Review Run で `securityReview=true` の場合、登録済み Project の repo root を
  `api/modules/review/review-vulnworkbench.service.ts` から
  vulnWorkbench の `api/cli/oracle-security.ts --project-path <repo-root>` へ渡している。
- CLI process へ渡す環境変数は allowlist 済みで、timeout、JSON 抽出、warning / needs-human
  artifact、Review finding の保存と表示が実装済みである。
- installation 設定は `NIGHTWORKERS_VULNWORKBENCH_ENABLED`、
  `NIGHTWORKERS_VULNWORKBENCH_CWD`、timeout の環境変数に保ち、Project 単位の user intent は
  `repositories.feature_settings.securityIntelligence` に保存する。
- consumer は `shared/schemas/security-oracle.schema.ts` の strict schema で parse し、
  `status`、scan presence、blocking fingerprint を分けて扱う。`ok` 単独を gate pass に使わない。
- implementation の native `finalize_answer` と共通 runtime closeout に Security Oracle gate を接続済みで、
  clean 以外は finalize を許可しない。actionable finding は `security_fix`、再 verify、rerun の Todo 列へ変換する。
- `api/modules/project-detail/project-meta.service.ts` は tracked file を走査し、
  `projectMeta.files.sourceLoc`、file count、test count、`fileScale` を保存している。
- ontology runtime は技術スタック画面と同じ `project_code_size_snapshots.source_effective_lines` を読み、
  50,000 LOC 以上かつ user preference が ON の場合だけ `ontology_extended` を選ぶ。
  `fileScale` は判定には使わない。
- Project の規模計測と明示的な再計測 UI は `modules/techStack` にあり、設定 API と runtime は
  同じ保存済み snapshot を利用する。
- Project 単位の設定 UI には Test Quality の既存パターンがあるが、これは
  Project repo の `nightworkers-quality.json` を更新する。ontology / local integration の設定を
  Project repo に書き込む仕組みはない。

### vulnWorkbench

- 正式な外部 entrypoint は
  `bun run oracle:security -- --project-path <repo>` の 1 command である。
  NightWorkers から profile、review、format、timeout、DB id、provider 設定を渡さない契約である。
- stdout は JSON object 1 件、exit code は `0=clean`、`1=runtime error`、
  `2=config/policy error`、`3=security action required`、`4=inconclusive` である。
- repo path から vulnWorkbench Project を解決または作成し、`agent-output` profile を実行する。
- `scan.findings[]` は severity、tool、ruleId、title、repo 内相対 location、recommendation を返す。
  repo 外 location を `null` にするテスト、JSON-only stdout、invalid argument、startup failure の
  contract test が存在する。
- `oracle-security` JSON は各 finding の stable fingerprint、`findingsTruncated`、全 blocking finding の
  compact fingerprint 一覧を返す。NightWorkers は上位 finding の scope と全 blocking fingerprint の件数が
  一致しない場合に自動修正せず `needs_human` とする。
- `review.status` は現行 primary flow では `not_requested` で、
  `improvementRequest` は通常返らない。
- Static Intelligence の knowledge source manifest は `ontology_extended` の場合だけ read-only CLI から取得し、
  Security Oracle scan result とは別の `ontology_handoff_manifest` artifact / event に保存する。
  handoff unavailable でも scanner result は失わない。

## 設計上の分離

本計画では機能全体の ON/OFF と、runtime へ渡す tool set の ON/OFF を分ける。

| 層 | 目的 | 規模条件 | 状態 |
| --- | --- | --- | --- |
| Security Oracle 基盤 | scanner finding、Review 診断、closeout gate の共通制御 | LOC 条件なし | 常時 ON。Project 設定で無効化しない |
| standard tool set | scanner-backed evidence、strict CLI consumer、gate / rerun | 全 Project | 常に渡す |
| ontology extended tool set | ontology prompt / MCP、Static Intelligence handoff、boundary context | source LOC 50,000 以上 | 規模条件を満たすと既定 ON。設定画面から OFF にできる |

Security scan は小規模 Project にも価値があり、scanner evidence の生成自体は ontology ではないため、
50,000 LOC 制約を Security Oracle 全体へ流用しない。設定画面の ON/OFF は Security Oracle 基盤を
停止する switch ではなく、ontology extended tool set を追加するか、standard tool set だけに戻すかを
選ぶ switch とする。

## 50,000 LOC 有効化ルール

### 正本となる式

```ts
const ONTOLOGY_MIN_SOURCE_LOC = 50_000;

eligible = measurement.status === "available"
  && measurement.sourceLoc >= ONTOLOGY_MIN_SOURCE_LOC;

effectiveOntologyToolsEnabled = eligible && settings.ontologyToolsEnabled;

toolProfile = effectiveOntologyToolsEnabled
  ? "ontology_extended"
  : "standard";
```

- 50,000 行ちょうどを eligible とする。
- `fileScale.value` は判定に使わない。`large` / `huge` への文字列判定も廃止する。
- UI の toggle 値を runtime が信用せず、server 側で毎回 eligibility と組み合わせる。
- 計測値がない、parse できない、または scan が失敗した場合は `standard` を選ぶ。
  Security Oracle 基盤そのものは無効化しない。
- `ontologyToolsEnabled` の default は `true` とする。したがって 50,000 LOC 到達時点で
  `ontology_extended` が既定になる。
- Project が 50,000 LOC 未満へ戻った場合、保存済み `ontologyToolsEnabled=true` は保持してよいが、
  tool profile は `standard` とし、UI に規模条件未達を表示する。再び条件を満たした場合は
  保存済み intent に従って拡張 tool set を戻す。
- 50,000 LOC 以上の Project で user が toggle を OFF にした場合も `standard` を選ぶ。
  scanner / gate / rerun は引き続き利用できる。

### 技術スタック画面のサイズ計測に要求する契約

技術スタック画面へ追加される Project サイズ計測を本機能の唯一の入力にする。
本計画では line counter を重複実装しない。サイズ計測側は最低限、次を API から返す。

```ts
type ProjectSizeMeasurement = {
  status: "available" | "unavailable" | "failed";
  sourceLoc: number | null;
  sourceFileCount: number | null;
  testFileCount: number | null;
  scannedAt: string | null;
  sourceRevision: string | null;
};
```

既存 `projectMeta.files.sourceLoc` を移行元として利用できる。ただし、現状は git HEAD が同じ間は
cache を返すため、技術スタック画面の実装には明示的な再計測、または計測対象 revision / dirty state を
判別できる freshness 契約を含める。設定 API と run 開始時は同じ計測 service を使い、
UI 表示値と runtime 判定値を別計算にしない。

## Project 設定契約

### 保存先

ontology tool set の user preference と vulnWorkbench の local integration 設定は Project repo の成果物ではないため、
`nightworkers-quality.json` へ混在させない。NightWorkers SQLite の `repositories` に専用の
`feature_settings` JSON column、または同等の repository-scoped settings table を追加する。
計測結果を持つ `project_meta` と user intent も混在させない。

```ts
type ProjectSecurityIntelligenceSettings = {
  ontologyToolsEnabled: boolean; // default true; extended tool set preference
  securityMaxIterations: number; // default 3, 1..10
};
```

profile、CLI format、provider、vulnWorkbench DB、timeout tuning は Project 設定にしない。
それらは vulnWorkbench または NightWorkers installation 側の責務として現行 CLI 契約を維持する。

### API response

```ts
type ProjectSecurityIntelligenceSettingsResponse = {
  settings: ProjectSecurityIntelligenceSettings;
  securityOracle: {
    alwaysEnabled: true;
    configured: boolean;
  };
  ontology: {
    thresholdSourceLoc: 50_000;
    measuredSourceLoc: number | null;
    eligible: boolean;
    effectiveEnabled: boolean;
    toolProfile: "standard" | "ontology_extended";
    reason:
      | "enabled"
      | "user_disabled"
      | "below_threshold"
      | "measurement_unavailable";
    scannedAt: string | null;
  };
};
```

route は既存 repository settings pattern に合わせ、たとえば
`GET/PUT /api/repositories/:id/settings/security-intelligence` とする。
PUT は strict schema とし、unknown key、credential-like key、不正な iteration 値を拒否する。

### 設定画面

`SettingsScreen.tsx` の active Project を使う Project-scoped panel を追加する。

- Security Oracle 基盤は「常時 ON」と表示し、無効化 toggle は置かない。
- Ontology / Static Intelligence tool set の ON/OFF を表示する。
- source LOC、50,000 LOC threshold、計測日時、eligible / effective state、現在の tool profile を併記する。
- 50,000 LOC 未満または計測不能では ontology toggle を disabled / OFF 表示にし、
  `standard` tool set が利用されている理由を表示する。
- 保存後は server response を再表示し、stored intent と effective state の差を隠さない。
- 技術スタック画面にも source LOC と `standard` / `ontology_extended` badge を表示するが、
  ontology tool set の設定変更の正本は Settings panel とする。

## 機能ドメイン集約方針

Security Oracle / ontology の残作業を既存の分散配置へ追加し続けない。新機能を広げる前に、
Review Mode の所有コードを `modules/review`、ontology の所有コードを `modules/ontology` へ集約する。
ここでいう `modules/*` は backend / frontend それぞれの module root を指す。

### 目標ディレクトリ

```text
api/modules/review/
  index.ts                     # backend public API
  contracts/
  persistence/
  mode/
  run/
  evidence/
  evaluation/
  rubrics/
  security/
  routes/

src/modules/review/
  index.ts                     # frontend public API
  components/
  api/
  types/

api/modules/ontology/
  index.ts                     # backend public API
  core/
  eligibility/
  runtime/
  debug/
  handoff/
  routes/

src/modules/ontology/
  index.ts                     # settings / status UI public API
  components/
  api/
  types/
```

cross-runtime schema は `shared/schemas` に残してよいが、Review / ontology ごとにまとまった schema entrypoint を
持たせる。DB client、migration runner、worker tool dispatcher、MCP server、agent runtime、app router は
infrastructure / adapter なので元の配置に残し、各 module の `index.ts` が公開する API だけを呼ぶ。

### Review Mode の移設対象

現在の主な分散元は次である。

- `api/modules/nightworkers/nightworkers.review-*.ts`
- `api/services/review-results/`
- `api/services/review-rubrics/`
- `api/db/review-mode-schema.ts`
- `api/db/review-mode-schema-bootstrap.ts`
- `api/modules/nightworkers/routes/run-routes.ts` 内の review routes
- `api/modules/nightworkers/nightworkers.route-handlers.ts` 内の review handlers
- `src/modules/nightworkers/components/ReviewStatusViewer.tsx`
- `src/modules/nightworkers/types/review.ts`

目標配置:

- session / recommendation / finding / prompt suggestion の model と repository は
  `api/modules/review/mode` と `api/modules/review/persistence`。
- Review Run、target extraction、finalize、test evidence は `api/modules/review/run`。
- review result と rubric evaluator は `api/modules/review/evaluation` / `rubrics`。
- vulnWorkbench adapter と security finding mapping は `api/modules/review/security`。
- review HTTP route definition / handler は `api/modules/review/routes`。
- `ReviewStatusViewer` と review UI types / commands は `src/modules/review`。
- schema / bootstrap の所有権は `api/modules/review/persistence` へ移す。DB composition から直接参照すると
  cycle が生じる場合だけ、`api/db` に thin re-export / registration adapter を残す。

次は Review domain の利用側であり、module 内へ移さない。

- `run-orchestration`: review start / finalize の呼び出し adapter。
- `worker-tools/reviewer-evaluation.ts`: worker tool dispatcher adapter。
- `supervisor/skills/.../review.md`: prompt / skill document。
- `ArtifactPane.tsx`: Review viewer を配置する workspace host。
- git closeout: Review の状態を読む consumer。Review repository を所有しない。

### Ontology の移設対象

現在の主な分散元は次である。

- `api/services/agent-ontology/agent-ontology.service.ts`
- `api/services/agent-runtime/ontology-runtime-context.ts`
- `api/modules/nightworkers/nightworkers.run-query.service.ts` 内の ontology debug read model
- `api/modules/nightworkers/routes/run-routes.ts` 内の `/runs/:id/ontology-debug`
- `start-task-run.ts` 内の規模判定と ontology snapshot 組み立て

目標配置:

- ontology core loader / list / classify / compile / boundary / verification は
  `api/modules/ontology/core`。
- 50,000 LOC eligibility と `standard` / `ontology_extended` resolver は
  `api/modules/ontology/eligibility`。
- runtime context snapshot、prompt formatting、boundary audit は `api/modules/ontology/runtime`。
- run debug report と read-only route は `api/modules/ontology/debug` / `routes`。
- vulnWorkbench knowledge source manifest / ontology handoff consumer は
  `api/modules/ontology/handoff`。
- Settings panel と tool profile status は `src/modules/ontology`。

`agent-ontology.service.ts` は現在 `project-detail/task-generation-evidence.service` を直接 import している。
移設後の ontology module は Project Detail を逆参照せず、task-generation evidence を input として受け取るか、
composition root から narrow port を注入する。Project Detail は size measurement を提供し、agent runtime / MCP は
ontology public API を利用する側とする。

### 依存方向

```text
app / route composition
  -> modules/review
  -> modules/ontology

nightworkers run orchestration
  -> modules/review public API
  -> modules/ontology public API

agent-runtime / MCP / worker-tools adapters
  -> modules/ontology or modules/review public API

modules/review
  -> shared contracts + DB/runtime narrow ports

modules/ontology
  -> shared contracts + filesystem/core narrow ports
```

- `modules/review` と `modules/ontology` は `nightworkers.service.ts` barrel、route handler、UI host を import しない。
- `modules/review` と `modules/ontology` は相互 import しない。Review が ontology handoff を表示する場合も、
  orchestration layer が両者の artifact を合成する。
- consumer は module 内部 path ではなく `index.ts` から import する。
- public HTTP path、DB table / column、event type、artifact kind、saved JSON shape は移設だけでは変更しない。

### 段階移行ルール

1. 移設前に import graph と対象テストの baseline を保存する。
2. 新 module に public API と内部構造を作り、旧 path は一時的な re-export にする。
3. production consumer を新しい module entrypoint へ切り替える。
4. tests / fixtures の import を新 entrypoint へ切り替える。
5. old path import が 0 件であることを確認してから compatibility re-export を削除する。
6. file move と behavior / schema / status 変更を同じ slice に混ぜない。

### Refactor Track A: Review domain 集約

1. `review` public contracts と `api/modules/review/index.ts` を作る。
2. model / repository / evidence を移し、DB table 名と query semantics を維持する。
3. Review Run、target、test evidence、finalize を移す。
4. review-results / review-rubrics を evaluation / rubrics へ移す。
5. vulnWorkbench Review adapter を security へ移す。
6. review routes / handlers を module router へ移し、既存 URL のまま app / NightWorkers router へ mount する。
7. frontend viewer / types / API commands を `src/modules/review` へ移す。
8. orchestration、worker tool、git closeout、ArtifactPane を public API 利用へ切り替える。
9. old `nightworkers.review-*`、`services/review-*` import を 0 件にして互換 re-export を削除する。

Review refactor の完了条件:

- Review Mode の domain implementation が `api/modules/review` / `src/modules/review` に集約される。
- `nightworkers` には orchestration / mount adapter 以外の Review implementation が残らない。
- Review Session、Review Run、rubric evaluation、vulnWorkbench finding、git closeout の挙動が変わらない。

### Refactor Track B: Ontology domain 集約

1. `api/modules/ontology/index.ts` と core / runtime public contracts を作る。
2. agent-ontology core service を `core` へ移す。
3. runtime snapshot / boundary audit / prompt formatter を `runtime` へ移す。
4. 50,000 LOC tool profile resolver を `eligibility` に置き、Settings / run orchestration から共用する。
5. ontology debug query / route / handler を `debug` / `routes` へ移し、既存 URL を維持する。
6. Static Intelligence handoff consumer を `handoff` に追加する。
7. MCP、Codex/native runtime、Project Detail、run orchestration の import を public API へ切り替える。
8. `services/agent-ontology` / `agent-runtime/ontology-runtime-context` import を 0 件にして互換 re-export を削除する。

Ontology refactor の完了条件:

- ontology 所有コードが `api/modules/ontology` に集約される。
- Project Detail は measurement producer、agent runtime / MCP は ontology consumer という方向になる。
- `/api/runs/:id/ontology-debug`、ontology snapshot、boundary audit、tool manifest の外部契約が変わらない。
- `standard` / `ontology_extended` 判定が module 外へ重複しない。

## 実装計画

Refactor Track A / B を共通の先行作業とし、両 module の public API と依存方向を固定してから
以下の機能 Phase へ進む。既に並行実装中の Phase がある場合も、新しい Review / ontology 所有コードは
旧配置へ追加せず、対応する module 配下へ置く。

### Phase 0: サイズ計測契約を固定する

対象: NightWorkers

1. 技術スタック画面へ追加されるサイズ計測 API / schema を確認し、
   `sourceLoc`、`scannedAt`、revision/freshness を正本として固定する。
2. 既存 `projectMeta.files.sourceLoc` からの互換読み取りを追加する。
3. 49,999 / 50,000 / 50,001 LOC、計測不能、再計測の fixture を追加する。
4. `fileScale` は表示用に残してよいが、ontology eligibility から切り離す。

検証:

- 同じ Project について技術スタック画面、設定 API、run snapshot の LOC が一致する。
- git HEAD / dirty state の変化後に stale な値で eligibility を確定しない。
- 計測不能は eligible 扱いにならない。

### Phase 1: Project 設定・API・UIを追加する

対象: NightWorkers

1. shared strict schema、SQLite migration、repository read/write service を追加する。
2. `GET/PUT /repositories/:id/settings/security-intelligence` を追加する。
3. eligibility resolver を 1 箇所に実装し、API と runtime から共用する。
4. Settings panel と日英 i18n を追加する。
5. 技術スタック画面の size result を panel へ渡し、eligibility badge を表示する。

完了条件:

- Security Oracle 基盤は新規 / 既存 Project の両方で常時 ON になる。
- 49,999 LOC では `standard` tool set が選ばれる。
- 50,000 LOC 以上では `ontologyToolsEnabled=true` を default とし、
  `ontology_extended` tool set が選ばれる。
- 50,000 LOC 以上でも user が OFF にした Project は `standard` tool set に戻る。
- Project repo に設定ファイルや scan artifact を作らない。

### Phase 2: 既存 ontology runtime を新しい実効設定へ統一する

対象: NightWorkers

1. `start-task-run.ts` の `large` / `huge` 判定を shared eligibility resolver に置き換える。
2. context snapshot に stored intent、measured LOC、threshold、eligible、effective、tool profile、reason を保存する。
3. Codex env、runtime prompt、native tool registry、MCP manifest、runtime audit、ontology context / boundary audit を
   すべて同じ `toolProfile` / `effectiveOntologyToolsEnabled` で gate する。
4. `standard` のときは ontology guidance と ontology-only tools を model-visible payload へ入れないが、
   Security Oracle の standard tools は維持する。
5. 既存 Project も 50,000 LOC 以上なら default で `ontology_extended` へ移行することを確認する。

完了条件:

- 50,000 LOC 未満では `standard` tools だけが露出する。
- 50,000 LOC 以上では default で ontology tools が追加され、user setting が off なら露出しない。
- 有効時だけ ontology context compile / boundary audit が実行される。
- prompt / config / client / manifest / audit / runtime の tool profile が一致する。

### Phase 3: vulnWorkbench `oracle-security` contract を厳格化する

対象: vulnWorkbench、NightWorkers consumer fixture

1. 現行 JSON shape を shared Zod schema として vulnWorkbench 内で定義し、CLI success/failure を出力前に parse する。
2. `scan.findings[]` に既存 DB の stable `fingerprint` を追加する。
3. 上位 10 件 truncation を明示する field、または全 blocking fingerprint を返す compact field を追加し、
   NightWorkers が未返却 blocking finding を pass 扱いしないようにする。
4. exit code 0 / 1 / 2 / 3 / 4、JSON-only stdout、repo 外 path redaction、secret-like fixture、
   `reportPath` 非公開を provider/consumer fixture で固定する。
5. NightWorkers の ad hoc object parser と regex fallback を strict schema parse に置き換える。

制約:

- 外部入力は `--project-path` だけのままにする。
- NightWorkers から vulnWorkbench SQLite を直接読まない。
- `ok=false` でも usable scan があり得るため、`status`、exit code、scan presence を別々に保存する。
- `security_action_required` と `inconclusive` を clean pass に正規化しない。

### Phase 4: blocking Security Oracle gate を追加する

対象: NightWorkers

Security Oracle 基盤は常時有効とするため、Project 単位の enable 判定は追加しない。
現行 `NIGHTWORKERS_VULNWORKBENCH_ENABLED=false` は「正常な disabled result」ではなく、
installation capability 不足として `needs_human` に正規化する。CLI path / timeout は installation 設定として残す。

実行順は次に固定する。

```text
open Todo 解消
  -> repo-native verify 成功
  -> oracle-security 実行
  -> gate result 保存
  -> finalize または security_fix 継続 / needs_human
```

gate result:

```ts
type SecurityGateResult = {
  version: 1;
  status: "passed" | "continue" | "needs_human";
  allowFinalize: boolean;
  scanRunId: string | null;
  previousScanRunId: string | null;
  blockingFingerprints: string[];
  iteration: number;
  message: string;
};
```

判定:

- exit 0、schema valid、blocking finding なし: `passed`。
- exit 3、schema valid、追跡可能な actionable finding あり: `continue`。
- exit 1 / 2 / 4、CLI missing、timeout、schema invalid、truncated blocking detail、iteration 上限:
  `needs_human`。security pass にはしない。

Review Run の `securityReview` checkbox は任意の Review 表示範囲として残し、blocking closeout gate と
artifact kind / status を分離する。checkbox が off でも Security Oracle 基盤や implementation closeout gate を
無効にはせず、その Review Run で security finding を review surface に展開しないという意味に限定する。

### Phase 5: `security_fix` Todo と fingerprint rerun loop を追加する

対象: NightWorkers、vulnWorkbench contract

1. blocking finding を `security_fix` Todo へ変換する。
2. allowed scope は repo 内 relative location と finding evidence から構成し、location 不明または scope 過大なら
   自動修正せず `needs_human` にする。
3. Todo に finding fingerprint、tool、ruleId、location、recommendation、non-goals、acceptance、
   repo verify、oracle rerun を含める。
4. 修正後は同じ one-command oracle を再実行し、前回と今回の fingerprint を比較する。
5. 同一 fingerprint あり=`still_present`、fingerprint 消失かつ同一 tool/rule/path の別 fingerprint あり=`changed`、
   clean rerun で消失=`resolved`、scan 不完全=`scanner_failed` とする。
6. `resolved` と repo verify success の両方が揃うまで Todo を pass にしない。

`not_reproducible` は scanner coverage が完全でも再現条件を証明できない場合だけに限定し、
自動 pass ではなく human disposition へ送る。

### Phase 6: Static Intelligence / ontology handoff を接続する

対象: vulnWorkbench read-only source surface、NightWorkers ontology consumer

この Phase は `toolProfile="ontology_extended"` の Project だけを対象にする。

1. vulnWorkbench の knowledge source manifest / ontology handoff を CLI または read-only MCP で取得する。
2. Security Oracle scan JSON に handoff を無理に混在させず、scan evidence と ontology read model を別 artifact として保存する。
3. NightWorkers は vulnWorkbench DB を読まず、redacted manifest、module candidates、source refs、
   verification commands だけを消費する。
4. handoff unavailable / stale / degraded は ontology 補助の unavailable として扱い、scanner result を失わない。
5. canonical ontology、Task Compiler、execution decision の所有権は NightWorkers に残す。

完了条件:

- `standard` profile では handoff command / MCP tool を呼ばない。
- 50,000 LOC 以上でも toggle off では `standard` profile を維持する。
- raw source body、raw scanner artifact、secret が ontology payload に入らない。
- Static Intelligence の read model を confirmed security finding と混同しない。

### Phase 7: contextStill knowledge capture を限定追加する

対象: NightWorkers

- `resolved` が確認できた修正手順と、human が確定した false-positive 判断だけを候補にする。
- candidate には fingerprint 自体の Project 固有値ではなく、再利用可能な rule、限定 scope、verify、rerun 条件を入れる。
- raw scanner output、secret、repo 固有 path、未解決 finding、Static Intelligence の candidate-only 推測は送らない。
- downstream 登録成功前に converted / completed 扱いしない。

## 実装単位

レビュー可能な順序を次に固定する。

1. NightWorkers: Review domain public API + model / persistence の移設。
2. NightWorkers: Review Run / evaluation / security / route / UI の `modules/review` 集約。
3. NightWorkers: Ontology domain public API + core / runtime / debug の移設。
4. NightWorkers: size measurement contract + `modules/ontology/eligibility` の 50,000 LOC tests。
5. NightWorkers: Project tool-set preference persistence/API/UI。runtime 挙動はまだ変えない。
6. NightWorkers: LOC resolver と runtime tool profile の統一。
7. vulnWorkbench: strict oracle schema + fingerprint + truncation contract。
8. NightWorkers: strict consumer + always-on clean/needs-human security gate。
9. NightWorkers: blocking Todo + rerun comparison。
10. 両 repo: scale-gated read-only ontology handoff。
11. NightWorkers: verified knowledge capture。

各実装単位は前段の contract test が成功してから次へ進む。

## 検証計画

### NightWorkers focused tests

- Domain boundary: Review / ontology consumer が各 module `index.ts` だけを import する。
- Legacy import: `nightworkers.review-*`、`services/review-*`、`services/agent-ontology`、
  `agent-runtime/ontology-runtime-context` の production import が 0 件になる。
- Review regression: session / recommendation / finding / prompt suggestion / Review Run / test evidence /
  rubric / vulnWorkbench / finalize / git closeout / ReviewStatusViewer。
- Ontology regression: core tools / runtime snapshot / boundary audit / debug route / Codex and native tool exposure /
  MCP manifest。
- Contract preservation: review HTTP URL、ontology debug URL、DB table / column、event type、artifact kind、
  persisted JSON shape が移設前後で一致する。
- Project size: 49,999 / 50,000 / 50,001 LOC、missing、failed、refresh。
- Settings API: default on preference、strict rejection、Project 分離、migration compatibility。
- Settings UI: Security Oracle 常時 ON、below-threshold standard、eligible toggle、stored/effective 表示、save error。
- Tool routing: 49,999=`standard`、50,000 default=`ontology_extended`、50,000 user off=`standard`。
- Ontology runtime: prompt、Codex env、native registry、MCP manifest、audit、snapshot の profile 同値性。
- Oracle consumer: exit code 0..4、invalid JSON、schema drift、timeout、CLI missing、finding truncation。
- Closeout: always enabled、clean pass、action required、needs-human、open Todo、verify 未実行、iteration 上限。
- Rerun: resolved、still_present、changed、not_reproducible、scanner_failed、scope 外 diff。

### vulnWorkbench focused tests

- `api/modules/scans/security-oracle-cli.test.ts` で JSON schema と全 exit code を固定する。
- fingerprint が scan 間で安定し、JSON に出る。
- blocking detail の truncation が暗黙にならない。
- repo 外 path、raw secret、`reportPath` が stdout に出ない。
- startup / scanner failure でも JSON object 1 件を返す。

### 代表 gate

各 repo の focused tests 後に、それぞれの repo root で実行する。

```bash
# /Users/y.noguchi/Code/vulnWorkbench
bun run verify

# /Users/y.noguchi/Code/nightWorkers
bun run verify
```

## 完了条件

- Security Oracle 基盤と standard tool set は全 Project で常時有効である。
- Review Mode 所有コードが `api/modules/review` / `src/modules/review` に集約され、
  NightWorkers / worker tools / UI host は public API だけを利用する。
- ontology 所有コードが `api/modules/ontology` / `src/modules/ontology` に集約され、
  agent runtime / MCP / Project Detail / run orchestration は public API だけを利用する。
- legacy path の production import と一時 compatibility re-export が残っていない。
- source LOC 50,000 未満の Project では `standard` tool set だけが渡される。
- source LOC 50,000 以上では default で `ontology_extended` tool set が渡され、
  設定画面で OFF にした場合だけ `standard` へ戻る。
- 設定画面と技術スタック画面が同じ計測値、threshold、eligibility、tool profile を表示する。
- scanner failure、inconclusive、schema invalid、truncated blocking detail が security pass にならない。
- actionable finding が残る blocking gate run は finalize できない。
- 修正、repo verify、fingerprint rerun が同じ `security_fix` Todo / gate artifact へ trace できる。
- Security Oracle scan evidence と ontology read model が別 artifact / status として保存される。
- raw scanner output、secret、repo 外 path が model-visible payload、Project repo、knowledge candidate に漏れない。
- NightWorkers と vulnWorkbench 双方の focused tests と代表 `verify` が成功する。

## Stop Conditions

- Review / ontology の file move と behavior、DB schema、public response の変更が同じ slice に混ざる場合は分割する。
- 新 module が `nightworkers.service.ts` や相互 module を逆 import して cycle を作る場合は、先に narrow port を定義する。
- 旧 path の consumer が残る間は compatibility re-export を削除しない。
- Review route、ontology debug route、DB table、event / artifact contract の baseline comparison がない間は
  domain refactor を完了扱いにしない。
- 技術スタック画面の size measurement に source LOC と freshness がない間は、`standard` profile を維持し、
  ontology toggle を有効化しない。
- vulnWorkbench JSON に stable fingerprint または全 blocking finding を判別できる情報がない間は、rerun Todo を pass にしない。
- NightWorkers consumer が status / exit code / schema invalid を区別できない間は、always-on blocking gate を release しない。
- Security Oracle と Static Intelligence handoff が同一 payload に混ざり、evidence と read model を区別できない場合は Phase 6 へ進まない。
- redaction fixture が失敗する場合は model-visible payload と knowledge capture を有効化しない。
