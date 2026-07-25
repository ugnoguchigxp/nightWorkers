# 多言語テスト発見証跡・Quality Gate 実装計画

## Status

- Plan status: `proposed`
- Document created: 2026-07-18
- Document reviewed: 2026-07-18
- Target repository: `/Users/y.noguchi/Code/nightWorkers`
- Baseline HEAD: `f2769bb1ecef24a59fbfbcea04c11fb5031b5920`
- Baseline worktree: clean
- Target scope: Coding Agent tool、検証証跡、完了条件checklist、Chat検証表示
- Initial adapters: Vitest、Rust/Cargo、Go test、Java/JUnit（Gradle / Maven）
- Follow-up adapter candidate: pytest

## 1. 目的

Coding Agentが登録済みrepository内のアクティブなテストケースを発見し、その発見証跡、テスト実行証跡、Full Verify成功証跡を同一workspace snapshot上で照合できるようにする。

「証跡を保存済み」を単なるcommand logの保存と区別し、次の1〜4が揃った場合だけQuality Gate通過を返す。5は`unit_test`を要求する個別完了条件を確認済みにするための追加条件とする。

1. runnerまたは信頼できる静的collectorがアクティブなテストケースを1件以上発見した。
2. 発見したテスト対象に対する実テスト実行が観測され、対象結果が成功した。
3. Full Verifyが成功した。
4. 発見、テスト実行、Full Verifyが同一のsource stateに対して行われた。
5. `unit_test`を要求する完了条件では、対応するテスト定義と成功結果が同じconditionへ構造的に紐付いている。

Quality Gate通過とTaskの完了条件充足は別のprojectionとして扱う。Quality Gate通過はrepositoryの検証基盤が有効に動いたことを示すが、すべてのTask完了条件がtestcaseで検証されたことを単独では意味しない。`completion_check`は両者を同じ応答で返すが、片方の成功からもう片方を推測しない。

この仕組みは、現行Coding Agentの単一runtimeとLLM所有のTodo・次action・検証判断を維持する。hostは証跡の構造、repository境界、revision、実行結果、idempotencyだけを保証し、Task本文、Todo名、ユーザー文言、error messageのkeywordや正規表現から次actionまたは完了可否を決めない。

## 2. 現状と問題

### 2.1 現在確認できる事実

- `run_check`はcommand、終了コード、stdout/stderr artifact、任意のJUnit testcaseを保存できる。
- `completion_check`は現在のverification checklist projectionを読み、required conditionの状態を返す。
- `NormalizedTestCaseEvidence`にはtest name、file path、status、condition IDsを保持できる。
- `project_exploration_catalog`は関連test fileとverification commandの候補を返すが、すべて`candidate`であり、アクティブなtestcaseの存在証明ではない。
- 現在は成功commandへ`conditionIds`を指定すると、個別testcaseがなくてもconditionを`covered`にできる。
- Full Verify成功にcondition単位のtestcase対応がなければ`verified_by_gate`となり、required conditionの完了状態にはならない。この境界は維持する。

### 2.2 解決する問題

現在の「証跡を保存済み」は、次を区別できない。

- テスト候補fileがあるだけ。
- runnerがtestcaseを収集できた。
- testcaseが実行された。
- Full Verify script内でtestが実行された。
- Full Verifyは成功したが、test stageが0件またはskipされていた。
- 発見後にsourceまたはtestが変更され、古い証跡になった。

この区別がない状態では、終了コード0の`verify`だけから「アクティブなテストが存在し、実行され、Quality Gateが通った」と確約できない。

## 3. 採用する設計判断

### 3.1 比較

| 案 | 概要 | 利点 | 問題 | 判断 |
| --- | --- | --- | --- | --- |
| A. `verify`の副作用 | `run_check(checkKind=verify)`の内部でtest discoveryも暗黙実行する | 呼び出し回数が少ない | `verify`の意味が隠れて変わる。discovery失敗とverify失敗を分離しづらい。runner discoveryがcompileやbuild scriptを起動する場合、予期しない副作用になる | 不採用 |
| B. 実行型の上位tool | `run_quality_gate`がdiscovery、test、verify、completionを固定順序で実行する | 1 toolで完結する | 固定workflowと意味別toolを増やし、Coding AgentがTaskとTodoから次actionを決める所有権をhostへ戻す。部分再実行や失敗修正も不自然になる | 不採用 |
| C. 明示tool + 上位判定 | Coding Agentが`collect_test_inventory`と`run_check`を必要に応じて呼び、`completion_check`が証跡を結合する | 各責務が明確。失敗からLLMが次actionを選べる。既存runtimeへ自然に追加できる | tool callが複数になる | 採用 |

### 3.2 Locked Decision

新しい実行型`run_quality_gate`は作らない。`verify`へtest discoveryの隠れた副作用も追加しない。

上位概念は、実行を所有するtoolではなく、既存`completion_check`を拡張したread-onlyのQuality Gate判定とする。

`completion_check`は次の独立した結果を返す。

- `qualityGate`: active test、test execution、Full Verify、source freshnessのrepository-level評価。
- `conditions`: conditionごとのexpected evidence、test definition、test execution、明示mappingの評価。

`qualityGate.status=passed`でもrequired conditionが未確認なら全体のverification checklistは完了しない。逆にmanual conditionだけのTaskでQuality Gateが対象外でも、manual evidenceの条件判定をQuality Gateへ読み替えない。

標準的な観測順は次のとおりだが、hostはこの順序をruntime workflowとして強制しない。

```text
Coding Agent
  |
  | Task / Todo / specificationから必要性を判断
  v
collect_test_inventory  ※inventoryを単独確認したい場合だけ
  |
  | typed inventory evidence
  v
record_test_condition_mapping  ※Schema evidence setを一括解決・保存。current inventoryはtool内で再収集
  |
  | typed mapping evidence
  v
run_check(checkKind="test" または "verify")
  |
  | typed execution evidence
  v
run_check(checkKind="verify")  ※別test実行が必要な場合
  |
  | full-gate evidence
  v
completion_check
  |
  +-- quality gate passed
  +-- missing inventory
  +-- test execution unobserved
  +-- verify failed
  +-- stale snapshot
  +-- required condition test missing
```

`completion_check`のtyped failureを受けた後、inventory取得、focused test、verify再実行、source修正、Todo再計画のどれを行うかはCoding Agentが判断する。hostはTodoを暗黙更新しない。

## 4. 用語とQuality Gate契約

### 4.1 発見レベル

```ts
type TestDiscoveryLevel =
  | "runner_collected"
  | "static_collected"
  | "file_candidate";
```

- `runner_collected`: runner自身が実行対象として収集したtestcase。
- `static_collected`: runner公式のstatic collectorがtestcaseとして収集したもの。dynamic生成を見落とす可能性はadapter capabilityへ記録する。
- `file_candidate`: file path、拡張子、project config等からtest候補と判定しただけのもの。アクティブtestcaseの証明には使わない。

ファイル名傾向は候補探索と診断にだけ利用する。ファイル名だけでQuality Gateを通さない。

### 4.2 アクティブtestcase

`active`は、対象runnerのcollectorが現在のselection scopeで実行対象として返したcaseを意味する。`skip`、`ignore`、disabled、候補fileだけの状態はactive件数へ含めない。runnerが状態を返さない場合は`unknown`とし、execution evidenceによってactiveかつ実行済みであることを補完する。

### 4.3 Quality Gate式

```ts
qualityGatePassed =
  inventory.activeCaseCount > 0 &&
  testExecution.observedCaseCount > 0 &&
  testExecution.failedCaseCount === 0 &&
  verify.exitCode === 0 &&
  inventory.workspaceDigest === testExecution.workspaceDigest &&
  testExecution.workspaceDigest === verify.workspaceDigest &&
  executionScopeCoversInventory === true;
```

`verify.exitCode === 0`だけでは`testExecution.observedCaseCount > 0`を満たさない。Full Verifyがtest resultを構造化出力しない場合は、Coding Agentが別途`run_check(checkKind="test")`を実行し、その証跡とFull Verify証跡を`completion_check`で結合できる。

### 4.4 完了条件との結合

`verificationKind=automated_test`かつ`expectedEvidence`に`unit_test`を含むrequired conditionは、次のすべてを必要とする。

1. active testcaseに対し、source内の構造markerまたはcurrentなCoding Agent assessmentとして対象condition IDのmapping evidenceがある。
2. test definitionのfile pathがrepository内に実在する。
3. test definition取得時のfile digestと実行時snapshotが一致する。
4. 同じstable test IDまたはadapterが保証する同一scopeのexecution evidenceがある。
5. 対応executionが`passed`である。

成功commandへcondition IDを付けただけのcommand-level evidenceは、`unit_test` conditionを完了させない。command gate、typecheck、lint、build等は、それぞれの`expectedEvidence`とcheck kindが一致する場合に限って従来のcommand-level coverageを利用できる。

### 4.5 Condition mappingの所有権

testcaseと完了条件の意味上の対応をhostがtest名、file名、Task本文、error messageから推測しない。Schemaのtest evidence setがconditionと期待test identityの対応を明示し、hostはそのidentityをcurrent inventoryへ解決する。identity解決では表記揺れを許容するためPure TypeScriptの決定的な類似度を使い、test名と指定file pathがそれぞれ90%以上一致した場合だけ同一testとして扱う。

```ts
type TestConditionMappingSource =
  | "declared_in_test"
  | "coding_agent_assessment"
  | "schema_evidence_set";
```

- `schema_evidence_set`: Schemaがtest identityとcondition IDの対応を明示し、toolがcurrent inventory上の同一testを90%以上のidentity一致率で解決する。

`declared_in_test`と`coding_agent_assessment`は既存の永続化済みrecordを読み出すためだけにschemaへ残す。公開toolの書き込みcontractは`schema_evidence_set`だけであり、旧来の1件mappingやassessmentを書き込む選択肢は公開しない。

serverはcase、condition、inventory、source digest、revision、idempotencyを検証するが、rationaleの意味的妥当性は判定しない。意味上の十分性はCoding Agentが所有し、Mission Pilot起動中はMission Pilotがその結果を評価する。

## 5. Tool契約

### 5.1 `collect_test_inventory`

Coding Agentが明示的に呼ぶworker toolとして追加する。

```ts
type CollectTestInventoryInput = {
  roots?: string[];
  verificationDocumentId?: string;
  adapterHints?: Array<
    "vitest" | "cargo" | "cargo-nextest" |
    "go-test" | "junit-platform" | "gradle" | "maven"
  >;
  timeoutSeconds?: number;
};

type CollectTestInventoryOutput = {
  inventoryId: string;
  workspaceSnapshot: WorkspaceSourceSnapshot;
  adapters: TestInventoryAdapterResult[];
  files: TestDefinitionFileEvidence[];
  cases: TestDefinitionCaseEvidence[];
  summary: {
    candidateFiles: number;
    collectedCases: number;
    activeCases: number;
    skippedCases: number;
    unknownCases: number;
    declaredConditionIds: string[];
    undeclaredRequiredConditionIds: string[];
  };
  warnings: TestInventoryWarning[];
};
```

入力pathはregistered Projectのexecution root相対とする。server側でrealpath、allowed/denied path、symlink escape、timeout、output上限を検証する。adapterやdependencyを自動installしない。

このtoolはrepository sourceを変更しない。ただしCargo compile cache、Gradle configuration、runner cache等が生成される可能性があるため、MCP annotationを単純な`readOnlyHint=true`にしない。`destructiveHint=false`とし、tool resultへ実際に選択したdiscovery methodと観測されたbuild/cache side effectを返す。

### 5.2 `record_test_condition_mapping`

旧来の1 mapping単位の入力は廃止する。Schema化されたtest evidence setを1回で受け取り、current source stateの技術スタック別inventoryを収集し、全参照を解決してからmappingを一括保存する。

```ts
type RecordTestConditionMappingInput = {
  verificationDocumentId: string;
  cwd?: string;
  evidenceSet: {
    version: 1;
    references: Array<{
      testName: string;
      filePath?: string;
      runner?: VerificationRunner;
      conditionIds: string[];
    }>;
  };
};

type RecordTestConditionMappingOutput = {
  inventoryId: string;
  sourceDigest: string;
  matchThreshold: 0.9;
  referenceCount: number;
  mappingCount: number;
  matches: Array<{
    referenceIndex: number;
    caseKey: string;
    score: number;
  }>;
};
```

serverは次を検証する。

- verification documentとconditionがrequest-scoped taskに属する。
- repository境界内をPure TypeScriptで走査し、技術スタック別の構造的なtest宣言として確認できたactive caseだけを候補にする。このtool内ではtest runnerや別worker toolを起動しない。
- Unicode、大小文字、空白、句読点を正規化したLevenshtein比率でtest identityを比較する。
- test名は90%以上、file path指定時はfile pathも90%以上一致する。
- runner指定時はrunnerが一致する。
- 未発見は`TEST_EVIDENCE_NOT_FOUND`、90%以上一致する候補が複数あればscore差にかかわらず`TEST_EVIDENCE_AMBIGUOUS`として参照index付きで返す。
- 全参照が解決し、source snapshotがcurrentな場合だけinventoryとmappingを同じtransactionで一括保存する。

toolはTodo、Task、Run statusを更新しない。Coding Agentが記録したmappingはprovenance付きappend-only evidenceとして保存する。

### 5.3 `run_check`

既存tool名と単一command contractを維持する。test discoveryを内部で暗黙実行しない。

次を追加する。

- command開始前後の`WorkspaceSourceSnapshot`。
- adapterが認識したstructured test result artifact。
- `testExecutionObserved`、`observedCaseCount`、`executionScopeId`。
- report artifactの作成時刻またはdigest検証。過去runのstale reportを再利用しない。
- `checkKind=verify`でもtest resultを観測できた場合はexecution evidenceを保存する。ただし観測できない場合は推測で`testExecutionObserved=true`にしない。
- command前後でsource stateが変化した場合は`sourceMutatedDuringCheck=true`を返し、その実行をcurrentなQuality Gate証跡へ使わない。

### 5.4 `completion_check`

実行は行わず、最新または指定されたverification documentに対する証跡を読み、Quality Gateとcondition checklistを返す。

```ts
type QualityGateAssessment = {
  status: "passed" | "failed" | "unknown";
  inventoryId?: string;
  testEvidenceRunIds: string[];
  verifyEvidenceRunId?: string;
  workspaceDigest?: string;
  activeTestCases: number;
  observedTestCases: number;
  failedTestCases: number;
  reasons: QualityGateReason[];
};
```

- `passed`: 必須証跡がすべてcurrentで成功している。
- `failed`: currentなtest executionまたはverifyに明示的な失敗がある。
- `unknown`: inventory、execution、verify、scope、freshnessのいずれかが不足またはpartialで、成功・失敗を確定できない。

主なreason code:

- `MISSING_TEST_INVENTORY`
- `NO_ACTIVE_TESTS`
- `CANDIDATE_FILES_ONLY`
- `TEST_EXECUTION_NOT_OBSERVED`
- `TEST_CASE_FAILED`
- `VERIFY_EVIDENCE_MISSING`
- `VERIFY_FAILED`
- `WORKSPACE_SNAPSHOT_MISMATCH`
- `EXECUTION_SCOPE_MISMATCH`
- `REQUIRED_CONDITION_TEST_MISSING`
- `EXPECTED_EVIDENCE_KIND_MISMATCH`
- `STALE_TEST_REPORT`
- `ADAPTER_RESULT_PARTIAL`

結果はCoding Agentへtyped factとして返す。`completion_check`はTask、Todo、Runを更新しない。

### 5.5 既存verification経路の扱い

Quality Gateを迂回できる第二の正本を残さない。

- 既存`run_verification`は、利用箇所を`run_check(checkKind="verify")`へ移行した後にCoding Agent tool catalogから削除する。互換期間が必要なら、独自実装を持たず同じ`run_check` application commandへ変換する薄いadapterとする。
- Coding Agentが直接shell commandとして実行したbroad verificationは、command実行の観測事実として履歴へ残せるが、normalized inventory / execution / verify evidenceが揃わない限りQuality Gateの正本にしない。
- Native API laneとCodex MCP laneのどちらでも、Quality Gateが受理するevidenceは同じapplication serviceとschemaを通ったものに限定する。
- unmanaged verify成功を検出して自動的にmanaged successへ昇格しない。`completion_check`が不足を返した場合、managed `run_check`で再実行するかはCoding Agentが判断する。

## 6. 正規化schemaと永続化

### 6.1 Workspace snapshot

Git HEADだけではdirty worktreeを識別できないため、source snapshotは次を含む。

```ts
type WorkspaceSourceSnapshot = {
  kind: "git" | "filesystem";
  head?: string;
  sourceStateHash: string;
  capturedAt: string;
};
```

本計画内の`workspaceDigest`は`WorkspaceSourceSnapshot.sourceStateHash`を指す共通の短縮名とする。DB、inventory、execution evidence、Quality Gate resultで別のdigest計算を実装しない。

`sourceStateHash`はtracked fileの差分、staged差分、対象となるuntracked source/test/config fileのcontent digestから作る。build output、runner cache、coverage output等はsource stateから除外する。既存Project Static Intelligenceの`sourceStateHash`と意味を共通化できる場合は、Agent非依存のpure utilityまたはportを介して再利用する。

### 6.2 Inventory evidence

```ts
type TestDefinitionCaseEvidence = {
  id: string;
  inventoryId: string;
  adapter: string;
  scopeId: string;
  filePath?: string;
  fileDigest?: string;
  fullName: string;
  location?: { line?: number; column?: number };
  state: "active" | "skipped" | "ignored" | "unknown" | "candidate";
  discoveryLevel: TestDiscoveryLevel;
  declaredConditionIds: string[];
};
```

stable case IDはadapter namespace、repository相対file path、runnerが返すfull test nameから生成する。parameterized testやdynamic subtestのID安定性はadapter capabilityへ明記し、安定IDを作れない場合はexact case coverageを主張しない。

`declaredConditionIds`はsourceに構造的に宣言されたidentifierだけを保持する。Coding Agent assessmentによるmappingはinventory rowを変更せず、別のmapping evidenceとして保存する。

### 6.3 DB

append-onlyの正本として次を追加する。

- `coding_agent_test_inventory_runs`
- `coding_agent_test_inventory_files`
- `coding_agent_test_inventory_cases`
- `coding_agent_test_condition_mappings`

各rowは`taskId`、`runId`、`verificationDocumentId`、workspace digest、adapter、raw artifact参照を保持する。再実行時に過去rowを上書きせず、新しいinventory runを追加する。

`verification_checklist_items`には、verification documentに存在する`verificationKind`と`expectedEvidence`をprojectionとして保持する。documentの正本は改変しない。

Condition mappingはsource、case、condition、rationale、source digest、作成者provenanceをappend-onlyで保持する。後続mappingは過去rowを削除せず、最新のcurrent source digestへ一致するmappingだけを現在判定へ採用する。

Quality Gate assessment自体は`completion_check`で再計算可能なprojectionとし、別のmutable正本にしない。tool resultは既存event ledgerへ残し、inventory、mapping、execution evidence IDから再現できるようにする。

## 7. Adapter architecture

### 7.1 共通interface

```ts
interface TestEvidenceAdapter {
  readonly id: string;
  probe(context: ProjectStructureContext): AdapterProbeResult;
  collect(context: TestDiscoveryContext): Promise<TestInventoryAdapterResult>;
  parseExecution(
    context: TestExecutionParseContext,
  ): Promise<NormalizedTestExecutionResult | null>;
}
```

adapter選択は`package.json`、`Cargo.toml`、`go.mod`、`pom.xml`、Gradle settings等の構造化されたProject factとLLMが明示したadapter hintから行う。Task本文、Todo名、ユーザー文言、error messageのkeyword分類で選択しない。

同じrepository内で複数adapterを実行できる。monorepoでは各adapter resultにroot、scope ID、workspace digestを持たせる。

### 7.2 Vitest

- 構造fact: package manifestと既存dependency/script/config。
- 優先discovery: `vitest list --json --static-parse`。
- static parseで扱えないdynamic definitionはwarningを返す。
- 明示的にrunner collectionが必要な場合は`vitest list --json`を使えるが、module-level codeが動く可能性をtool resultへ示す。
- execution: JSONまたはJUnit reporter artifactを正規化する。
- file fallback: configured include、`*.test.*`、`*.spec.*`、`__tests__`。fallbackだけではgateを通さない。

### 7.3 Rust / Cargo

- 構造fact: `Cargo.toml`、workspace members、既存nextest設定。
- 優先discovery: nextestが既に利用可能ならstructured list、なければ`cargo test -- --list`。
- dependencyを自動installしない。
- `cargo test -- --list`はtestを実行しないが、compile、`build.rs`、cache生成が起こり得るため、純filesystem readとは扱わない。
- execution: nextest structured outputを優先する。標準Cargo/libtestではtest result summaryとfull scopeを正規化し、exact case IDを保証できない場合は`scope_confirmed`として扱う。
- file fallback: `tests/**/*.rs`、benches、examples、source内test module候補。Rustはinline `#[cfg(test)]`が一般的なため、filename fallbackだけではactiveを主張しない。

### 7.4 Go

- 構造fact: `go.mod`、workspace、package list。
- discovery: `go test -json -list . ./...`相当をadapterが安全に構築する。
- `-list`はtop-level test、benchmark、fuzz、exampleを列挙する。dynamic subtestは実行時に初めて観測されるため、capabilityへ制限を記録する。
- execution: `go test -json`のTestEventを正規化する。
- file fallback: `*_test.go`。build tagやpackage selectionにより実行対象外になり得るため候補扱いとする。

### 7.5 Java / JUnit / Gradle / Maven

- 構造fact: `pom.xml`、`settings.gradle*`、`build.gradle*`、JUnit Platform設定、test source set。
- JUnit Platform ConsoleLauncherがProjectに存在する場合は`discover`を利用する。
- Gradleでは`Test` taskの`--test-dry-run`と生成されたJUnit XMLをinventoryとして利用できる。dry-run reportのcaseを実行成功として扱わず、definition evidenceとしてのみ保存する。
- Maven/Surefireは実行後の`target/surefire-reports/TEST-*.xml`をstructured execution evidenceとして利用する。reportはcommand開始前後のdigestまたはmtimeでfreshnessを検証する。
- Mavenで安全かつ確実な事前case discoveryが利用できないProjectでは、source fileを`file_candidate`として返す。fresh Surefire reportはexecution evidenceには使えるが、既存candidate inventoryを後から書き換えたり、事前definition evidenceの不足を自動補完したりしない。
- JUnit Platform discovery等でactive definitionを取得できないMaven Projectは、初回releaseではQuality Gateを`unknown`にする。対応範囲を過大に主張せず、将来のMaven discovery adapter追加条件をtyped capabilityとして返す。
- Gradle reportは通常`build/test-results/<task>`、Maven Surefire reportは通常`target/surefire-reports`にあるが、Project設定を優先し、固定pathだけを正本にしない。
- file fallback: configured test source set、`src/test/**`、`*Test`、`*Tests`、`*TestCase`等。custom engine、Kotlin、Groovy、parameterized testを考慮し候補扱いに留める。

### 7.6 pytest follow-up

- `pytest --collect-only -q`によるnode ID収集。
- executionは`--junitxml`を正規化。
- file fallbackはpytest configの`python_files`を優先する。

pytest adapterは共通interfaceの妥当性確認に使うが、初回releaseを阻害する場合は後続Taskへ分離できる。Vitest、Cargo、Go、Javaのcontractをpytestだけの都合で歪めない。

## 8. Coding Agent module境界

新しいAgent固有production codeは`api/modules/codingAgent`配下へ置く。

目標構成:

```text
api/modules/codingAgent/verification/
  domain/
    test-evidence-contracts.ts
    quality-gate-assessment.ts
  application/
    collect-test-inventory.ts
    evaluate-quality-gate.ts
    record-verification-evidence.ts
    record-test-condition-mapping.ts
  adapters/
    vitest.adapter.ts
    cargo.adapter.ts
    go-test.adapter.ts
    junit-platform.adapter.ts
    gradle.adapter.ts
    maven-surefire.adapter.ts
    junit-xml.adapter.ts
    file-candidate.adapter.ts
  infrastructure/
    verification-evidence.repository.ts
    workspace-source-snapshot.ts
  tools/
    collect-test-inventory.tool.ts
    record-test-condition-mapping.tool.ts
    run-check.tool.ts
    completion-check.tool.ts
    tool-contracts.ts
```

`run_check`、`completion_check`、verification repositoryのうち今回変更するCoding Agent固有責務は、このmoduleへ移す。`api/services/worker-tools`や`api/modules/nightworkers`へ新しいrole固有分岐を追加しない。outer compositionはCoding Agentのpublic APIまたはportを呼ぶだけとする。

Mission PilotがQuality Gate結果を読む必要がある場合、Coding Agent内部serviceまたはrepositoryを直接importしない。両roleで同じ意味を持つnormalized evidence summaryまたはeventだけを`agentsShare`のcontract / port / eventとして公開する。`agentsShare`へtool、route、repository、role判定を置かない。

Frontendの表示modelと純粋projectionは`src/modules/codingAgent`へ置き、NightWorkers timelineは公開された表示modelを利用するだけとする。

## 9. Coding Agentから自然に利用できるための変更

### 9.1 Tool description

tool descriptionは固定workflowを命令せず、次の利用条件と保証範囲を日本語で明示する。

- `collect_test_inventory`: 完了条件が自動test証跡を要求する場合、またはtest定義の存在を確認する必要がある場合に、現在source stateのtest inventoryを取得する。
- `record_test_condition_mapping`: Schemaのtest evidence setをPure TypeScriptで探索したcurrent inventoryへ90%以上のidentity一致率で解決し、inventoryと全mappingを一括保存する。未発見または複数候補はtyped errorとして返す。
- `run_check`: 選択したcheck commandを実行し、結果と構造化証跡を返す。inventoryを暗黙生成しない。
- `completion_check`: 現在保存されているinventory、test execution、verify、condition evidenceを読み、未確認理由をtyped resultで返す。

共通description、input schema、output schema、reason codeは定数またはbuilderへまとめ、Native API laneとCodex MCP laneで同じcontractを使用する。

### 9.2 System Context

Coding Agent System Contextへ次の原則を追加する。

- Task、Feature Plan、current Todoが`unit_test`等のtest証跡を要求する場合、完了判断前にtest definitionの存在と実行結果を確認する。
- testcaseとconditionの意味対応は、source内の構造markerまたはCoding Agentの明示assessmentとして記録し、hostの類似判定へ委ねない。
- test inventoryが必要かはTaskとTodoからLLMが判断する。
- `completion_check`がmissing/stale evidenceを返した場合、どのtoolを再実行するかはLLMが判断する。
- Evidenceや特定commandをすべてのTaskへ一律に要求しない。

System Contextはtool名の固定順序をworkflowとして列挙しない。Todo statusはtool結果から暗黙更新しない。

### 9.3 Runtime lanes

- Native API: tool manifest、registry、dispatcher、result projectorへ同一contractを追加する。
- Codex SDK: NightWorkers MCPへ同一contractを公開し、audit/event ledgerへinventory evidence IDを残す。
- 既存`run_verification`と直接shell verificationを、managed Quality Gate evidenceの迂回経路にしない。
- runtime laneによってadapter、Quality Gate式、reason codeを変えない。
- tool availabilityをlegacy execution modeやTodo metadataで切り替えない。

## 10. UI表示

「証跡を保存済み」と「検証チェック完了」を分離する。

推奨表示:

```text
テスト定義      24件確認（runner collected）
テスト実行      24件成功 / 0件失敗
Full Verify     成功
Source state    current
完了条件        8 / 8件確認済み
Quality Gate    通過
```

候補しかない場合:

```text
テスト候補      6 files
アクティブtest  未確認
Quality Gate    未確認
```

表示はeventとstored evidenceから投影し、UIがcommand文字列、file name、test nameを再解釈しない。過去のinventoryとverify成功は履歴として保持し、source stateが変わった場合は削除せず`stale`を表示する。

Quality Gateと完了条件を一つの成功labelへ潰さず、それぞれの状態を表示する。Quality Gateが通っていてもcondition mappingが不足している場合は「Quality Gate通過 / 完了条件未確認」と表示できるようにする。

## 11. 実装フェーズ

### Phase 0: Baselineとownership固定

1. 現行`run_check`、`completion_check`、JUnit adapter、verification repository、両runtime laneのtool registrationを対象test付きで記録する。
2. 現在の`bun run verify`、focused verification tests、architecture checkをbaselineとして実行する。
3. 変更対象のCoding Agent固有verification codeを列挙し、module移動範囲を固定する。

完了条件:

- baseline commandと結果が記録されている。
- 移動対象と互換境界が明記され、`nightworkers`または`services`へ新しいAgent固有実装を追加しない方針が固定されている。

### Phase 1: Contractとsource snapshot

1. inventory、adapter result、discovery level、workspace snapshot、Quality Gate reason codeのschemaを追加する。
2. source state hashを計算するpure utility / portを実装する。
3. verification checklist projectionへ`verificationKind`と`expectedEvidence`を保持するmigrationを追加する。
4. inventoryとcondition mappingのappend-only table / repositoryをCoding Agent moduleへ追加する。

完了条件:

- dirty worktreeとuntracked test fileを含むsource stateの変化を検出できる。
- build outputだけの変化でsource stateがstaleにならない。
- invalid schema、duplicate case ID、repository外pathを拒否できる。

### Phase 2: `collect_test_inventory` coreとVitest adapter

1. tool contract、service、persistence、raw artifact保存を実装する。
2. Vitest static list JSON adapterを実装する。
3. generic file candidate adapterを実装する。
4. `record_test_condition_mapping`とserver-side revision / digest validationを実装する。
5. Native APIとCodex MCPの両方へ同じtoolを公開する。

完了条件:

- Vitest testcaseをfile pathとfull name付きで収集できる。
- test fileだけでcaseがない場合を0 activeとして返す。
- candidate fallbackだけではQuality Gateが通らない。
- declared markerとCoding Agent assessmentを区別してcondition mappingを保存できる。
- toolはsource fileを変更せず、自動dependency installを行わない。

### Phase 3: Rust、Go、Java adapters

1. Cargo / nextest discoveryとexecution parserを実装する。
2. Go list / JSON execution parserを実装する。
3. JUnit Platform / Gradle dry-run inventoryを実装する。
4. Maven Surefire / Gradle JUnit XML execution parserを実装する。
5. 各adapterへcapability、partial reason、side-effect observationを持たせる。

完了条件:

- 各言語fixtureでactive、skip、0件、failureを区別できる。
- Rust inline test、Go build tag、Go subtest、Java custom source setの制限をpartial reasonとして返せる。
- filename fallbackをactiveへ昇格しない。

### Phase 4: `run_check` execution evidence強化

1. command前後のsource snapshotを保存する。
2. fresh report artifactだけを解析する。
3. test execution observed、case count、scope IDを保存する。
4. `checkKind=verify`でtest evidenceを観測できない場合を明示する。
5. `run_verification`互換経路を同じmanaged application commandへ収束させ、unmanaged shell結果をQuality Gateへ昇格しない。
6. 既存stdout/stderr artifactと過去証跡を維持する。

完了条件:

- exit code 0、test 0件、全skipをQuality Gate成功としない。
- stale JUnit XMLを再利用しない。
- command中にsource stateが変化した場合はcurrent evidenceとして採用しない。
- verifyがtest結果を出さない場合、Full Verify成功とtest実行未確認を同時に表現できる。

### Phase 5: Checklist matcherと`completion_check`

1. expected evidence kindをmatcherへ渡す。
2. unit test conditionではcase-levelまたはadapter保証scope evidenceを必須にする。
3. declared markerまたはcurrentなCoding Agent assessment mappingをcondition判定へ結合する。
4. inventory、test execution、verifyをworkspace digestで結合する。
5. Quality Gateとcondition checklistを独立projectionとして返す。
6. command-level condition mappingとfull-gate fallbackの既存境界を回帰testで固定する。

完了条件:

- active discovery + test success + verify success + same source stateでQuality Gateが通る。
- いずれかが欠けた場合はtyped reason付きで通らない。
- Quality Gateが通ってもcondition mapping不足ならverification checklistは完了しない。
- `completion_check`はTodoまたはRunを更新しない。

### Phase 6: Coding Agent guidanceとevent/UI

1. Japanese System Contextとtool descriptionを更新する。
2. Native API / Codex SDK eventへinventoryとQuality Gate summaryを残す。
3. Chat cardと既存verification artifactのread-only projectionを新しい状態へ対応させる。
4. `completion_check`を観測しただけでunit test stepをpassedにするUI projectionを削除し、typed resultから状態を表示する。

完了条件:

- Coding Agentがmissing inventory resultを読んで、同じruntime内で次actionを選べる。
- hostによる固定tool順序、暗黙Todo更新、semantic recovery promptを追加していない。
- 「証跡保存」「test定義確認」「test実行」「Quality Gate通過」が区別される。

### Phase 7: Module境界整理とcloseout

1. 今回触れたCoding Agent固有verification実装を`api/modules/codingAgent`へ集約する。
2. composition root以外のlegacy deep importを削除する。
3. architecture checkへ、Agent固有test evidence toolが`services`、`nightworkers`、`planMode`へ再導入されない検査を追加する。
4. docs、schema、migration、fixtures、focused tests、full verifyを実行する。

完了条件:

- Mission PilotとCoding Agent間のdirect importがない。
- `agentsShare`にrole固有tool、repository、prompt、判定を置いていない。
- architecture、typecheck、focused test、Full Verifyがgreenである。

## 12. Test計画

### 12.1 Schema / repository

- inventory schemaがunknown field、repository外path、不正condition IDを拒否する。
- append-only inventory runが再実行で上書きされない。
- evidence IDとcase IDがidempotentに保存される。
- mapping evidenceがcase、condition、source digest、idempotencyを検証する。
- expected evidence kindがchecklist projectionへ保持される。

### 12.2 Adapter fixtures

- Vitest: static case、dynamic warning、skip、0件、parameterized name。
- Cargo: unit、integration、ignored、doc test、workspace、0件。
- Go: top-level、build tag、subtest execution、fuzz、package failure。
- Gradle/JUnit: dry-run inventory、parameterized test、skipped、custom test task。
- Maven: fresh Surefire XML、stale XML、rerun/flaky failure、0 tests。
- Maven: JUnit Platform discoveryがない場合はcandidate-only / Quality Gate unknownを返す。
- Generic fallback: test-like fileがあってもcase 0件ならcandidate-only。

### 12.3 Quality Gate matrix

| Inventory | Test execution | Verify | Snapshot | Expected |
| --- | --- | --- | --- | --- |
| active > 0 | passed > 0 | passed | same | passed |
| missing | passed | passed | same | `MISSING_TEST_INVENTORY` |
| candidate only | passed | passed | same | `CANDIDATE_FILES_ONLY` |
| active > 0 | unobserved | passed | same | `TEST_EXECUTION_NOT_OBSERVED` |
| active > 0 | all skipped | passed | same | `TEST_EXECUTION_NOT_OBSERVED` |
| active > 0 | failed > 0 | passed | same | `TEST_CASE_FAILED` |
| active > 0 | passed > 0 | failed | same | `VERIFY_FAILED` |
| active > 0 | passed > 0 | passed | different | `WORKSPACE_SNAPSHOT_MISMATCH` |
| active > 0 | passed > 0 | passed | same、scope不一致 | `EXECUTION_SCOPE_MISMATCH` |

### 12.4 Completion condition

- `unit_test` conditionにcommand-level condition IDだけを付けても完了しない。
- case definitionあり・未実行は完了しない。
- case definitionとpassed executionが同一condition、same snapshotなら完了する。
- mapped caseにfailedが1件でもあれば同一evidence run内でfailedを優先する。
- unrelated conditionのtest resultを流用しない。
- typecheck conditionへunit test evidenceだけを与えても完了しない。
- exact structural markerから作ったmapping provenanceを保持する。
- markerのないtestをhostが自動mappingしない。
- current inventory caseへのCoding Agent assessment mappingは利用できる。
- stale digest、candidate case、unknown conditionへのmapping mutationを拒否する。
- Quality Gate passedとcondition checklist incompleteを同時に返せる。

### 12.5 Runtime contract

- tool catalogはlegacy modeまたはTodo metadataに依存しない。
- Coding Agent System Contextはtest inventoryを一律必須にしない。
- tool resultでTodoを暗黙更新しない。
- `collect_test_inventory`失敗後、LLMが修正・別adapter・needs_humanを選べるtyped resultを維持する。
- Native APIとCodex MCPでinput/output schemaとreason codeが一致する。
- `run_verification`または直接shell verifyだけではmanaged Quality Gate evidenceにならない。

### 12.6 UI

- evidence保存だけではQuality Gate通過と表示しない。
- active test件数、実行件数、verify、snapshot freshnessを別々に表示する。
- source変更後は過去成功を削除せずstale表示にする。
- completion tool eventの存在だけでunit testをpassed表示しない。

## 13. Verification commands

実装時は対象fileに応じてfocused testを先に実行し、最終的に少なくとも次を確認する。

```bash
bun run test -- run \
  tests/verification-checklist/schema.test.ts \
  tests/services.verification-checklist.test.ts \
  tests/verification-adapters/junit.test.ts \
  tests/services.native-api-runner.test.ts

bun run typecheck
bun run check:architecture
bun run check:docs
bun run verify
```

新規adapter fixture testは上記focused commandへ追加する。外部toolchainが必要なlive adapter testは、unit fixture parser testと分離し、CIで利用可能なtoolchain matrixにだけ載せる。toolchainがないことをadapter成功またはtest 0件へ正規化しない。

## 14. Rollout

### 14.1 Compatibility

- 既存`run_check`と`completion_check`のtool名は維持する。
- 新しいinventoryが存在しない過去Runは`unknown / legacy evidence`として表示し、過去成功を捏造しない。
- DB migration前のverification documentは、document JSONからexpected evidenceを再投影できる場合だけ利用する。復元不能な場合は再確認を要求する。
- 新しいQuality GateをTask/Run terminal statusのhost自動gateにはしない。Coding AgentとMission Pilotはtyped resultを読み、それぞれの所有範囲で完了判断する。

### 14.2 Feature rollout

1. schema、persistence、Vitest adapterを既存単一runtimeの共通tool catalogへ追加する。
2. Native API / Codex MCPのcontract parityを確認する。
3. Cargo、Go、Java adapterをfixture test付きで追加する。
4. UIを旧証跡と新Quality Gateの両方を読める状態にする。
5. 十分な実run証跡を確認後、unit test evidence conditionで新判定を正本にする。

feature flagを追加する場合もruntime modeやtool allowlist切替には使わず、evidence projectionの互換rolloutに限定する。

## 15. Risks

### R1. Runner discoveryの副作用

Cargo、Gradle、非static Vitest collectionはtestを実行しなくてもcompile、plugin、module-level code、build scriptを動かす可能性がある。

Mitigation:

- tool resultへdiscovery methodとside-effect classを返す。
- repository safety policy、timeout、approval、allowed pathを既存command toolと同様に適用する。
- source非変更とprocess非実行を同義にしない。
- dependencyを自動installしない。

### R2. Filename false positive

test-like fileがrunner selectionから外れている場合がある。

Mitigation:

- filename resultは常にcandidate-only。
- Quality Gateはrunner/static collected definition evidenceを要求し、fresh execution reportだけで事前definition evidenceの不足を自動補完しない。

### R3. Dynamic test ID

Go subtest、JUnit parameterized test、property-based test等はdiscovery時とexecution時でcase nameが変わり得る。

Mitigation:

- adapter capabilityでexact / scope-confirmed / partialを区別する。
- exact IDが保証できないadapterでは、runner selection scopeとfresh execution summaryで結合する。
- partial evidenceだけでcondition単位の完了を主張しない。

### R4. Verify scriptがtestを含まない

終了コード0でもQuality Gateを誤って通す可能性がある。

Mitigation:

- test execution observedを独立条件にする。
- test resultを観測できないFull VerifyはFull Verify成功として保存しつつ、Quality Gateはunknownにする。
- Coding Agentは必要ならfocused testを明示実行できる。

### R5. Stale report

過去のJUnit XMLを新しい実行結果として再利用する可能性がある。

Mitigation:

- command前後のreport inventory、mtime、digest、workspace digestを照合する。
- command実行期間内に生成・更新されたartifactだけを新証跡とする。

### R6. Condition mappingの過剰推論

test名やfile名が似ているだけで完了条件へ自動mappingすると、存在証跡が意味上の検証証跡へ誤って昇格する。

Mitigation:

- sourceに宣言された厳密なcondition markerまたはCoding Agentの明示assessmentだけを受理する。
- hostは類似度、keyword、正規表現による意味分類を行わない。厳密なcondition ID schemaのvalidation / extractionは構造検証としてのみ行う。
- mappingへsource digestとprovenanceを保存し、source変更後はstaleにする。

## 16. 対象外

- testを自動生成または自動修正するtool。
- repositoryに不足dependencyやrunnerを自動installする処理。
- Quality Gate toolによるTodo、Task、Run statusの自動更新。
- Mission Pilot専用route、repository、promptの変更。
- test本文の意味をhostのkeywordや正規表現で評価する処理。
- すべての言語・test frameworkを初回releaseで網羅すること。
- CI provider固有APIへの依存。

## 17. 完了条件

- [AC-001] Coding Agentが単一runtime内から`collect_test_inventory`を明示的に利用でき、Native APIとCodex MCPで同一contractが公開されている。
- [AC-002] Vitest、Cargo、Go、Java/JUnitについて、runner/static collected caseとfilename candidateを区別して保存できる。
- [AC-003] filename candidateだけ、test 0件、全skip、test execution未観測ではQuality Gateが通らない。
- [AC-004] active test discovery、成功test execution、成功Full Verifyが同一workspace digestで揃った場合だけQuality Gateが通る。
- [AC-005] source/test/config変更後は過去のinventoryまたはverify証跡がstaleとなり、再確認なしにgateを通らない。
- [AC-006] `unit_test`を要求するrequired conditionは、対応するtest definitionと成功executionが同じconditionへ紐付いた場合だけ完了する。
- [AC-007] `verify`へtest discoveryの隠れた副作用を追加しておらず、実行型`run_quality_gate`の固定workflowを追加していない。
- [AC-008] `completion_check`はQuality Gateとcondition checklistのtyped statusを返すが、Todo、Task、Runを暗黙更新しない。
- [AC-009] tool selection、Todo、次action、修正、再試行、完了判断はCoding Agentに残り、hostは構造的不変条件だけを強制する。
- [AC-010] Coding Agent固有tool、service、repository、prompt、projectionが対応するCoding Agent module配下にあり、Mission Pilotとの連携はAgent非依存contract / port / eventだけを介する。
- [AC-011] Chat上で「証跡保存」「test定義確認」「test実行」「Full Verify」「Quality Gate通過」を区別できる。
- [AC-012] focused unit test、typecheck、architecture check、docs check、`bun run verify`が成功する。
- [AC-013] Quality Gateとcondition checklistが独立して評価され、Quality Gate通過だけで全完了条件を確認済みにしない。
- [AC-014] testcaseとconditionのmappingはsource内の構造markerまたはCoding Agentの明示assessmentだけから作られ、hostが文言類似で補完しない。
- [AC-015] 既存`run_verification`と直接shell verificationがmanaged evidence判定を迂回せず、同じ正規化application serviceを通らない結果はQuality Gateの正本にならない。

## 18. 実装開始時の最初のTodo

実装を開始するCoding Agentは、最初に本計画、現在のverification schema、`run_check`、`completion_check`、両runtime laneのtool registration、module boundary policyを読み、Phase 0のbaselineを採取する。

最初のTodoをpassedにする前に、次を固定する。

- 移動対象となる既存Coding Agent固有verification code。
- source state hashで除外するgenerated path。
- 初回adapterの利用可能toolchainとfixture範囲。
- DB migrationと過去evidence互換方針。
- focused test commandと失敗時の切り分け。

この計画を、実装順序、非対象、検証条件、完了条件の正本として扱う。
