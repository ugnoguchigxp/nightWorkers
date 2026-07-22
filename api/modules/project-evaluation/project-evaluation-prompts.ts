import {
	defaultProjectEvaluationDimensions,
	type ProjectEvaluationBundle,
	type ProjectEvaluationDimensionKey,
	type ProjectEvaluationRun,
	projectEvaluationDimensionLabels,
} from "../../../shared/schemas/project-evaluation.schema";
import { p } from "../../systemContexts/catalog";

function selectedDimensionLines(
	keys: readonly ProjectEvaluationDimensionKey[],
) {
	return keys
		.map((key) => `- ${key}: ${projectEvaluationDimensionLabels[key]}`)
		.join("\n");
}

function fixedEvaluationAxisGuidance() {
	return [
		"- conceptValue: 想定用途、解決する課題、Project 名や README から読み取れる目的に対して価値があるか。",
		"- architectureQuality: 現在の構造、責務分離、データ境界、runtime 境界、実装の成立度を評価する。",
		"- extensibility: 新しい provider、runtime、workflow、tool、domain、評価 evidence を既存境界を壊さず追加できるかを評価する。",
		"- uiUx: 利用者が目的を理解し、主要操作を迷わず実行できるか。",
		"- operability: 導入、設定、監視、障害時の扱いやすさ、信頼性、回復性をまとめて評価する。",
		"- security: secret 取り扱い、入力/出力境界、権限、危険操作の制御を評価する。",
		"- maintainability: 変更容易性、読みやすさ、ドキュメント、テストしやすい構造をまとめて評価する。",
		"- marketCompetitiveness: 代替手段と比べた差別化、実用デモとしての伝わりやすさ、採用理由を評価する。",
	].join("\n");
}

export function buildProjectEvaluationSystemPrompt() {
	return p("projectEvaluation.evaluation", {});
}

export function buildProjectEvaluationUserPrompt(input: {
	bundle: ProjectEvaluationBundle;
	baselinePrompt?: string;
}) {
	return [
		"次の NightWorkers Project を評価してください。",
		"",
		`評価観点:\n${selectedDimensionLines(defaultProjectEvaluationDimensions)}`,
		"",
		`評価軸の定義:\n${fixedEvaluationAxisGuidance()}`,
		"",
		input.baselinePrompt ? `追加観点:\n${input.baselinePrompt}` : null,
		"",
		"採点方針:",
		"- overallScore と各 score は 0-100。",
		"- confidence は 0-1。",
		"- Project 名、README、LLM_CONTEXT、package scripts、repo tree から想定用途を推定し、その用途に合っているかを conceptValue と marketCompetitiveness に反映する。",
		"- extensibility は「今の構造が良いか」ではなく、新しい provider、runtime、workflow、tool、domain、評価 evidence を足す時に境界を壊さず進められるかで採点する。",
		"- source sampling や runtime verification がない項目は confidence を上げすぎない。",
		"- rationale は NightWorkers Task に落とせる粒度で、抽象論だけにしない。",
		"",
		`Repository bundle JSON:\n${JSON.stringify(input.bundle, null, 2)}`,
	]
		.filter(Boolean)
		.join("\n");
}

export function buildProjectImprovementSystemPrompt() {
	return p("projectEvaluation.improvement", {});
}

export function buildProjectImprovementUserPrompt(input: {
	evaluation: ProjectEvaluationRun;
	bundle: ProjectEvaluationBundle;
	dimensionKeys: ProjectEvaluationDimensionKey[];
}) {
	const selectedDimensions = input.evaluation.dimensions.filter((dimension) =>
		input.dimensionKeys.includes(dimension.key),
	);
	return [
		"次の保存済み評価から focused improvement ideas を生成してください。",
		"",
		`選択評価軸:\n${selectedDimensionLines(input.dimensionKeys)}`,
		"",
		"要求:",
		"- 選択軸ごとに 100 点へ近づく候補を複数出す。",
		"- 1 idea は単独で実行可能な粒度にする。",
		"- agentPrompt は日本語で、実装者がそのまま Task として実行できる内容にする。",
		"- expectedOutcome と implementationFocus は検証しやすい表現にする。",
		"- scoreImpacts は必ず 1 件以上含め、改善対象軸ごとに LLM が評価内容から見積もった currentScore、expectedScoreGain、expectedScoreAfter、rationale を返す。",
		"- currentScore は保存済み evaluation の該当軸 score と一致させ、expectedScoreGain と expectedScoreAfter は実装焦点から見込める改善幅として過大評価しない。",
		"",
		`Selected dimensions JSON:\n${JSON.stringify(selectedDimensions, null, 2)}`,
		"",
		`Evaluation JSON:\n${JSON.stringify(input.evaluation, null, 2)}`,
		"",
		`Bundle summary JSON:\n${JSON.stringify(
			{
				repository: input.bundle.repository,
				scripts: input.bundle.inputs.scripts,
				missingInputs: input.bundle.missingInputs,
				notVerified: input.bundle.notVerified,
			},
			null,
			2,
		)}`,
	].join("\n");
}
