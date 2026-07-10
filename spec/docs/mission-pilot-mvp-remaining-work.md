# Mission Pilot MVP 残タスク

## Status

planned

## 現在地

Mission Decomposition、TaskCandidate、Implementation Queue、Review / Test evidenceは既存基盤として存在する。
Mission Pilot固有のObjective、MissionTask、Approval、Attention、Autopilot、MissionEvaluation、
ReplanSuggestionを束ねるMission Controlは未実装である。

詳細な設計判断と旧実装順は次を参照する。

- `spec/archive/mission-pilot-concept.md`
- `spec/archive/mission-pilot-mvp-implementation-plan.md`

## 残タスク

1. Mission Pilot固有schemaを追加する。
   - `mission_objectives`
   - `mission_tasks`
   - `mission_approvals`
   - `mission_events`
   - `mission_attention_items`
   - `mission_autopilot_grants`
   - `pilot_actions`
   - `mission_evaluations`
   - `mission_plan_revisions`
   - `mission_replan_suggestions`
2. Project Evaluation improvementからMissionを作成し、ObjectiveとTaskCandidateを生成する。
3. TaskCandidateのrisk、approvalRequired、verificationGateを表示し、snapshot hash付き承認を実装する。
4. 承認済みTaskCandidateだけをMissionTask / NightWorkers Taskへ変換し、idempotency key付きでQueueへ投入する。
5. Queue / Run / Review / Test evidenceをMission Detailのtimelineと現在状態へ同期する。
6. Mission画面からLevel 1 Autopilotをstart / pause / resume / revokeできるようにする。
7. Autopilotが承認済み作業だけを進めるservice commandとauditを実装する。
8. MissionEvaluationでObjective progressを更新し、verification failure時はcompleteにせずstop / replanへ戻す。
9. ReplanSuggestionをplan revision差分として保存し、人間の承認後だけTaskGraphへ反映する。
10. Mission List / Detail / Attention Inboxを実装し、現在地、根拠、次の承認点を一画面で確認可能にする。

## 完了条件

- Project Evaluation improvementからMission作成、承認、Queue投入、Run、evidence評価、completeまたはreplanまで一周できる。
- approvalRequiredな作業が人間の承認なしに実行されない。
- verification failureがMission完了として扱われない。
- Queue投入とbackground actionがidempotentかつ監査可能である。
- Unit、API、UI、integration、safety regressionと`bun run verify`が成功する。

## 対象外

- Level 2以上の自動承認
- 複数Mission間の優先順位最適化やdependency
- full authentication / RBAC
- browser UI操作による内部進行
- self-improvementの自動実行
