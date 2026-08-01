export const jaEvidenceCheck = {
	"evidenceCheck.title": "証跡チェック",
	"evidenceCheck.openArtifact": "証跡チェックを開く",
	"evidenceCheck.artifact.summary":
		"実装計画の追跡結果、Spec の完了条件、最新の証跡状況",
	"evidenceCheck.unavailable":
		"Spec に紐づく検証ドキュメントが見つかりません。",
	"evidenceCheck.loading": "最新の証跡を読み込んでいます。",
	"evidenceCheck.loadFailed": "最新の証跡を読み込めませんでした。",
	"evidenceCheck.assurance.title": "テスト安全性",
	"evidenceCheck.assurance.summary":
		"安全にPass {{safePass}}/{{automated}} · 失敗 {{failed}} · 要確認 {{attention}}",
	"evidenceCheck.assurance.evaluatedAt": "判定日時",
	"evidenceCheck.assurance.source": "ソース",
	"evidenceCheck.assurance.unavailable": "取得不可",
	"evidenceCheck.assurance.yes": "はい",
	"evidenceCheck.assurance.no": "いいえ",
	"evidenceCheck.gateStatus.passed": "Pass",
	"evidenceCheck.gateStatus.failed": "失敗",
	"evidenceCheck.gateStatus.unknown": "未確認",
	"evidenceCheck.assuranceStatus.safe_pass": "安全にPass",
	"evidenceCheck.assuranceStatus.failed": "失敗",
	"evidenceCheck.assuranceStatus.stale": "再実行が必要",
	"evidenceCheck.assuranceStatus.not_run": "未実行",
	"evidenceCheck.assuranceStatus.unmapped": "テスト未紐付け",
	"evidenceCheck.assuranceStatus.details_missing": "詳細不足",
	"evidenceCheck.assuranceStatus.manual": "手動確認",
	"evidenceCheck.assuranceStatus.not_applicable": "対象外",
	"evidenceCheck.assuranceStatus.pending": "判定待ち",
	"evidenceCheck.assuranceReason.missing_test_definition_mapping":
		"この条件に対応するテスト定義が見つかりません。",
	"evidenceCheck.assuranceReason.test_execution_failed":
		"対応するテストが失敗しています。",
	"evidenceCheck.assuranceReason.source_snapshot_changed":
		"テスト後にソースが変更されています。",
	"evidenceCheck.assuranceReason.missing_successful_test_execution":
		"成功したテスト実行を確認できません。",
	"evidenceCheck.assuranceReason.missing_exact_test_case_result":
		"このテストケース自身の成功結果を確認できません。",
	"evidenceCheck.assuranceReason.full_verify_failed":
		"全体検証ゲートが失敗しています。",
	"evidenceCheck.assuranceReason.missing_successful_full_verify":
		"成功した全体検証ゲートを確認できません。",
	"evidenceCheck.assuranceReason.assurance_not_evaluated":
		"安全性はまだ判定されていません。",
	"evidenceCheck.test.execution": "実行結果",
	"evidenceCheck.test.currentSource": "現在のソース",
	"evidenceCheck.testStatus.passed": "Pass",
	"evidenceCheck.testStatus.failed": "失敗",
	"evidenceCheck.testStatus.skipped": "スキップ",
	"evidenceCheck.testStatus.unknown": "不明",
	"evidenceCheck.testStatus.not_run": "未実行",
	"evidenceCheck.plan.title": "実装計画トレーサビリティ",
	"evidenceCheck.plan.exactMatch":
		"確定済み実装計画と Run Todo は完全一致しています。",
	"evidenceCheck.plan.mismatch":
		"確定済み実装計画と Run Todo に不一致があります。",
	"evidenceCheck.plan.legacyInferred":
		"Run Todo は実装計画と完全一致していますが、旧 Run のため計画 digest は保存されていません。",
	"evidenceCheck.plan.provenanceMismatch":
		"Run に保存された計画 digest または参照元が一致しません。",
	"evidenceCheck.plan.provenanceMissing":
		"対応する実装 Run または計画 provenance が見つかりません。",
	"evidenceCheck.plan.summary":
		"{{passed}}/{{total}} 工程完了 · 不一致 {{unaligned}} · 証跡参照あり {{evidenceLinked}}",
	"evidenceCheck.conditions.title": "Spec 完了条件",
	"evidenceCheck.conditions.summary":
		"{{confirmed}}/{{total}} 条件確認済み · 失敗 {{failed}} · 未確認 {{pending}}",
	"evidenceCheck.conditionEvidence": "証跡 {{count}}件",
	"evidenceCheck.conditionStatus.pending": "未確認",
	"evidenceCheck.conditionStatus.running": "確認中",
	"evidenceCheck.conditionStatus.passed": "確認済み",
	"evidenceCheck.conditionStatus.failed": "失敗",
	"evidenceCheck.conditionStatus.completed": "確認済み",
	"evidenceCheck.conditionStatus.done": "確認済み",
	"evidenceCheck.conditionStatus.covered": "確認済み",
	"evidenceCheck.conditionStatus.verified_by_gate": "ゲート確認",
	"evidenceCheck.conditionStatus.manual": "手動確認済み",
	"evidenceCheck.conditionStatus.not_applicable": "対象外",
	"evidenceCheck.conditionStatus.missing": "未充足",
	"evidenceCheck.conditionStatus.unknown": "不明",
} as const;
