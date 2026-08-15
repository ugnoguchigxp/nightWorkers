# 受け入れ条件と検証証跡の厳密化 実装計画

Status: proposed  
Last updated: 2026-08-01  
Target: NightWorkers Coding Agent Run  
Related:

- `spec/multi-language-test-evidence-quality-gate-implementation-plan.md`
- `spec/docs/coding-agent-balanced-execution-plan.md`
- `spec/docs/evidence-review-closeout-retention-implementation-plan.md`
- `spec/s11t-coding-agent-guide.md`

## 1. 目的

必須の受け入れ条件を、現在のrepository sourceに対応するmanaged evidenceが条件単位で揃った場合だけ完了扱いにする。

この計画は既存のtest inventory、test-condition mapping、`run_check`、`completion_check`、completion readinessを作り直す計画ではない。現在までに実装済みの基盤を正本として再利用し、次の残存gapを閉じる差分計画である。

- Feature Plan作成時の`commands: []`は有効だが、Codex closeoutが静的command配列だけから成功条件を算出している。
- test-condition mappingが存在しても、対応するtestcaseが実行され成功したことまでは保証していない。
- 現在のQuality Gateは、同一sourceで成功したtest実行が1件あれば、mapping済みの全条件を成功扱いにできる。
- `expectedEvidence`の`unit_test`、`e2e_test`、`typecheck`等が条件判定に使われていない。
- checklistの`covered`や`manual`が、current sourceや明示的な確認証跡なしで完了statusになり得る。
- Codex SDK laneでは、最終回答候補を受け取った後に不整合を検出して`needs_review`へ落とすだけで、同じRun内でCoding Agentへ修正・再検証の機会を返していない。

## 2. 現状確認と原因

| 観測点 | 現在の挙動 | 問題 |
| --- | --- | --- |
| `api/modules/specification/specification-verification-sidecar.ts` | 検証sectionのbacktick commandだけを`commands`へ抽出する | Plan時に具体commandを固定しない方針のため、自然に`commands: []`になり得る。これは仕様上妥当である |
| `api/modules/codingAgent/application/codex-verification-closeout.service.ts` | `plan.commands`だけを実行し、その成功commandの`conditionIds`だけを成功条件にする | runtime中に作成済みのmanaged evidenceを集約せず、空command planでは全required conditionがmissingになる |
| `api/modules/codingAgent/verification/quality-gate.service.ts` | current sourceの成功test evidenceが1件あれば`testExecution=true`にする | mappingされた個別caseの実行成功を確認していない |
| `api/services/verification/checklist-matcher.ts` | command-level exit 0で`covered`にする | `verificationKind`と`expectedEvidence`の適合性、source freshness、case実行結果を完了条件にしていない |
| `api/modules/nightworkers/nightworkers.verification.repository.ts` | manual conditionを作成時から`manual`にする | manual確認が必要という分類と、manual確認済みという結果が混同されている |
| `api/services/worker-tools/run-check.ts` | managed evidenceを保存できるが、structured testcaseは主にJUnit XMLに依存する | Vitest等でexit 0だけがあり、どのcaseが成功したか不明な証跡が残る |
| `api/modules/codingAgent/application/completion-readiness.service.ts` | typed discrepancyを構築できる | Native API laneでは再調整に使われるが、Codex SDK laneのterminal前reconciliationへ統合されていない |

直近の再現Runでは、required conditionが7件、test-condition mappingが0件、verification evidence runが0件、Verification Documentの`commands`が0件だった。Coding Agentはraw shellで検証を実行して完了本文を返したが、structured closeoutは全条件を未確認として`needs_review`へ遷移した。

この結果から、直接shellの成功をmanaged evidenceへ昇格するのではなく、Coding Agentがmanaged verification capabilityを自然に使い、不足時にはterminal前にtyped discrepancyを返す必要がある。

## 3. 固定する設計判断

### 3.1 完了判定の正本

`verification_checklist_items.status`は表示用projectionとし、完了判定の正本にしない。完了時点でVerification Document、current source snapshot、inventory、mapping、execution evidence、manual confirmationを再結合して、各conditionのassuranceを導出する。

```text
required condition passed
  = conditionが構造的に有効
  AND expectedEvidenceの各要求を満たすmanaged evidenceがある
  AND evidenceがcurrent sourceStateHashに属する
  AND evidence実行中にsourceが変化していない
  AND conditionとevidenceの対応が明示されている
  AND failed / skipped / unknownの反証が残っていない

Run completion ready
  = open Todoがない
  AND 全required conditionのassuranceがsafe_pass
  AND Taskで要求されるrepository-level gateが成功
  AND final candidateとrevisionがcurrent
```

stored statusは履歴として維持する。source変更後に過去の`passed`を削除せず、read model上で`stale`へ投影する。

### 3.2 `commands: []`の意味

Feature Planの`commands`は任意の初期hintであり、完了条件の一覧ではない。

- `commands: []`だけを理由にPlan生成を失敗させない。
- static commandがある場合はcloseoutで実行できるが、条件との対応を全条件へ自動展開しない。
- runtime中にCoding Agentが選択した`run_check`のmanaged evidenceをcompletion時に必ず再利用する。
- static commandがなくても、current managed evidenceが全条件を満たせば完了できる。
- static commandもruntime evidenceも不足していれば、条件単位のdiscrepancyをCoding Agentへ返す。

### 3.3 test mappingとtest executionを分離する

`record_test_condition_mapping`は「このtestcaseがこのconditionを検証する」という明示的対応を保存するtoolであり、実行成功の証明ではない。

automated test conditionには、次の両方を要求する。

1. current inventory上のactive testcaseとconditionの明示mapping。
2. 同じcase identityを持つcurrent execution evidenceの`passed`。

repository全体で何らかのtest commandがexit 0になったことを、個別conditionのtest成功へ拡張しない。

### 3.4 raw shell結果の扱い

直接shell commandのstdout、exit code、assistant本文は観測履歴として保持するが、managed evidenceの正本にはしない。`run_check`と同じserver-side authority、workspace snapshot、revision、artifact freshness検証を通っていない結果を後付けで自動昇格しない。

Coding Agentがraw shellを先に使った場合は、completion discrepancyを読んで必要な範囲を`run_check`で再実行する。どのcheckを再実行するかはLLMがTask、Todo、source、失敗内容から判断する。

### 3.5 hostが意味推論しない

hostはtest名、file名、ユーザー文言のkeywordや類似度からconditionの意味対応を推論しない。

- schema evidence setとしてCoding Agentが明示したmappingを受理する。
- source内markerを使う場合は、adapterが特定test declarationへ構造的に結び付けられたmarkerだけを受理する。
- file内で見つかった全`AC-nnn`を、そのfileの全testcaseへ展開する現在のfallbackは完了証跡に使わない。
- identity照合の90% thresholdは、LLMが指定したtest参照を実在caseへ解決する構造検証にだけ使用する。

## 4. condition別の証跡契約

`expectedEvidence`配列は原則ANDとして扱う。`automated_test`は具体種別が指定されていない場合のgeneric requirementであり、対応する成功test evidenceが1種類あれば満たせる。

| verification kind / expected evidence | safe passに必要な証跡 | safe passにしない状態 |
| --- | --- | --- |
| `automated_test` / `unit_test` / `integration_test` / `e2e_test` | current active case、明示mapping、適合するevidence kind、同一case keyの`passed` execution | mappingだけ、command exit 0だけ、case不明、skip、0件、runner不一致 |
| `command_gate` / `typecheck` / `lint` / `format_check` / `build` / `coverage` / `migration_check` | conditionIdsを明示したcurrent managed check、expected kindとの適合、exit 0、source stable | unrelatedなverify成功、conditionIdsなし、kind不一致、stale evidence |
| `manual` / `manual_evidence` | task/run/conditionへboundされたuserまたはreviewerの明示確認、actor provenance、対象revision/source | condition作成時の`manual` status、Coding Agentの自己申告だけ |
| `not_applicable` | requiredでないconditionだけ | required conditionの対象外化 |

Full Verifyはrepository-level gateとしてcondition evidenceと分離する。Full Verify成功だけでrequired conditionをpassにせず、condition evidenceが揃っていてもTaskで要求されるFull Verifyが失敗していればRunを完了しない。

repository-level gateのapplicabilityはVerification Documentの構造から決める。manual conditionだけのTaskへactive test inventoryやtest executionを一律要求せず、automated test conditionがある場合だけtest Quality Gateを有効にする。Taskで明示されたFull Verifyやcommand gateは、manual conditionとは独立して評価する。

## 5. 共通contract

`shared/modules/codingAgent`に、Native API lane、Codex MCP lane、completion readiness、UI projectionが共有するcontractを一元化する。既存`EvidenceCheckAssuranceStatus`を拡張せず再利用し、reason codeだけを共通定数へまとめる。

```ts
type AcceptanceConditionAssurance = {
  conditionId: string;
  required: boolean;
  verificationKind: VerificationKind;
  expectedEvidence: ExpectedEvidence[];
  assuranceStatus:
    | "safe_pass"
    | "failed"
    | "stale"
    | "not_run"
    | "unmapped"
    | "details_missing"
    | "manual"
    | "not_applicable"
    | "pending";
  reasonCode: AcceptanceConditionReasonCode | null;
  evidenceRefs: Array<{
    evidenceRunId: string;
    caseKey?: string;
    evidenceKind: ExpectedEvidence;
    sourceStateHash: string;
  }>;
};
```

最低限、次のreason codeを共通化する。

- `CONDITION_MAPPING_MISSING`
- `CONDITION_CASE_EXECUTION_MISSING`
- `CONDITION_CASE_DETAILS_MISSING`
- `CONDITION_CASE_FAILED`
- `CONDITION_CASE_SKIPPED`
- `CONDITION_EVIDENCE_KIND_MISMATCH`
- `CONDITION_EVIDENCE_STALE`
- `CONDITION_SOURCE_MUTATED`
- `CONDITION_COMMAND_SCOPE_MISSING`
- `MANUAL_CONFIRMATION_MISSING`
- `FULL_VERIFY_MISSING`

tool description、JSON schema、reason code、result projectorは同じ定数またはbuilderから生成し、runtime lane別に文言や判定を複製しない。

## 6. persistence変更

### 6.1 execution case identity

`verification_evidence_cases`へ次を追加する。

- `case_key`: inventory caseと同じcanonical identity。structured adapterが解決できない場合はnull。
- `runner`: 実行caseのrunner。
- `evidence_kind`: `unit_test`、`integration_test`、`e2e_test`等の明示種別。

`verification_evidence_runs`へ、command gateとcase evidenceの分類に使う`evidence_kinds_json`を追加する。旧rowは空配列として読み、strict evaluatorでは`details_missing`とする。旧rowを推測でpassへmigrationしない。

### 6.2 manual confirmation

manual conditionを作成時から完了扱いにしない。初期statusを`pending`に変更する。

既存のReview/evidence eventからactor、task、run、condition、source/revisionを構造的に検証できる場合はそれを利用する。現在のeventで不足する場合だけ、Coding Agent moduleが所有する`record_condition_confirmation` application commandを追加し、user/reviewer操作から呼ぶ。Coding Agent自身のtool callだけではmanual confirmationを作成できないようserver側でactor authorityを検証する。

### 6.3 checklist status

既存columnは削除しない。migration後の意味を次に限定する。

- `pending`、`covered`、`verified_by_gate`、`manual`: 中間projectionでありcompletion statusではない。
- `passed`: 保存時点でadmissibleだった証跡のprojection。current判定は必ず再評価する。
- `failed`: 最新の明示的反証projection。
- `not_applicable`: requiredでないconditionだけ。

## 7. module配置

Coding Agent固有の新規production codeは`api/modules/codingAgent`、`src/modules/codingAgent`、`shared/modules/codingAgent`に置く。

```text
shared/modules/codingAgent/
  acceptance-condition-assurance-contract.ts

api/modules/codingAgent/
  verification/
    acceptance-condition-assurance.service.ts
    acceptance-condition-evidence.repository.ts
    evidence-kind-compatibility.ts
    execution-case-identity.ts
  application/
    completion-readiness.service.ts
    codex-completion-boundary.service.ts
  tools/
    run-check.tool.ts
    completion-check.tool.ts

src/modules/codingAgent/
  acceptance-condition-assurance-projection.ts
```

現在`api/modules/nightworkers`と`api/services/worker-tools`にあるCoding Agent固有のverification判定、repository、tool実装は、今回触る範囲を上記moduleへ移す。outer dispatcherとrun orchestrationは公開application commandまたはportだけを呼ぶ。Mission Pilot packageからCoding Agent内部service/repositoryをimportしない。

SystemContextは例外として`api/systemContexts`が所有する。host compositionが必要な場合は既存のcomposition layerへ限定し、`agentsShare`へrole固有toolやrepositoryを置かない。

## 8. 実装フェーズ

### Phase 0: regression fixtureを先に固定する

実装前に、現在誤判定するケースをfailing testとして固定する。

1. required automated conditions、`commands: []`、raw shell成功、managed evidenceなしは未完了。
2. mappingあり、repository内の別testが成功しただけでは未完了。
3. mappingしたcase自身のcurrent executionが成功すれば完了。
4. manual conditionは作成直後に未完了。
5. command gateの過去successはsource変更後にstale。
6. UI conditionが`unit_test`と`e2e_test`を要求する場合、片方だけでは未完了。

直近Runの再現には実DB dumpをfixture化せず、Verification Document、source snapshot、inventory、mapping、evidence rowの最小deterministic fixtureを使う。

### Phase 1: shared contractとmigration

1. `AcceptanceConditionAssurance`、reason code、JSON schemaを追加する。
2. execution case identityとevidence kindのmigrationを追加する。
3. Native API tool manifest、Codex MCP schema、result projectorが同じcontractを参照するようにする。
4. legacy evidence rowを保持し、分類不能なrowは`details_missing`として返す。

完了条件:

- invalid evidence kind、unknown condition ID、別Task/Run/Documentの参照を拒否する。
- migration前後で既存証跡の履歴とartifact参照が失われない。
- schemaのruntime lane差分がない。

### Phase 2: condition assurance evaluator

1. current `sourceStateHash`にboundされたevidenceだけを候補にする。
2. active inventory case、declared case-scoped markerまたはschema mapping、execution caseを`caseKey`で結合する。
3. `expectedEvidence`ごとにcompatible evidenceを評価する。
4. failed、skipped、unknown、0 test、source mutationを反証として扱う。
5. manual confirmationをactor provenance付きで評価する。
6. checklist statusを参照せず、condition assuranceからchecklist projectionを再構成する。

同じconditionにpassとfailがある場合は、current sourceに対する最新execution scopeを比較する。scopeが異なり優先関係を構造的に決められない場合は`details_missing`とし、hostがtest名や時刻だけで意味上の勝者を推論しない。

### Phase 3: structured execution evidence

1. `run_check`へ`evidenceKinds`を追加し、conditionIdsとexpected evidenceの構造的適合をserver側で検証する。
2. Vitestのstructured result adapterを初回vertical sliceとして追加し、inventoryと同じ`caseKey`へ正規化する。
3. 既存JUnit adapterもcase identityとevidence kindを出力する。
4. structured testcaseを取得できないtest commandはcommand成功として保存するが、automated conditionには`details_missing`を返す。
5. command-level evidenceは`command_gate`だけを満たし、automated conditionへ流用しない。
6. `run_check`実行前後のsource snapshot、report artifact digest、作成時刻を検証する。

Vitest commandをhostが隠れて書き換えない。Coding Agentは必要に応じてstructured reporterを出すcommandを選び、toolは指定されたartifactまたはstdoutをadapterで解析する。dependencyやrunnerの自動installは行わない。

### Phase 4: completion checkとcloseoutの統合

1. `completion_check`、`evaluateCodingAgentCompletionReadiness`、Codex closeoutをPhase 2の同一evaluatorへ統合する。
2. closeoutはstatic `plan.commands`を実行した後、既存runtime evidenceを含む全current evidenceを再評価する。
3. `successfulConditionIds`をcommand exit codeから直接作らない。
4. `commands: []`でもcurrent evidenceが揃っていればpassさせる。
5. 不足時はcondition ID、reason code、expected evidence、利用可能なevidence refsをtyped discrepancyとして返す。
6. Todo、Task、Run statusをevaluatorやtoolが暗黙更新しない。

### Phase 5: terminal前reconciliation

Native API laneの既存`runFinalizeController` loopを正本とし、Codex SDK laneも最終candidateをterminal resultとして確定する前に同じreadiness判定へ通す。

不整合がある場合:

1. 最終candidate本文を改変・固定文へ置換せず、digestとraw referenceを保持する。
2. current Todo、source hash、condition discrepancies、candidateを同じrecovery packetに入れる。
3. 同じCodex threadへ追加turnとして返す。
4. Coding Agentがmapping、再実行、source修正、Todo更新、回答再生成の次actionを選ぶ。
5. cancel、timeout、provider到達不能、再調整上限到達時だけ`needs_review`へ遷移する。

再調整回数には安全上限を設けるが、hostはtool順序や固定workflowを強制しない。同じdiscrepancyが継続する場合も、Todoを観測結果から暗黙更新しない。

### Phase 6: SystemContextとtool guidance

`api/systemContexts/contexts/codingAgent`の日本語contextへ次を追加する。

- required conditionがautomated evidenceを要求する場合、test定義mappingとcurrent executionの両方が必要である。
- raw shell結果はmanaged evidenceではない。
- `completion_check`のmissing/stale/details_missingを読んで、必要な次actionをTaskとTodoから判断する。
- Plan時の検証commandが空でも、repository調査後に適切なmanaged checkを選べる。
- 特定toolの実行自体や固定順序ではなく、current evidenceが条件を満たすことを完了条件にする。

tool名を必須順序として列挙せず、利用条件と保証範囲を説明する。TOML変更時は生成catalog JSON/TypeScriptを同じchangeで更新する。

### Phase 7: UIとobservability

Evidence CheckとRun closeoutへ、condition単位で次を表示する。

- required expected evidence
- mapped testcase
- latest execution status
- source freshness
- assurance statusとreason
- evidence run / artifact reference

「test定義あり」「mapping済み」「test実行成功」「Full Verify成功」「condition safe pass」を別表示にする。UIはcommand、test名、reason文言を再解釈せず、shared projectionだけを描画する。

metric/eventには少なくとも次を残す。

- required condition総数と`safe_pass`数
- `unmapped`、`details_missing`、`stale`の件数
- terminal前reconciliation回数と解消率
- raw shell後にmanaged rerunが必要になった件数
- `commands: []`のRunにおけるcompletion率

## 9. 受け入れ条件

- [AC-001] Verification Documentの`commands`が空でも、current managed evidenceが全required conditionを満たせばRunを完了できる。
- [AC-002] raw shellのexit 0またはassistantの完了申告だけではrequired conditionを完了できない。
- [AC-003] test-condition mappingだけではautomated conditionを完了できず、mappingしたcaseのcurrent successful executionが必要である。
- [AC-004] repository内の別testの成功を、mapping済みconditionの成功へ拡張しない。
- [AC-005] failed、skipped、unknown、0件、case details不明のtest evidenceを`safe_pass`にしない。
- [AC-006] source変更またはcheck中のsource mutationがある証跡はstaleとなり、再確認なしに完了へ使われない。
- [AC-007] `expectedEvidence`が複数ある場合は全要求が評価され、kind不一致のevidenceで代替されない。
- [AC-008] command gateはconditionIdsとevidence kindを明示したcurrent managed checkだけで完了する。
- [AC-009] manual conditionは作成時点ではpendingであり、authorityを検証したuser/reviewer confirmationが必要である。
- [AC-010] Full Verifyとcondition assuranceは独立して評価され、一方の成功でもう一方を補完しない。
- [AC-011] `completion_check`、Native API finalize、Codex SDK finalize、Evidence Check UIが同じassurance contractとreason codeを使う。
- [AC-012] Codex SDK laneは未達条件をterminal前に同じRunへ返し、Coding Agentに修正・再検証の機会を与える。
- [AC-013] evaluator、tool、closeoutはTodo、Task、Run statusを暗黙更新せず、LLMまたは人間の明示actionを維持する。
- [AC-014] hostはuser文言、test名、file名のkeywordや類似度からconditionの意味mappingを生成しない。
- [AC-015] Coding Agent固有のservice、repository、tool、projectionがCoding Agent role moduleにあり、Mission Pilotとの境界を迂回しない。
- [AC-016] SystemContextは日本語を維持し、managed evidenceの要件を説明するが、固定tool workflowや意味別modeを追加しない。
- [AC-017] focused test、S11t lint/check、architecture check、typecheck、backend build、`bun run verify`が成功する。

## 10. 受け入れ条件とtestのtraceability

実装PRでは、次のmatrixをtest名まで具体化して更新する。各test titleには対象AC IDを構造markerとして含めるか、`record_test_condition_mapping`へ渡すschema evidence setをfixtureとして置く。

| AC | test file | 主なassertion |
| --- | --- | --- |
| AC-001, AC-002 | `tests/coding-agent-acceptance-condition-assurance.test.ts`、`tests/coding-agent-test-evidence-mapping-integration.test.ts` | `commands: []`相当でもcurrent managed evidenceはpassし、raw shell参照や保存済みprojectionだけではpassしない |
| AC-003, AC-004, AC-005 | `tests/coding-agent-acceptance-condition-assurance.test.ts` | mapping、case identity、status、unrelated executionのmatrix |
| AC-006 | `tests/coding-agent-acceptance-condition-assurance.test.ts` | source hash変更とexecution中mutationでstale |
| AC-007, AC-008, AC-010 | `tests/coding-agent-acceptance-condition-assurance.test.ts`、`tests/coding-agent-run-check-evidence-scope.test.ts` | evidence kind AND評価、command scope、入力scope検証、Full Verify独立性 |
| AC-009 | `tests/coding-agent-manual-condition-evidence.test.ts`、`tests/coding-agent-run-check-evidence-scope.test.ts` | initial pending、actor authority、Run/source binding、`run_check`からのmanual証跡拒否 |
| AC-011 | `tests/coding-agent-completion-readiness.test.ts`、`tests/coding-agent-evidence-check-query.test.ts` | service間でassurance/reasonが一致 |
| AC-012 | `tests/codex-agent-runtime/completion-reconciliation.test.ts` | candidate保持、discrepancy返却、追加turn後の完了、Run不在時のfail-closed |
| AC-013 | `tests/coding-agent-test-evidence-mapping-integration.test.ts`、`tests/services.verification-checklist.test.ts` | evidence評価でTodo/Runが更新されない |
| AC-014 | `tests/coding-agent-test-evidence-mapping-integration.test.ts` | 未指定の意味mappingをhostが補完しない |
| AC-015 | architecture scripts | forbidden import、role固有実装の配置を検査 |
| AC-016 | SystemContext catalog tests | 日本語context、catalog同期、固定workflowなし |
| AC-017 | verification commands | 全体回帰なし |

focused verification:

```bash
bun run test -- tests/coding-agent-acceptance-condition-assurance.test.ts
bun run test -- tests/coding-agent-run-check-evidence-scope.test.ts
bun run test -- tests/coding-agent-evidence-scope.test.ts
bun run test -- tests/coding-agent-manual-condition-evidence.test.ts
bun run test -- tests/coding-agent-completion-readiness.test.ts
bun run test -- tests/codex-completion-boundary.test.ts
bun run test -- tests/coding-agent-test-evidence-mapping-integration.test.ts
bun run test -- tests/coding-agent-evidence-check-query.test.ts
bun run test -- tests/codex-agent-runtime/completion-reconciliation.test.ts
bun run test -- tests/verification-adapters/vitest-json.test.ts
```

full verification:

```bash
bun run s11tnext:lint
bun run s11tnext:check
bun run check:architecture
bun run typecheck
bun run build:backend
bun run verify
```

## 11. rolloutと互換性

1. schema migrationとstrict evaluatorのread-only projectionを先に配備する。
2. terminal admissionへ接続する前に、現行判定との差分をevent/metricでcanary観測する。
3. `details_missing`になった旧evidenceの比率、`commands: []`のRun、manual condition、Codex reconciliationの収束を確認する。
4. Native APIとCodex SDKを同じreleaseでstrict admissionへ切り替える。
5. 旧判定との恒久的なdual path、legacy execution mode、Task文言による切替は残さない。

既存Runのevidenceは削除しない。strict evaluator導入前のrowがcase identityやevidence kindを持たない場合は履歴として表示し、完了判定では`details_missing`にする。既存rowを推測で補完しない。

rollback時はadmission接続だけを戻し、migration済みcolumnと新規eventは保持する。証跡を削除・上書きしない。

## 12. 非対象

- Coding Agentがtestを自動生成・自動修正する固定workflow。
- dependency、runner、reporterの自動install。
- 直接shell結果をmanaged evidenceへ自動変換する処理。
- LLMのtest-condition assessmentをhostのkeyword分類へ置き換える処理。
- evidenceからTodo statusを暗黙更新する処理。
- Mission Pilot固有route、service、repositoryへのverification実装追加。
- すべての過去evidenceをstrict passへ自動migrationする処理。

## 13. 実装開始時の順序

1. Phase 0の6 regressionを追加し、現行の誤判定と不足判定を再現する。
2. shared contractとmigrationを実装する。
3. pureなcondition assurance evaluatorを完成させる。
4. Vitest/JUnit structured execution evidenceを接続する。
5. completion check、両runtime lane、Evidence Checkを同じevaluatorへ収束させる。
6. S11t SystemContextとtool descriptionを更新する。
7. UI、observability、canary、full verificationを完了する。

最初のvertical sliceは、`commands: []`、Vitest testcase mapping、current structured execution、completion reconciliationを1本のintegration testで通す。これにより、toolやschemaだけを追加して実Runから利用されない状態を先に防ぐ。

## 14. 実装結果

2026-08-01時点で、Phase 1からPhase 7のproduction接続と受け入れtestを実装した。

- condition assurance contract、reason code、evidence kind compatibilityを`shared/modules/codingAgent`と`api/modules/codingAgent`へ集約した。
- migration `0060_acceptance_condition_assurance.sql`でcase identity、evidence kind、manual confirmationを追加し、legacy rowを保持した。
- `run_check`は実行前のTask/Run/Document/condition/evidence kind検証、Vitest/JUnit structured result、current source snapshotをmanaged evidenceとして保存する。
- completion check、quality gate、Evidence Check、Native finalize、Codex SDK finalizeは同じcondition assurance evaluatorを利用する。
- Codex SDKはterminal前に同じthreadへdiscrepancyを返し、再調整回数と解消有無をeventへ残す。
- Evidence Checkは要求証跡、mapping元、case実行、freshness、Full Verify、condition assurance、evidence referenceを別表示し、required/safe-pass/unmapped/details-missing/stale件数を返す。
- SystemContextとtool descriptionは日本語のまま更新し、固定tool順序や意味別modeは追加していない。

local verification結果:

- focused acceptance matrix: 14 test files、58 tests pass。
- `s11tnext:lint`、`s11tnext:check`、`check:architecture`、`typecheck`、`build:backend`、`bun run verify`: pass。

canary配備と本番metricの集計はrollout工程であり、このlocal implementationの外部副作用には含めない。
