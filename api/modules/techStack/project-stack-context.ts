import type { ProjectStackProfile } from "../../../shared/schemas/tech-stack.schema";

export function renderProjectStackContext(
	profile: ProjectStackProfile | null,
	options: { repositoryHasGitHead?: boolean } = {},
): string {
	if (
		profile?.manifestStatus !== "found" ||
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
	if (options.repositoryHasGitHead === false) {
		return [
			`- Working treeで検出した技術候補: ${profile.summary || "未検出"}`,
			"- Git HEADがないため、途中生成物を含む可能性があり、確定済みの既存Project stackとして扱わないでください。",
			"- Taskまたは採用済みArtifactで技術スタックが構造的に確定していない場合は、Questionnaireで技術スタックを確認してください。",
			"- 依存関係の全量ではなく、生成判断に必要な主要技術だけを示しています。",
			...technologies,
		].join("\n");
	}
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
