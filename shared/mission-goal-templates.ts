import type { ProjectStackProfile } from "./schemas/tech-stack.schema";

export const missionGoalTemplates = [
	{
		id: "coverage-budget",
		title: "カバレッジ維持",
		goalText:
			"変更対象のテストカバレッジを80%以上に保つ。既存のカバレッジを下げず、品質低下を早期に検知できる状態にする。",
	},
	{
		id: "performance-budget",
		title: "パフォーマンス維持",
		goalText:
			"Web画面は主要なユーザー操作から0.2秒以内に表示を開始できる状態を保つ。主要なSQL queryは許容時間内に収まり、体感遅延を増やさない状態にする。",
	},
	{
		id: "design-token-coverage",
		title: "Design Token準拠",
		goalText:
			"UI実装で既存のdesign tokenを一貫して利用し、色・余白・角丸・文字サイズが局所的な直書きで増えない状態を保つ。",
	},
	{
		id: "i18n-dictionary-parity",
		title: "i18n辞書同期",
		goalText:
			"i18n辞書のlocale間でkeyを一致させる。新しい表示文言を追加した場合は、対応する全localeに同じkeyを追加する。",
	},
] as const;

export type MissionGoalTemplateId = (typeof missionGoalTemplates)[number]["id"];
export type MissionGoalTemplate = {
	id: MissionGoalTemplateId;
	title: string;
	goalText: string;
};

type StackTechnology = ProjectStackProfile["technologies"][number];

function hasTechnology(
	profile: ProjectStackProfile | null | undefined,
	predicate: (technology: StackTechnology) => boolean,
) {
	return Boolean(profile?.technologies.some(predicate));
}

function hasTechnologyName(
	profile: ProjectStackProfile | null | undefined,
	names: string[],
) {
	const nameSet = new Set(names.map((name) => name.toLowerCase()));
	return hasTechnology(profile, (technology) =>
		nameSet.has(technology.name.toLowerCase()),
	);
}

export function hasWebStack(profile: ProjectStackProfile | null | undefined) {
	return hasTechnology(
		profile,
		(technology) => technology.category === "frontend",
	);
}

export function hasI18nStack(profile: ProjectStackProfile | null | undefined) {
	return hasTechnologyName(profile, ["i18next"]);
}

export function hasDesignTokenStack(
	profile: ProjectStackProfile | null | undefined,
) {
	return hasTechnologyName(profile, ["Tailwind CSS", "shadcn/ui"]);
}

export function getMissionGoalTemplatesForStack(
	profile: ProjectStackProfile | null | undefined,
): MissionGoalTemplate[] {
	return missionGoalTemplates
		.filter(
			(template) =>
				template.id !== "i18n-dictionary-parity" || hasI18nStack(profile),
		)
		.filter(
			(template) =>
				template.id !== "design-token-coverage" || hasDesignTokenStack(profile),
		)
		.map((template) =>
			template.id === "performance-budget" && !hasWebStack(profile)
				? {
						...template,
						goalText:
							"主要な処理、API、SQL queryの応答時間を許容範囲に保つ。体感遅延や待ち時間を増やさず、性能劣化を早期に検知できる状態にする。",
					}
				: template,
		);
}
