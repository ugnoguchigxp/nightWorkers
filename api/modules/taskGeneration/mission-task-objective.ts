import type { MissionTaskCandidate } from "../../../shared/schemas/task-generation.schema";

export function buildMissionCandidateTaskObjective(
	candidate: MissionTaskCandidate,
) {
	const primaryGoal = candidate.goalTitle?.trim() || candidate.title;
	const implementationTarget = formatWorkTarget(candidate.title);
	const planCheckItems = buildPlanCheckItems(candidate.planModeOpenQuestions);
	return [
		formatGoalInstruction(primaryGoal),
		"",
		"[作るもの]",
		`${implementationTarget}。`,
		candidate.summary,
		"",
		"[Planで確認すること]",
		...planCheckItems.map((item) => `- ${item}`),
		"",
		"[実装上の注意]",
		"- 未確認の仕様は固定せず、選択肢として残す。",
		"- 既存サンプル機能の改修に広げない。",
		"- schema、API、DB、UI の境界を明示する。",
		"",
		"[完了条件]",
		candidate.acceptanceCriteria,
		"",
		"[検証]",
		candidate.verificationPlan,
	].join("\n");
}

function formatGoalInstruction(goal: string) {
	if (goal.endsWith("を作る")) return `${goal.slice(0, -3)}を作ってください。`;
	if (goal.endsWith("を実装する")) {
		return `${goal.slice(0, -5)}を実装してください。`;
	}
	if (goal.endsWith("する")) return `${goal.slice(0, -2)}してください。`;
	return `${goal} を実現してください。`;
}

function formatWorkTarget(title: string) {
	if (title.endsWith("本体を実装する")) return `${title.slice(0, -7)}本体`;
	return title;
}

type PlanCheckCategory = {
	key: string;
	fallback: string;
	patterns: RegExp[];
};

const PLAN_CHECK_CATEGORIES: PlanCheckCategory[] = [
	{
		key: "entry",
		fallback: "入口画面または route",
		patterns: [/入口|画面|route|ルート|ホーム|UI|単一画面|分割画面/],
	},
	{
		key: "model",
		fallback: "データモデル",
		patterns: [
			/データモデル|属性|項目|title|note|due|priority|tags|task の最小属性/,
		],
	},
	{
		key: "storage",
		fallback: "保存方式",
		patterns: [/保存|永続|SQLite|API|shared schema|migration|DB/],
	},
	{
		key: "state",
		fallback: "完了状態の表現",
		patterns: [/完了|状態|completed|done|archive|アーカイブ/],
	},
	{
		key: "operations",
		fallback: "編集、削除、並び替えの初期範囲",
		patterns: [/編集|削除|並び替え|一括|操作/],
	},
	{
		key: "verification",
		fallback: "unit / schema / e2e の検証範囲",
		patterns: [/検証|unit|schema|e2e|test|verify/i],
	},
];

function buildPlanCheckItems(openQuestions: string[]) {
	const assigned = new Map<string, string>();
	const extra: string[] = [];

	for (const question of openQuestions
		.map((item) => item.trim())
		.filter(Boolean)) {
		const category = PLAN_CHECK_CATEGORIES.find((candidate) =>
			candidate.patterns.some((pattern) => pattern.test(question)),
		);
		if (category && !assigned.has(category.key)) {
			assigned.set(category.key, question);
		} else if (!category) {
			extra.push(question);
		}
	}

	return [
		...PLAN_CHECK_CATEGORIES.map(
			(category) => assigned.get(category.key) ?? category.fallback,
		),
		...extra.slice(0, 2),
	];
}
