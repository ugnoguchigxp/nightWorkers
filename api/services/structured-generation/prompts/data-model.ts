import type { DataModelArtifact } from "../../../../shared/schemas/plan-mode-artifact.schema";

export const DATA_MODEL_PROMPT_VERSION = "plan-mode-data-model-v1";

export function buildDataModelSystemPrompt(
	dataModelJsonSchema: string,
): string {
	return [
		"[SystemContext]",
		"data_model は data structure view であり、Blueprint の一部ではありません。",
		"DB が実装対象なら DDL を canonicalSource として出力してください。",
		"DDL は実行指示ではなく設計 artifact です。migration 実行、runtime DB call、seed data 作成はしません。",
		"DDL から table / column / relation / index summary を派生させ、別正本を作らないでください。",
		"DB が実装対象でないなら JSON shape、TypeScript type、Zod schema、storage contract など最も近い正本を canonicalSource にしてください。",
		"`updated_at` の自動更新が必要な場合は SQLite trigger を既定方針として扱い、都度 open question にしないでください。",
		"title 重複可否、将来の一意制約、実装時に変更可能な細部など、非ブロッキングな選択肢は openQuestions に出さず、一般的な既定値を置いてください。",
		"Data Model 生成中に追加質問を増やさないでください。確認が本当に必要な仕様判断は Questionnaire / Decisions の入力にある前提で扱い、未回答なら最小限の保守的な設計にしてください。",
		"constraints と openQuestions は schema 互換のため配列を返しますが、通常は空配列にしてください。",
		"AppBlueprint JSON は返さないでください。",
		"",
		"[Output Contract]",
		"JSON object だけを返してください。markdown、説明文、コードフェンスは不要です。",
		"JSON は下の [Data Model JSON Schema] に厳密に従ってください。",
		"",
		"[Data Model JSON Schema]",
		dataModelJsonSchema,
	].join("\n");
}

export function buildDataModelUserPrompt(input: {
	task: string;
	projectStackContext?: string | null;
	featurePlan: string;
	questionnaire: string;
	blueprint: string;
	prompt: string;
	projectionPrompt?: string;
	repairContext?: string | null;
}) {
	if (input.projectionPrompt?.trim()) {
		const sections = [input.projectionPrompt.trim()];
		if (input.repairContext?.trim()) {
			sections.push(
				"",
				"## Mermaid Parse Repair",
				"前回の Data Model から生成した Mermaid ER diagram は parse に失敗しました。Error と前回 artifact/source を読み、Data Model の意味を保ったまま Mermaid として parse できる derivedTables / relations に最小修正してください。",
				input.repairContext.trim(),
			);
		}
		return sections.join("\n");
	}
	const sections = [
		"次の context から data_model Plan View を1つ生成してください。",
		"",
		"## Task",
		input.task,
		"",
		"## Project Stack Context",
		input.projectStackContext?.trim() || "Project stack は未検出です。",
		"",
		"## Feature Plan",
		input.featurePlan,
		"",
		"## Questionnaire / Decisions",
		input.questionnaire,
		"",
		"## Blueprint Context",
		input.blueprint,
		"",
		"## User Prompt",
		input.prompt,
	];
	if (input.repairContext?.trim()) {
		sections.push(
			"",
			"## Mermaid Parse Repair",
			"前回の Data Model から生成した Mermaid ER diagram は parse に失敗しました。Error と前回 artifact/source を読み、Data Model の意味を保ったまま Mermaid として parse できる derivedTables / relations に最小修正してください。",
			input.repairContext.trim(),
		);
	}
	return sections.join("\n");
}

export function renderDataModelArtifactMarkdown(artifact: DataModelArtifact) {
	const lines = [
		`# ${artifact.title}`,
		"",
		artifact.summary || "Data Model artifact.",
		"",
	];
	lines.push(`Canonical source: \`${artifact.canonicalSource}\``);
	if (artifact.ddl?.trim()) {
		lines.push("", "## DDL", "", "```sql", artifact.ddl.trim(), "```");
	}
	lines.push("", "## Derived Tables");
	if (artifact.derivedTables.length === 0) lines.push("- None.");
	for (const table of artifact.derivedTables) {
		lines.push(`- ${table.name}: ${table.purpose}`);
		for (const column of table.columns) {
			const flags = [
				column.nullable ? "nullable" : "not null",
				column.primaryKey ? "primary key" : null,
				column.unique ? "unique" : null,
				column.defaultValue ? `default ${column.defaultValue}` : null,
			].filter(Boolean);
			lines.push(
				`  - ${column.name}: ${column.type}${flags.length ? ` (${flags.join(", ")})` : ""}`,
			);
		}
		if (table.indexes.length > 0)
			lines.push(`  - indexes: ${table.indexes.join("; ")}`);
	}
	lines.push("", "## Relations");
	if (artifact.relations.length === 0) lines.push("- None.");
	for (const relation of artifact.relations) {
		lines.push(
			`- ${relation.from} -> ${relation.to} (${relation.cardinality}): ${relation.reason}`,
		);
	}
	return lines.join("\n");
}
