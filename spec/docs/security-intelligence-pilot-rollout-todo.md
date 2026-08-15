# Security Intelligence Pilot / Rollout TODO

## Status

- Status: deployment evidence pending
- Code implementation: complete as of 2026-08-16
- Default activation: OFF
- Applies to: NightWorkers、vulnWorkbench、contextStill
- Completion authority: dated `GO | ITERATE | STOP` decision backed by the evidence below

実装計画は[履歴](../.archived/security-intelligence-executable-integration-implementation-plan.md)へ
移した。この文書だけで未完了のpilotとrollout判断を実行できるよう、
残作業、停止条件、完了条件を記録する。pilot証跡が揃うまでStage 2 / Stage 3 complete、
default ON、production rolloutを宣言しない。

## P0: 実行前固定

- [ ] 3 repositoryの対象commit、working tree、provider project、allowlistを固定する。
- [ ] Security Intelligence endpoint、workspace grant、assessment consumer、candidate ingress、
      feedback ingressを1 projectだけで個別に有効化する。
- [ ] candidate tokenとfeedback tokenを別scopeで発行し、secretをrepository、report、logへ残さない。
- [ ] baselineとassessment-enabled RunでTask、base revision、provider、model、reasoning depthを揃える。
- [ ] rollback順と各flagの初期OFF状態を記録する。

## P1: Stage 2 integrity pilot

- [ ] 1 Task Revision Snapshotでpre assessmentを取得する。
- [ ] 同じTaskの1 Run / canonical Evidence Subjectでpost assessmentを取得する。
- [ ] wrong project、wrong revision、wrong target digest、wrong subjectを拒否する。
- [ ] native API laneとCodex laneの両方でstructured final judgmentを保存する。
- [ ] 両laneでrollback drillを行い、通常Runと既存Security Scan v1が継続することを確認する。
- [ ] 10件以上のvalid pre / post pairを実行する。pre-only、post-only、typed unavailableを除外しない。

## P2: Stage 3 shadow pilot

- [ ] Stage 2が`GO`の場合だけcandidate ingress / dispatcherを1 batch有効化する。
- [ ] same key / same digest replay、same key / different digest conflict、contextStill停止を検証する。
- [ ] retrieved、selected、actually-used、verification outcomeを1 batch送信する。
- [ ] feedback duplicate replay、candidate tokenとのscope rejectionを検証する。
- [ ] feedbackによってKnowledge本文、status、promotion stateが変わらないことを確認する。
- [ ] shadow itemがCoding Agentのconstraintやverification省略へ影響しないことを確認する。

## P3: Decision / Cleanup

- [ ] identity mismatch、path / secret漏洩、unavailableのsuccess化、cross-Run evidence採用が0件である。
- [ ] retry、dead-letter、restart dedupe、outbox receiptを確認する。
- [ ] evidence、cost、coverage、failureを含むdated `GO | ITERATE | STOP` decisionを保存する。
- [ ] `GO`以外では全flagとallowlistをOFFへ戻す。
- [ ] temporary token、settings、database、workspace、processを削除する。
- [ ] 3 repositoryのfocused test、typecheck、contract fixture検証を再実行する。

## Completion

このTODOは、1-pair smoke、両runtime laneのrollback drill、10-pair sample、Stage 3 shadow sample、
dated decision、cleanup、最終検証がすべて完了したときだけ完了とする。完了後はこの文書も
`spec/.archived`へ移す。
