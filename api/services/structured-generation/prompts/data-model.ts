import type { DataModelArtifact } from "../../../../shared/schemas/plan-mode-artifact.schema";
import { p } from "../../../systemContexts/catalog";

export const DATA_MODEL_PROMPT_VERSION = "plan-mode-data-model-v1";

export function buildDataModelSystemPrompt(
	dataModelJsonSchema: string,
): string {
	return p("structuredGeneration.data-model", { dataModelJsonSchema });
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
