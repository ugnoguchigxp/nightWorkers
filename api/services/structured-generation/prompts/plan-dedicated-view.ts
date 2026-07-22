import { z } from "zod";
import type { DedicatedDesignView } from "../../../../shared/schemas/plan-mode-artifact.schema";
import { p } from "../../../systemContexts/catalog";

export const PLAN_DEDICATED_VIEW_PROMPT_VERSION = "plan-mode-dedicated-view-v2";

export const genericDedicatedViewSchema = {
	type: "object",
	additionalProperties: false,
	required: ["artifactKind", "view", "title", "markdown", "diagramKind"],
	properties: {
		artifactKind: { type: "string", const: "plan_mode_dedicated_view" },
		view: {
			type: "string",
			enum: ["user_flow", "activity_flow", "sequence_flow"],
		},
		title: { type: "string" },
		markdown: { type: "string" },
		diagramKind: {
			type: ["string", "null"],
			enum: ["stateDiagram-v2", "flowchart", "sequenceDiagram", null],
		},
	},
} as const;

export const genericDedicatedViewArtifactSchema = z
	.object({
		artifactKind: z.literal("plan_mode_dedicated_view"),
		view: z.enum(["user_flow", "activity_flow", "sequence_flow"]),
		title: z.string().min(1),
		markdown: z.string().min(1),
		diagramKind: z
			.enum(["stateDiagram-v2", "flowchart", "sequenceDiagram"])
			.nullable(),
	})
	.strict();

export type GenericDedicatedViewArtifact = {
	artifactKind: "plan_mode_dedicated_view";
	view: Exclude<
		DedicatedDesignView,
		| "questionnaire"
		| "blueprint"
		| "data_model"
		| "api_io_contract"
		| "zod_schema_design"
	>;
	title: string;
	markdown: string;
	diagramKind?: "stateDiagram-v2" | "flowchart" | "sequenceDiagram";
};

export function buildPlanDedicatedViewSystemPrompt(
	view: GenericDedicatedViewArtifact["view"],
) {
	const key = {
		user_flow: "planViews.user-flow",
		activity_flow: "planViews.activity-flow",
		sequence_flow: "planViews.sequence-flow",
	} as const;
	return p(key[view], {});
}

export function buildPlanDedicatedViewUserPrompt(input: {
	view: GenericDedicatedViewArtifact["view"];
	task: string;
	projectStackContext?: string | null;
	featurePlan: string;
	questionnaire: string;
	blueprint: string;
	dataModel: string;
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
				"前回出力した Mermaid は parse に失敗しました。Error と前回 source を読み、同じ view と同じ intent のまま Mermaid として parse できるように最小修正してください。",
				input.repairContext.trim(),
			);
		}
		return sections.join("\n");
	}
	const sections = [
		`次の context から ${input.view} Plan View を1つ生成してください。`,
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
		"## Data Model Context",
		input.dataModel,
		"",
		"## User Prompt",
		input.prompt,
	];
	if (input.repairContext?.trim()) {
		sections.push(
			"",
			"## Mermaid Parse Repair",
			"前回出力した Mermaid は parse に失敗しました。Error と前回 source を読み、同じ view と同じ intent のまま Mermaid として parse できるように最小修正してください。",
			input.repairContext.trim(),
		);
	}
	return sections.join("\n");
}
