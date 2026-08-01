export const jaEvidenceCheck = {
	"evidenceCheck.title": "証跡チェック",
	"evidenceCheck.openArtifact": "証跡チェックを開く",
	"evidenceCheck.artifact.summary":
		"実装計画の追跡結果、Spec の完了条件、最新の証跡状況",
	"evidenceCheck.unavailable":
		"Spec に紐づく検証ドキュメントが見つかりません。",
	"evidenceCheck.loading": "最新の証跡を読み込んでいます。",
	"evidenceCheck.loadFailed": "最新の証跡を読み込めませんでした。",
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
