# Security Intelligence Integrity Smoke / Rollout Implementation Plan

## Status

- Status: completed and archived
- Created: 2026-08-16
- Last updated: 2026-08-17
- Completed: 2026-08-17
- Scope: NightWorkers、vulnWorkbench、contextStill
- Completion authority:
  [Security Intelligence Integrity Smoke / Rollout TODO](./security-intelligence-pilot-rollout-todo.md)
- Canonical evidence:
  `vulnWorkbench/spec/evidence/security-intelligence-integrity-smoke-<YYYY-MM-DD>.json`
- Evidence schema: `security-intelligence-nightworkers-integrity-evidence-v2`
- Default activation: this plan does not authorize default ON

### Current implementation checkpoint

- 3 repositoryの専用clean worktreeと固定commitでP0を実行し、cross-repository fixture 5群をPASSした。
- P1 single-Run lifecycleを実行し、pre/post assessment、Security Contract、verification artifact、structured final judgmentまで到達した。
- smoke中に検出した3件のintegrity defectを修正し、各repositoryへcommitした。
- candidate配送の停止・再試行・永続receipt・同一batch replayを実配送で確認した。
- 最新修正後のsingle Runを再取得し、P1/P2、rollback、cleanup、terminal evidence検証を完了した。default activationは未承認のままである。

## 1. Goal

1つのauthoritative implementation Runを使い、Security Intelligenceのpre assessment、
Security Contract、post assessment、structured final judgmentをend-to-endで検証する。
Stage 2 integrity PASS後に限り、candidate、feedback、shadow retrievalを1 project / 1 batchで
検証し、capability別の`GO | ITERATE | STOP`をv2 evidenceへ保存する。

この計画はproduction codeの再実装ではなく、既に実装済みの機能を安全に有効化し、
実行証跡を作り、rollbackとcleanupまで完了させるための実装・実行手順である。

## 2. Non-goals

- baseline Runとのpaired比較や10-pair sampleを復活させない。
- default ON、全project rollout、production activationを行わない。
- smokeのためにSecurity Intelligence contract versionを変更しない。
- candidateまたはfeedbackからKnowledgeを直接activeへ昇格させない。
- Mission PilotとCoding Agentの責務境界を変更しない。
- smoke中に見つかった一般的な改善を、停止条件の修正と混ぜて実装しない。
- secret、source本文、absolute filesystem pathをevidence、report、logへ保存しない。

## 3. Authoritative inputs

- NightWorkersの未完了条件:
  `spec/docs/security-intelligence-pilot-rollout-todo.md`
- cross-projectの責務境界:
  `spec/docs/security-intelligence-integration-concept.md`
- v2 evidence template:
  `vulnWorkbench/spec/evidence/security-intelligence-integrity-smoke-template.json`
- v2 evidence schema:
  `vulnWorkbench/shared/schemas/nightworkers-security-intelligence-integrity-evidence.schema.ts`
- cross-repository fixture verifier:
  `vulnWorkbench/scripts/verify-security-intelligence-cross-repo-fixtures.ts`
- terminal evidence verifier:
  `vulnWorkbench/scripts/verify-security-intelligence-integrity-evidence.ts`

旧`security-intelligence-nightworkers-pilot-evidence-v1`、旧decision template、旧paired pilot
planは履歴互換専用とし、新しいevidenceや完了判断の入力にしない。

## 4. Repository ownership

### NightWorkers

- Task Revision Snapshot、implementation Run、canonical Evidence Subjectを所有する。
- pre assessment binding、Security Contract、completion condition、post assessment、
  final judgmentを保存する。
- candidate / feedbackをRun-bound outboxへ保存し、contextStillへdispatchする。
- native API laneとCodex laneのadapter / tool contractを検証する。
- smoke完了後にTODOを更新し、完了時だけTODOを`spec/.archived`へ移す。

### vulnWorkbench

- Security Intelligence endpoint、workspace grant、assessment生成、binding proofを所有する。
- cross-repository fixture検証とv2 evidence schema / verifierを所有する。
- completedまたはstopped evidence artifactを正本として保存する。
- 既存Security Scan v1がrollback後も継続することを確認する。

### contextStill

- candidate / feedback ingressのscope、idempotency、receiptを所有する。
- candidateをshadow状態で保持し、Knowledge本文、status、promotion stateを変更しない。
- retrieved、selected、actually-used、verification outcomeをappend-onlyで記録する。

## 5. Planned changes and artifacts

### 5.1 Prerequisite changes to land first

実行前に、現在作業中の次のv2 assetsをreviewし、対応する3 repository fixture更新と同じ
integration baselineとして確定する。

- `vulnWorkbench/shared/schemas/nightworkers-security-intelligence-integrity-evidence.schema.ts`
- `vulnWorkbench/shared/schemas/nightworkers-security-intelligence-integrity-evidence.schema.test.ts`
- `vulnWorkbench/scripts/verify-security-intelligence-cross-repo-fixtures.ts`
- `vulnWorkbench/scripts/verify-security-intelligence-integrity-evidence.ts`
- `vulnWorkbench/spec/evidence/security-intelligence-integrity-smoke-template.json`
- 3 repositoryのcross-repository fixture
- 各package scriptの`verify:security-intelligence-*` entry

これらが未commit、fixture不一致、またはschema test失敗の状態ではP0へ進まない。
既存のunrelated working tree変更をstash、reset、削除して解消しない。所有者が変更を確定し、
各repositoryをcleanにしてから開始する。

### 5.2 Per-run artifacts

templateを直接編集せず、次を新規作成する。

- `vulnWorkbench/spec/evidence/security-intelligence-integrity-smoke-<YYYY-MM-DD>.json`

artifactは次を満たす。

- `smokeId`は再利用しないopaque IDに置き換える。
- `generatedAt`はterminal decision確定時のUTC timestampにする。
- raw payloadやlog全文ではなく、再取得可能なopaque evidence refを保存する。
- capability decisionの全項目にdecisionと1件以上のevidence refを保存する。
- `defaultActivationAuthorized`は常に`false`のままにする。
- failureで停止した場合も削除せず、`status: stopped`とstop reasonを保存する。

実行時だけ使用するtoken、temporary database、workspace、process、raw logはartifactへ含めず、
cleanup対象として別の一時台帳で管理する。一時台帳にもtoken値は書かず、識別名だけを記録する。

## 6. Feature flag and credential matrix

| Capability | Producer / receiver | Enable flag | Credential / allowlist | P0 | P1 | P2 | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| assessment endpoint | vulnWorkbench | `NIGHTWORKERS_SECURITY_INTELLIGENCE_ENABLED` | `NIGHTWORKERS_SECURITY_INTELLIGENCE_ALLOWED_PROJECT_IDS` | OFF→1 project | ON | ON | OFF / empty |
| workspace grant | vulnWorkbench | `NIGHTWORKERS_SECURITY_INTELLIGENCE_WORKSPACE_GRANT_ENABLED` | same 1 project | OFF→ON | ON | ON | OFF |
| authorization shadow | vulnWorkbench | `NIGHTWORKERS_SECURITY_INTELLIGENCE_AUTHORIZATION_SHADOW_ENABLED` | same 1 project | OFF | 必要時だけON | P1と同じ | OFF |
| pre consumer | NightWorkers | `NIGHTWORKERS_SECURITY_INTELLIGENCE_CONSUMER_ENABLED` | `NIGHTWORKERS_SECURITY_INTELLIGENCE_PROJECT_ALLOWLIST` | OFF→1 project | ON | ON | OFF / empty |
| post assessment | NightWorkers | `NIGHTWORKERS_SECURITY_INTELLIGENCE_POST_ASSESSMENT_ENABLED` | Run workspace grant | OFF→ON | ON | ON | OFF |
| candidate export | NightWorkers | `NIGHTWORKERS_SECURITY_KNOWLEDGE_CANDIDATE_EXPORT_ENABLED` | `NIGHTWORKERS_CONTEXT_STILL_CANDIDATE_TOKEN` | OFF | OFF | ON | OFF / remove |
| feedback export | NightWorkers | `NIGHTWORKERS_SECURITY_KNOWLEDGE_FEEDBACK_EXPORT_ENABLED` | `NIGHTWORKERS_CONTEXT_STILL_FEEDBACK_TOKEN` | OFF | OFF | ON | OFF / remove |
| candidate ingress | contextStill | `CONTEXT_STILL_SECURITY_INTELLIGENCE_CANDIDATE_ENABLED` | `CONTEXT_STILL_SECURITY_INTELLIGENCE_CANDIDATE_TOKEN` | OFF | OFF | ON | OFF / remove |
| feedback ingress | contextStill | `CONTEXT_STILL_SECURITY_INTELLIGENCE_FEEDBACK_ENABLED` | `CONTEXT_STILL_SECURITY_INTELLIGENCE_FEEDBACK_TOKEN` | OFF | OFF | ON | OFF / remove |
| shadow retrieval | contextStill | request-scoped `securityIntelligenceShadow.enabled` | project / Task / Run refs | OFF | OFF | ON for 1 compile | omit |

candidate tokenとfeedback tokenには異なる値を発行する。NightWorkersの送信tokenと
contextStillの対応する受信tokenだけを一致させ、cross-scope tokenを受理しない。

## 7. Phase 0: Contract readiness

### Implementation

1. v2 schema、template、2 verifier、package scriptsをreviewして確定する。
2. NightWorkersとvulnWorkbenchのassessment bundle / scan binding fixtureを同期する。
3. NightWorkersとcontextStillのcandidate / feedback fixtureを同期する。
4. 3 repositoryのidentity mapping fixtureを同期する。
5. contextStillの専用SQLite ingress testは、必ず先頭に`./`を付けた明示pathで実行する。

### Verification

vulnWorkbench:

```bash
bun run verify:security-intelligence-cross-repo-fixtures
bunx vitest run shared/schemas/nightworkers-security-intelligence-integrity-evidence.schema.test.ts
bun run typecheck
```

contextStill:

```bash
bun test ./test/security-intelligence-ingress.bun.ts
bun run typecheck
```

### Exit criteria

- verifierが5 fixture groupすべてをPASSにする。
- v2 incomplete templateがterminal completionとして受理されない。
- contextStill ingressのcandidate、feedback、idempotency、shadow不変条件が通る。
- prerequisite changesがreview済みcommitとして固定されている。

いずれかが失敗したらP0へ進まない。

## 8. Phase 1: P0 preflight

### 8.1 Baseline capture

各repositoryで次を取得し、v2 artifactの`preflight`へ保存する。

```bash
git rev-parse HEAD
git status --porcelain
```

`repositoryCommits`には40桁SHAを保存する。`git status --porcelain`が空の場合だけ対応する
`cleanWorkingTrees`を`true`にする。smoke開始後にcodeまたはfixtureが変わった場合は、そのrunを
無効化し、新しいpilot IDでP0からやり直す。

### 8.2 Project and declaration scope

1. 実データを含まない専用pilot repositoryを1つ選ぶ。
2. NightWorkers repository ID、vulnWorkbench project ID、workspace targetの対応を固定する。
3. repository declarationのrevisionとdigestを検証する。
4. 検証できる場合だけ`verified_repository_declarations`を選ぶ。
5. 検証できない場合は`transport_integrity_only`を選び、Project Loop完成を主張しない。

### 8.3 Initial configuration

1. 全flag OFF、allowlist empty、temporary tokenなしの状態を記録する。
2. candidate、feedback、shadowをOFFのまま維持する。
3. assessment endpoint、workspace grant、consumer、post assessmentだけを1 projectでONにする。
4. service起動順をvulnWorkbench → NightWorkers API / workerとし、healthと既存scan APIを確認する。
5. rollback順をNightWorkers consumer / post OFF → vulnWorkbench endpoint / grant OFFと固定する。

### Exit criteria

- 3 repository SHAとclean working treeが記録されている。
- fixture 5群が再度一致する。
- allowlist対象がちょうど1 projectである。
- P2用flagとtokenがまだ無効である。
- 既存Security Scan v1と通常Runのbaseline結果が保存されている。

## 9. Phase 2: P1 single-Run integrity smoke

### 9.1 Authoritative identity

1. 1 Taskとcurrent Task Revision Snapshotを作成または選択する。
2. base revisionと、baseとは異なるsource revision / target digestを固定する。
3. 1 implementation Runと1 canonical Evidence Subjectを割り当てる。
4. primary laneを`native_api`または`codex`から1つ選ぶ。
5. secondary laneはprimaryと異なるlaneに固定する。

このidentity tupleは途中で差し替えない。

```text
taskRef
taskRevisionSnapshotRef
runRef
evidenceSubjectRef
projectRef
baseRevision
sourceRevision
targetDigest
primaryLane
secondaryLane
```

### 9.2 Lifecycle execution

同じRun内で次の順序を守る。

1. vulnWorkbench assessment endpointからpre assessmentとbinding proofを取得する。
2. NightWorkersの`security.assessment.pre.bind`でcurrent Task Revision Snapshotへbindingする。
3. `security.contract.write`でpre assessment由来のSecurity Contractを保存する。
4. 必要な`security.condition.write`を保存する。
5. Coding Agentが確定済みTask / Contractに基づき実装と検証を行う。
6. `security.assessment.post.request`または`request_post_security_assessment`でpost assessmentを要求する。
7. preとは異なるpost assessment refを同じRun / Evidence Subjectへbindingする。
8. `submit_security_final_judgment`でstructured final judgmentを保存する。
9. selected verification / evidence ref、unresolved ref、outcomeをv2 artifactへ転記する。

Runを複製せず、pre / post assessmentの区別はassessment lifecycleで表す。

### 9.3 Secondary lane contract smoke

primary laneで実行したsemantic inputと同等のfixtureを使い、secondary laneのadapter / tool
contractが同じstructured judgment schemaを生成・保存できることをdeterministic testで確認する。
secondary laneで別implementation Runを実行しない。

### Exit criteria

- `integrityRun`の全refとidentityが再取得できる。
- lifecycle 4項目がすべてtrueである。
- preとpost assessment refが異なる。
- base revisionとsource revisionが異なる。
- primary / secondary laneが異なり、secondary adapter contractがPASSしている。
- required verification failure、unavailable、inconclusiveをsuccessへ変換していない。

## 10. Phase 3: Negative integrity checks

保存済みの正しいidentityを変更せず、各negative requestを独立に送る。

1. wrong project: allowlist外project refを使用して拒否を確認する。
2. wrong revision: Task Revision Snapshotと一致しないrevisionを使用して拒否を確認する。
3. wrong target digest: binding proofと異なるdigestを使用して拒否を確認する。
4. wrong subject: current Runと異なるEvidence Subjectを使用して拒否を確認する。

拒否結果はerror code、HTTP / tool status、opaque request refだけを保存する。negative requestから
assessment receipt、contract、judgment、outbox rowが作成されていないことをDB read modelで確認する。

### Exit criteria

- `negativeChecks`の4項目がすべてtrueである。
- cross-Run evidence採用が0件である。
- secret、source本文、absolute path漏洩が0件である。

1件でも拒否されなかった場合は`STOP`候補とし、P2へ進まない。

## 11. Phase 4: Stage 2 rollback drill

1. NightWorkers consumerとpost assessmentをOFFにする。
2. vulnWorkbench endpointとworkspace grantをOFFにする。
3. allowlistをemptyへ戻す。
4. Security Intelligenceなしの通常Runを1件実行する。
5. 既存Security Scan v1を1件実行する。
6. Security Intelligence endpointがadvertiseされない、または明示的disabledを返すことを確認する。
7. 通常Runと既存scanの結果をbaselineと比較する。

### Stage 2 integrity PASS

次の全条件が満たされた場合だけStage 2 integrity PASSとする。

- fixture 5群一致
- single-Run lifecycle完了
- secondary lane contract PASS
- negative integrity checks 4件PASS
- privacy assertions 3件PASS
- rollback後の通常Runと既存Security Scan v1が正常

このPASSはP2開始を許可するだけで、rollout `GO`やdefault ONを意味しない。

## 12. Phase 5: P2 Stage 3 shadow smoke

### 12.1 Isolated enablement

1. contextStillをisolated SQLite databaseで起動する。
2. candidate tokenとfeedback tokenを別々に発行する。
3. contextStill candidate / feedback ingressをONにする。
4. NightWorkers candidate / feedback exportをONにする。
5. allowlistはP1と同じ1 projectだけにする。
6. context compile inputの`securityIntelligenceShadow.enabled`を、同じproject / Task / Runに
   bindingした1 compileだけでtrueにする。
7. 1 candidate batchと1 feedback batchだけを対象にする。

### 12.2 Candidate checks

1. Final Judgmentへbindingしたcandidate batchをoutboxへ保存する。
2. dispatchし、strict receiptがoutbox status更新前に保存されることを確認する。
3. same key / same digestをreplayし、同じdurable resultを返すことを確認する。
4. same key / different digestを送り、mutationなしでconflictになることを確認する。
5. contextStillを停止して1回dispatchし、bounded retryとなることを確認する。
6. contextStillを再起動して再dispatchし、lossやduplicate mutationなしでreceiptを得る。

### 12.3 Feedback and shadow checks

1. retrieved、selected、actually-used、verification outcomeを区別したfeedbackを送る。
2. 同じfeedbackを再送し、duplicate replayとして受理されることを確認する。
3. candidate tokenでfeedback endpointへ送り、scope rejectionを確認する。
4. 実行前後でKnowledge本文、status、promotion stateを比較し、不変であることを確認する。
5. shadow itemあり / なしでCoding Agentのconstraintとverification requirementを比較する。
6. shadow itemがconstraint追加やverification省略を起こしていないことを確認する。

### Exit criteria

- candidate / feedback batch refとreceipt refがすべて保存されている。
- `shadowSmoke.checks`の7項目がすべてtrueである。
- outage / retry / receiptのcross-process経路が1件確認されている。
- KnowledgeとCoding Agent behaviorの不変条件が確認されている。

## 13. Phase 6: Decision and evidence finalization

### 13.1 Observations

次をaggregate値としてv2 artifactへ保存する。

- assessment build latency
- endpoint request count
- endpoint error count
- payload size

source本文、raw request / response、token、absolute pathは保存しない。terminal `completed`には
endpoint error count 0が必要である。intentional outageは通常trafficのerror countと混同せず、
retry drill evidence refとして記録する。

### 13.2 Capability decisions

次の5 capabilityを独立に判定する。

- assessment consumer
- post-assessment grant
- candidate export
- feedback export
- shadow retrieval

各decisionは次で判断する。

- `GO`: 対象capabilityのintegrity、privacy、rollbackがすべてPASSした。
- `ITERATE`: integrity incidentはないが、coverage、cost、reliabilityに未解決事項がある。
- `STOP`: identity、privacy、evidence、failure presentationのincidentがある。

全capabilityに1件以上のopaque evidence refを関連付ける。artifact全体の`generatedAt`をdecision
dateとし、`defaultActivationAuthorized`はdecisionにかかわらずfalseを維持する。

### 13.3 Terminal validation

```bash
bun run verify:security-intelligence-integrity-evidence -- \
  --evidence spec/evidence/security-intelligence-integrity-smoke-<YYYY-MM-DD>.json
```

検証成功前に`status: completed`またはTODO完了を宣言しない。

## 14. Phase 7: Cleanup

decisionにかかわらず、次の順序でcleanupする。

1. NightWorkers candidate exportをOFFにする。
2. NightWorkers feedback exportをOFFにする。
3. NightWorkers post assessmentとconsumerをOFFにする。
4. contextStill candidate / feedback ingressをOFFにする。
5. vulnWorkbench workspace grant、authorization shadow、endpointをOFFにする。
6. 3 repositoryのallowlistをemptyへ戻す。
7. candidate / feedback tokenを失効・削除する。
8. temporary contextStill database、pilot workspace、processを削除する。
9. Security Intelligenceなしの通常Runと既存Security Scan v1を再確認する。
10. cleanup後のflag状態とregression結果をv2 artifactへ保存する。

失敗evidenceとcompleted evidenceは削除しない。一時resourceだけを削除する。

## 15. Final verification

### NightWorkers

```bash
node scripts/run-vitest.mjs run \
  tests/security-intelligence-contract-fixtures.test.ts \
  tests/security-intelligence-runtime.test.ts \
  tests/security-intelligence-review-regressions.test.ts \
  tests/security-finalization-gate.test.ts \
  tests/security-knowledge-outbox-dispatcher.test.ts
bun run typecheck
git diff --check
```

### vulnWorkbench

```bash
bunx vitest run \
  shared/schemas/security-intelligence-assessment.schema.test.ts \
  shared/schemas/nightworkers-security-intelligence.schema.test.ts \
  shared/schemas/nightworkers-security-intelligence-integrity-evidence.schema.test.ts \
  shared/schemas/security-intelligence-authorization.schema.test.ts \
  shared/schemas/security-intelligence-contract-fixtures.test.ts \
  api/modules/integrations/nightworkers/nightworkers-security-intelligence.service.test.ts \
  api/modules/integrations/nightworkers/nightworkers-security-intelligence.routes.test.ts \
  api/modules/integrations/nightworkers/nightworkers-security-intelligence-telemetry.test.ts
bun run verify:security-intelligence-contract
bun run verify:security-intelligence-cross-repo-fixtures
bun run verify:security-intelligence-integrity-evidence -- \
  --evidence spec/evidence/security-intelligence-integrity-smoke-<YYYY-MM-DD>.json
bun run typecheck
git diff --check
```

### contextStill

```bash
bunx vitest run \
  test/security-intelligence-auth.test.ts \
  test/security-intelligence-contract-fixtures.test.ts
bun test ./test/security-intelligence-ingress.bun.ts
bun run typecheck
git diff --check
```

## 16. Stop and restart rules

次のいずれかで即時停止し、flagをrollbackする。

- cross-repository fixture mismatch
- wrong project、revision、target digest、Evidence Subjectの受理
- source本文、secret、absolute pathの漏洩
- unavailable、inconclusive、required failureのsuccess化
- cross-Run evidenceの採用
- receipt保存前のdelivered化、idempotency conflict後のmutation
- feedbackによるKnowledge本文、status、promotion stateの変更
- shadow itemによるconstraint変更またはverification省略
- rollback後の通常Runまたは既存Security Scan v1の回帰

code、fixture、project identity、Task Revision Snapshotのいずれかを変更した場合は、同じartifactを
継続編集せず、新しいsmoke IDとartifactでP0から再開する。

## 17. Done when

- v2 prerequisite assetsとcross-repository fixtureがreview済みcommitとして固定されている。
- P0 preflightが1 project、clean working tree、5 fixture group PASSで完了している。
- single-Run integrity lifecycleとsecondary lane contract smokeが完了している。
- negative integrity checks 4件とrollback drillがPASSしている。
- Stage 3 shadow smoke 1 batchの全checkがPASSしている。
- 5 capabilityのdated decisionとevidence refが保存されている。
- v2 evidence verifierがterminal artifactを受理している。
- temporary token、settings、database、workspace、processがcleanupされている。
- 3 repositoryのfocused test、typecheck、fixture verifierがPASSしている。
- 全flag OFF、allowlist empty、`defaultActivationAuthorized: false`である。
- authoritative TODOが更新され、完了した場合だけTODOとこの計画が`spec/.archived`へ移されている。
