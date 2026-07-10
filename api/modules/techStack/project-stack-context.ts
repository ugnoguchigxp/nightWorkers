import type { ProjectStackProfile } from "../../../shared/schemas/tech-stack.schema";

export function renderProjectStackContext(
	profile: ProjectStackProfile | null,
): string {
	if (
		!profile ||
		profile.manifestStatus !== "found" ||
		profile.technologies.length === 0
	) {
		return [
			"- Project stack は未検出です。",
			"- 技術スタックやテンプレートが context から確定できない場合だけ、ユーザーに確認してください。",
		].join("\n");
	}
	const technologies = profile.technologies
		.filter((technology) => technology.category !== "runtime")
		.slice(0, 10)
		.map(
			(technology) =>
				`- ${technology.name}: ${technology.category}, source=${technology.source}, confidence=${technology.confidence}`,
		);
	return [
		`- 既存 Project stack: ${profile.summary || "未検出"}`,
		profile.packageManager
			? `- Package manager: ${profile.packageManager}`
			: null,
		"- この stack は既存コードベースの前提です。ユーザーが変更を明示しない限り、別 stack / starter template 選択を質問しないでください。",
		"- 依存関係の全量ではなく、生成判断に必要な主要技術だけを示しています。",
		...technologies,
	]
		.filter(Boolean)
		.join("\n");
}
