# Security Intelligence Integrity Smoke / Rollout TODO

## Status

- Status: completed and archived
- Completed: 2026-08-17
- Code implementation: complete as of 2026-08-16
- Default activation: OFF
- Applies to: NightWorkers、vulnWorkbench、contextStill
- Completion authority: capability別のdated `GO | ITERATE | STOP` decision backed by the evidence below
- Completion evidence: `vulnWorkbench/spec/evidence/security-intelligence-integrity-smoke-2026-08-17.json`

実装計画は[履歴](../.archived/security-intelligence-executable-integration-implementation-plan.md)へ
移した。この文書だけで未完了のpilotとrollout判断を実行できるよう、
残作業、停止条件、完了条件を記録する。検証は1つのauthoritative implementation Runを
使用し、baseline Runとの二重実行や10-pair sampleを要求しない。integrity smoke証跡が
揃うまでStage 2 / Stage 3 complete、default ON、production rolloutを宣言しない。

証跡はvulnWorkbenchの
`spec/evidence/security-intelligence-integrity-smoke-template.json`（v2）へ記録する。
旧paired pilot evidence v1は履歴互換専用であり、新しい判断には使用しない。

## P0: 実行前固定 / preflight

- [x] 3 repositoryの対象commit、working tree、provider project、allowlistを固定する。
- [x] vulnWorkbenchで`bun run verify:security-intelligence-cross-repo-fixtures`を実行し、
      5 fixture groupすべてのsemantic digest一致を確認してv2証跡へ記録する。
      不一致またはdigest未記録の場合はここで停止する。
- [x] Project declarationをrevision/digest付きで検証できない場合、証跡の
      `declarationScope`を`transport_integrity_only`とし、Project Loop完成を主張しない。
- [x] Security Intelligence endpoint、workspace grant、assessment consumerだけを
      1 projectで有効化する。candidate / feedback / shadowはこの時点ではOFFのままにする。
- [x] rollback順と各flagの初期OFF状態を記録する。

## P1: Stage 2 single-Run integrity smoke

- [x] 1 Task Revision SnapshotのID / digest、1 implementation Run、
      1 canonical Evidence Subjectを固定する。
- [x] 同じRunでpre assessment → Security Contract → 実装 → post assessment →
      structured final judgmentを完了する。pre/postは別assessmentだが、実装Runを複製しない。
- [x] wrong project、wrong revision、wrong target digest、wrong subjectを拒否する。
- [x] cross-Run evidenceを拒否し、required failureとtyped unavailableをsuccess表示しない。
- [x] primary lane 1つでend-to-end smokeを行い、もう一方のlaneはadapter / tool contractの
      deterministic smokeで同じstructured judgment contractを確認する。
- [x] 1回のrollback drillを行い、通常Runと既存Security Scan v1が継続することを確認する。
- [x] pre-only、post-only、typed unavailableはlive sample数へ数えず、既存のfocused
      unit / contract scenarioでfail-closedを確認する。

Stage 2 integrity PASSは、fixture一致、同一Run traceability、4つのidentity拒否、privacy、
rollbackの全条件が通った状態を指す。これは最終rollout `GO`ではない。

## P2: Stage 3 shadow smoke

- [x] Stage 2 integrity PASS後だけcandidate tokenとfeedback tokenを別scopeで発行し、
      candidate / feedback ingress、dispatcher、shadow retrievalを1 project / 1 batchで有効化する。
- [x] token secretをrepository、evidence、report、logへ残さない。
- [x] same key / same digest replay、same key / different digest conflict、contextStill停止を検証する。
- [x] retrieved、selected、actually-used、verification outcomeを1 batch送信する。
- [x] feedback duplicate replay、candidate tokenとのscope rejectionを検証する。
- [x] feedbackによってKnowledge本文、status、promotion stateが変わらないことを確認する。
- [x] shadow itemがCoding Agentのconstraintやverification省略へ影響しないことを確認する。

## P3: Decision / Cleanup

- [x] identity mismatch、path / secret漏洩、unavailableのsuccess化、cross-Run evidence採用が0件である。
- [x] retry、dead-letter、restart dedupe、outbox receiptはfocused testを主証拠とし、
      cross-process smokeではoutage / retry / receiptを1経路確認する。
- [x] assessment consumer、post-assessment grant、candidate export、feedback export、
      shadow retrievalごとに、evidence、cost、coverage、failureを含むdated
      `GO | ITERATE | STOP` decisionを保存する。
- [x] decisionにかかわらず全flagとallowlistをOFFへ戻す。default activationは
      このsmokeでは認可せず、別のactivation decision / changeを必要とする。
- [x] temporary token、settings、database、workspace、processを削除する。
- [x] 3 repositoryのfocused test、typecheck、contract fixture検証を再実行する。
- [x] 完成した証跡をvulnWorkbenchの
      `bun run verify:security-intelligence-integrity-evidence -- --evidence <artifact>`で検証する。

## Completion

このTODOは、single-Run integrity smoke、secondary lane contract smoke、1回のrollback drill、
Stage 3 shadow smoke、capability別dated decision、cleanup、最終検証がすべて完了したときだけ
完了とする。完了後はこの文書も`spec/.archived`へ移す。
