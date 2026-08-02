# LLM向けTest Evidence契約の簡素化 実装計画

## Status

- Plan status: `implemented; automated verification passed; Terra/Luna live canary pending`
- Created / reviewed: 2026-08-02
- Target: NightWorkers Coding Agent Run
- Baseline: `main` / `521d64a803aaad9e4676514f6590fce4f37edd97`
- Baseline worktree: dirty
- Related:
  - `AGENTS.md`
  - `spec/docs/acceptance-condition-evidence-strictness-implementation-plan.md`
  - `spec/multi-language-test-evidence-quality-gate-implementation-plan.md`

## Implementation status (2026-08-02)

- Phase 0〜3のproduction code、model-facing contract、SystemContext、unit／contract／integration regressionを実装済み。
- 実Vitest inventoryからshort caseKey mapping、host-added reporter、parser、identity resolver、evidence persistence、assurance、completion readinessまでのintegration testを自動化済み。
- `bun install --frozen-lockfile --ignore-scripts`、`bun run s11tnext:lint`、`bun run s11tnext:check`、`bun run verify`、`bun run build:backend`は成功済み。
- TerraとLunaによるTodo CRUD相当の実Run各1回は、live canaryとして未実施。配備前の運用受け入れ確認として残る。

現在のworktreeには、`inventoryId + caseKey`によるexact mappingへ移行する未コミット変更がある。本計画はその差分をbaselineとして扱い、破棄、旧similarity mappingへの回帰、無関係な変更の取り込みを行わない。

## 1. 結論

LLMは、active testcaseとVerification Conditionの意味上のmapping、およびProjectに適したtest commandの選択を所有する。hostは、Run、Feature Plan由来のVerification Document、current inventory、保存済みmappingからtest scope、evidence kind、runner、structured reporter、case identityを解決する。

LLMへrunner、report形式、source hash、長いcase identity、test実行ごとの`conditionIds`と`evidenceKinds`を再入力させない。新しいtool、固定workflow、DB migration、複雑なtest locatorは追加せず、既存toolの公開fieldとhost側の推測を減らす。

## 2. 背景

直近Run `cc980177-7f83-4c86-8329-afd76615b5fe`では、実装、Project正本verify、7条件のexact mappingまで成功した。Vitest JSON/JUnitから各171件をparseしたが、caseKeyは0件しか解決されなかった。

inventoryの名前が`TodoView > test name`、Vitest JSONの名前が`TodoView test name`であり、現在のidentity比較が両者を同一視しなかったことが直接原因である。さらに、LLM向け`run_check`結果から`parsed=171 / resolved=0`が省略され、`completion_check`が`run_structured_tests`を繰り返し返したため、Terraはreporterを変えて再試行した。

separatorだけを直しても、Lunaへrunner、reporter、evidence kindを選ばせる問題は残る。本計画は証跡の意味判断をLLM、機械的取得と照合をhostへ分ける。

## 3. 目的と非目的

### 目的

1. LLMがactive testcaseとconditionのmappingだけを明示する。
2. test実行は基本的に`command`と`checkKind`だけでmanaged evidenceを生成する。
3. inventory caseを短くし、LLMのtokenと転記失敗を減らす。
4. command成功、test失敗、evidence取得失敗を区別する。
5. evidence取得障害でreporter変更の反復を誘導しない。
6. current source、Run、Document、inventory、mapping、executionのstrict bindingを維持する。
7. 採用済みFeature PlanとQuestionnaireにないtest範囲を完了条件へ追加しない。

### 非目的

- 新しいruntime、mode、tool、固定workflow、tool allowlistを追加しない。
- hostがtest名、Task本文、ユーザー文言からcondition mappingを推測しない。
- DB table、column、migrationを追加しない。
- `suitePath`、location、native ID、execution profile、report formatを永続化しない。
- 新しいrunner／reporter adapterを追加しない。
- Confirmation Receiptとfollow-up verifyの状態遷移を変更しない。
- automated test conditionの`commands: []`を不備にしない。
- Questionnaire対象外のtestを復活させない。

## 4. 正本と責務

採用済みFeature Planを実装Runの完了条件の正本とする。Verification DocumentはFeature PlanとQuestionnaireからmaterializeされた構造的projectionである。

| 判断・検証 | 所有者 |
| --- | --- |
| testcaseとconditionの意味上の対応 | LLM |
| Project commandの選択 | Feature Plan、なければLLM |
| condition、expected evidence、test scope | Feature Plan / Verification Document |
| Run、Document、repo root、source revision | host |
| runner、reporter、case identity | host |
| scope、freshness、revision、idempotency | host |
| test失敗後の修正内容と次action | LLM |

hostは構造的な不足に対するtyped reasonとsuggested actionを返せるが、TodoとRun statusを暗黙更新しない。

## 5. 最小LLM contract

### 5.1 Inventory

成功payloadはactive caseだけを返す。

```json
{
  "inventoryId": "inventory-id",
  "cases": [
    { "caseKey": "T1", "name": "Todoを作成できる", "file": "web/src/todo.test.tsx" }
  ]
}
```

- caseは`caseKey`、`name`、`file`の3 fieldだけとする。
- runner、discovery level、declared condition IDs、source snapshotはDBへ保持し、model projectionから除外する。
- supported runnerのactive discoveryが失敗した場合、candidateを成功payloadとして返さずtyped failureにする。

既存`caseKey`自体をinventory内限定の`T1`、`T2`形式へ変更し、別aliasは追加しない。caseをrunner、relative file、canonical nameで安定sortしてから採番する。参照の正本は常に`inventoryId + caseKey`であり、別inventoryの同じshort keyを再利用しない。

既存の長いcaseKeyはopaque keyとして読み取り可能なまま残し、migrationしない。

### 5.2 Mapping

現在のexact selection contractを維持する。

```json
{
  "verificationDocumentId": "document-id",
  "inventoryId": "inventory-id",
  "mappings": [
    { "caseKey": "T1", "conditionIds": ["AC-001"] }
  ]
}
```

- name、file、runnerを再入力させない。
- 同じcaseを複数conditionへmappingできる。
- unknown、candidate、foreign、stale keyを拒否する。
- 全selectionが有効な場合だけtransactionで一括保存する。
- similarity matchingを復活させない。

### 5.3 Test execution

基本inputを次に限定する。

```json
{ "command": "bun run test", "checkKind": "test" }
```

共通optional inputとして`cwd`、`timeoutSeconds`、`displayMode`だけを残す。model-facing schemaから`runId`、`verificationDocumentId`、`conditionIds`、`evidenceKinds`、`runnerHint`を除外する。

Task、Run、active Verification Documentはrequest context、condition IDsはmapping、evidence kindはconditionの`expectedEvidence`から解決する。

command gateはVerification Documentのplanned commandを`command + cwd`でexact照合し、保存済み`conditionIds`と`evidenceKinds`を使う。planned commandがないcommand gateをLLMのad hoc入力で補完せず、`COMMAND_GATE_PLAN_MISSING`を返す。automated test conditionでは`commands: []`を許容する。

### 5.4 Result projection

test成功時:

```json
{ "status": "passed", "parsed": 171, "resolved": 171 }
```

evidence取得失敗時:

```json
{
  "status": "evidence_error",
  "reason": "TEST_EVIDENCE_CAPTURE_FAILED",
  "parsed": 171,
  "resolved": 0,
  "retryable": false
}
```

lint、typecheck、build等では`parsed`と`resolved`を省略する。完全command result、stdout/stderr、artifactはtool recordへ保持し、通常のmodel projectionへ常時含めない。

completion projectionは次に限定する。

```json
{
  "ready": false,
  "reason": "MAPPED_TEST_NOT_RUN",
  "suggestedAction": "run_check",
  "readinessDigest": "digest"
}
```

Receiptがある場合だけ`receiptDigest`を追加する。UIとaudit queryの完全snapshotは維持する。

## 6. Identityとstructured capture

### 6.1 Identity

新しいlocatorを作らず、既存の3要素だけで照合する。

```text
runner + relative file path + normalized test name
```

test nameの共通正規化はNFKC、locale非依存lowercase、`>`前後の空白化、連続空白の縮約、trimだけとする。この処理はrunnerが返したtest identityにだけ適用し、Task本文やerror messageの分類には使わない。

- current active inventoryはcanonical nameの完全一致を要求する。
- legacy static inventoryだけ現在のsuffix互換を残す。
- file pathはinventory cwdとevidence cwdからabsolute pathへ解決する。
- fileなし、runner unknown、複数一致は推測で解決しない。
- JUnitはreport形式として扱い、新規evidenceのrunnerへ`junit`を保存しない。
- legacy `runner=junit`は読み取り互換のため直ちに削除しない。

### 6.2 Host-owned capture

`run_check(checkKind="test")`は実行前に、active Document、current inventory、mapping、runner、test scope、safeなreporter追加可否を確認する。

- known Vitest commandにstructured reporterがなければJSON reporterを1回だけ追加する。
- package scriptとraw runner commandの意味を変えず、argumentだけを追加する。
- 実際に実行したcommandをevidenceへ保存し、command policyを再適用する。
- 解決不能時は別commandを推測せず、実行前にnon-retryable failureを返す。
- capture失敗後にJSON、JUnit、coverageを順番に試すhidden retryを行わない。
- report formatは実行時だけ扱い、DB schemaへ追加しない。

### 6.3 Evidence kind

resolved caseKeyからmappingとconditionを引き、caseごとのspecific automated kindを導出する。generic `automated_test`とspecific kindが併記されていればspecificを使う。同じcaseが互換性のない複数specific kindへmappingされていれば拒否する。run-level kindはcase evidenceのunionとして保存する。

### 6.4 Capture状態

新しいDB列は追加しない。structured parserは内部的に「形式を認識できたか」とcasesを返し、認識できた出力には既存`parsedArtifactId`を保存する。

| 状態 | 既存recordからの導出 |
| --- | --- |
| usable | `parsedArtifactId`あり、必要なmapped caseが一意にresolved |
| empty | `parsedArtifactId`あり、parsed caseが0件 |
| capture failed | `parsedArtifactId`なし、またはmapping対象caseのidentity解決に失敗 |
| test failed | commandまたはmapped caseがfailed |

`testExecutionObserved`はstructured testcaseが実際にparseされた場合だけtrueにする。command classifierの`build_test`判定だけでtrueにしない。

full test suite内のmapping対象外caseがinventoryへ解決できなくても、それだけでrequired conditionを失敗させない。未解決caseは監査情報として保持し、completionではrequired mappingのcaseKeyがresolved executionに存在するかを評価する。mapping対象caseに対応し得るexecutionがambiguousまたはidentity不一致の場合だけcapture failureとする。

## 7. Failure contract

| Reason | 意味 | suggested action |
| --- | --- | --- |
| `TEST_INVENTORY_MISSING` | current active inventoryなし | collect inventory |
| `CONDITION_MAPPING_MISSING` | required mappingなし | record mapping |
| `MAPPED_TEST_NOT_RUN` | mapped executionなし／empty | run test |
| `MAPPED_TEST_FAILED` | mapped case failed | implementation/testを修正 |
| `TEST_EVIDENCE_CAPTURE_FAILED` | parserまたはidentity解決失敗 | host障害としてblock/report |
| `TEST_IDENTITY_AMBIGUOUS` | 複数caseが一致 | test identityを一意化 |
| `TEST_EVIDENCE_STALE` | source変更後のevidence | current sourceで再取得 |
| `VERIFICATION_SCOPE_DENIED` | Questionnaire対象外 | 実行しない |
| `COMMAND_GATE_PLAN_MISSING` | planned commandなし | Feature Planを修正 |

capture／identity failureは`retryable=false`とし、`run_structured_tests`を返さない。process起動等、既存policyで明示された一時障害だけretryableにできる。`CONDITION_CASE_DETAILS_MISSING`はlegacy read用に残し、新規capture failureへ使わない。

## 8. 実装フェーズ

### Phase 0: 回帰fixture

- 現在のexact mapping差分をbaselineとして固定する。
- `Suite > case`と`Suite case`の不一致を最小fixtureで再現する。
- integration testがcaseKeyを手動注入してresolverを迂回している箇所を修正対象として固定する。

### Phase 1: Inventoryとidentity

主な対象:

- `api/modules/codingAgent/verification/test-inventory.service.ts`
- `api/modules/codingAgent/verification/test-evidence-mapping.service.ts`
- `api/modules/codingAgent/verification/execution-case-identity.ts`
- `api/services/verification/adapters/vitest-json.ts`
- `api/services/verification/adapters/junit.ts`
- `api/modules/codingAgent/runtime/native-api-runner/native-api-tool-result-projector.ts`

実施:

1. caseの安定sortとshort key採番を追加する。
2. active-onlyの3-field inventory projectionを追加する。
3. test name/path正規化をpure functionへ集約する。
4. JUnit formatとactual runnerを分離する。
5. unknown、candidate、stale、ambiguousをfail closeする。

### Phase 2: Host-owned scopeとcapture

主な対象:

- `api/modules/codingAgent/verification/run-check-evidence-scope.service.ts`
- `api/services/worker-tools/run-check.ts`
- `api/services/worker-tools/dispatcher.ts`
- Native API／MCP tool schemaとmanifest

実施:

1. model-facing test inputから再宣言fieldを削除する。
2. Document、mapping、conditionからscopeとkindを導出する。
3. command gateをplanned commandへexact bindingする。
4. known Vitest commandへstructured reporterを追加する。
5. parser認識時に`parsedArtifactId`を保存する。
6. parsed/resolved件数とcapture statusをcompact projectionへ返す。
7. `testExecutionObserved`のclassifier fallbackを削除する。

### Phase 3: Completion reasonとprompt

主な対象:

- `shared/modules/codingAgent/evidence-assurance-contract.ts`
- `shared/modules/codingAgent/evidence-check-contract.ts`
- `api/modules/codingAgent/verification/acceptance-condition-assurance-evaluator.ts`
- `api/modules/codingAgent/verification/evidence-readiness.service.ts`
- `api/modules/codingAgent/runtime/native-api-runner/native-api-tool-result-projector.ts`
- `api/systemContexts/contexts/codingAgent/completion-rule.context.toml`

実施:

1. not-run、empty、capture failure、test failureを分離する。
2. capture failureへ`run_structured_tests`を返さない。
3. completion projectionを4 field中心へ縮小する。
4. SystemContextから`evidenceKinds`と`runnerHint`の指定要求を削除する。
5. generated catalogはgeneratorで再生成する。

### Phase 4: 検証

- unit、contract、integration regressionを実行する。
- Project正本verifyを実行する。
- Todo CRUD相当の実RunをTerraとLunaで各1回確認する。
- model-visible payloadに不要fieldがないことを保存結果で確認する。

## 9. Test plan

最低限、次を自動化する。

1. `Suite > case`と`Suite case`が一致する。
2. NFKC、case、空白が決定的に正規化される。
3. file違いとduplicate名を誤結合しない。
4. JUnit入力をactual Vitest runnerとして解決できる。
5. short key、legacy key、candidate拒否、stale拒否が成立する。
6. generic＋specificはspecificへ正規化され、複数specificは拒否される。
7. scope外testをcommand実行前に拒否する。
8. classifierだけで`testExecutionObserved=true`にならない。
9. parser認識済み0件とparser未認識を`parsedArtifactId`で区別する。
10. mapping対象のunresolved caseを`TEST_EVIDENCE_CAPTURE_FAILED`へ分類し、無関係なunresolved caseはrequired conditionを失敗させない。
11. model-facing inventory caseが3 fieldだけである。
12. model-facing test inputに`runnerHint`、`conditionIds`、`evidenceKinds`がない。
13. compact test resultは成功時3 field、capture失敗時5 field以内である。
14. compact completion resultはReceiptなしで4 fieldである。

integration testは次の実経路を通し、caseKeyをevidenceへ手動注入しない。

```text
active Vitest inventory
  -> short caseKey mapping
  -> run_check(Project test command)
  -> host-added reporter
  -> parser
  -> identity resolver
  -> evidence persistence
  -> assurance
  -> completion readiness
```

## 10. Acceptance criteria

1. Inventory projectionは`inventoryId`とactive casesだけを返し、各caseは`caseKey`、`name`、`file`だけを持つ。
2. `inventoryId + short caseKey`のexact mappingがatomicに保存され、foreign、candidate、stale keyは拒否される。
3. runner、file、canonical nameが一致すれば、表示separator差にかかわらず同じcaseKeyへ解決される。複数一致は解決しない。
4. `run_check`は`command`と`checkKind="test"`だけでscope、kind、runner、reporterを解決し、managed case evidenceを保存できる。
5. Feature Planのtest scope外は実行前に拒否され、LLMのad hoc入力でscopeを拡張できない。
6. command成功、empty execution、test failure、mapping対象のcapture failureが別状態になり、無関係な未解決caseはrequired conditionを失敗させない。
7. capture failureはnon-retryableで、completionがstructured test再実行を誘導しない。
8. 実Vitest inventoryから実structured resultまで通すintegration testが成功する。
9. current source、Run、Document、mapping、Project verify、Receiptの既存strict bindingを弱めない。
10. TerraとLunaがrunner、reporter、condition IDs、evidence kindをtest実行時に再入力せず、成功またはtyped host failureまで到達できる。

## 11. Compatibilityとリスク

- DB migrationは行わず、legacy long keyと`runner=junit`を読み取れる状態を維持する。
- legacy evidenceを推測でsafe passへ昇格しない。
- 外部の非LLM API互換が必要ならtransport boundaryだけでlegacy inputを受理し、provider schemaへ再公開しない。
- reporterを安全に追加できないcommandは別commandへ変換せず、実行前typed failureにする。
- active discovery失敗をcandidate成功として隠さない。
- short keyはinventory外で再利用せず、採番前sortをcontract testで固定する。
- compact projectionで省略した完全結果とartifactはUI／audit用に保持する。
- Confirmation Receipt state machineは変更しない。

## 12. 文書レビュー結果

初期案をレビューし、次を改善した。

1. 追加予定だった`TestCaseLocator`、suite path、location、native ID、execution profile、report format永続化を削除した。
2. 内部caseKeyとLLM向けaliasの二重化をやめ、既存caseKey自体をshort keyにした。
3. hostがProject commandを発明する案をやめ、commandはFeature PlanまたはLLM、reporter設定だけhostとした。
4. `conditionIds/evidenceKinds`の全面削除でcommand gateを壊さないよう、planned commandからhostがscopeを解決する形にした。
5. 新しいcapture status列を追加せず、既存`parsedArtifactId`、evidence run、case rowsから状態を導出する形にした。
6. 0件の有効structured resultとparser失敗を`parsedArtifactId`で区別した。
7. `cases: "171/171"`をやめ、flatな`parsed`、`resolved`にした。
8. Receipt protocol変更を分離し、今回の回帰範囲をtest evidence contractに限定した。
9. 709行あった初稿から重複したphase、test、acceptance説明を整理し、実装Agentへ渡すcontext量を削減した。

本計画は、既存strict assuranceを弱めず、model-facing dataを減らし、host内部の既存情報を一貫して解決する差分計画として実装する。
