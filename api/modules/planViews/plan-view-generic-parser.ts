import { z } from "zod";
import type { MermaidRenderRepair } from "../../../shared/schemas/plan-mode-artifact.schema";
import type { GenericDedicatedViewArtifact } from "../../services/structured-generation/prompts/plan-dedicated-view";
import { parseRepairedJsonWithSchema } from "../../services/structured-llm/json";
import {
	type MarkdownPlanView,
	markdownPlanViewSchema,
} from "./planView-generation.service";

export function parseGenericDedicatedViewOutput(
	rawOutput: string,
	expectedView: MarkdownPlanView,
): GenericDedicatedViewArtifact {
	const parsed = parseRepairedJsonWithSchema(
		rawOutput,
		z
			.object({
				artifactKind: z.literal("plan_mode_dedicated_view"),
				view: markdownPlanViewSchema,
				title: z.string().min(1),
				markdown: z.string().min(1),
				diagramKind: z
					.enum(["stateDiagram-v2", "flowchart", "sequenceDiagram"])
					.nullable()
					.optional(),
			})
			.transform((artifact) => {
				if (artifact.diagramKind === null) {
					const { diagramKind: _diagramKind, ...normalized } = artifact;
					return normalized;
				}
				return artifact;
			}),
	);
	if (!parsed.ok)
		throw new Error("Plan view LLM output did not contain valid JSON.");
	if (parsed.value.view !== expectedView) {
		throw new Error(
			`Plan view output used ${parsed.value.view}, expected ${expectedView}.`,
		);
	}
	validateDedicatedViewMarkdown(parsed.value);
	return parsed.value;
}

export function validateDedicatedViewMarkdown(
	artifact: GenericDedicatedViewArtifact,
) {
	const lower = artifact.markdown.toLowerCase();
	const forbiddenDiagram = "use" + "case";
	if (
		lower.includes(`${forbiddenDiagram}diagram`) ||
		lower.includes(forbiddenDiagram)
	) {
		throw new Error(
			"Unsupported diagram output is not allowed in Plan Mode views.",
		);
	}
	const expectedDiagramKind = diagramKindForView(artifact.view);
	if (!expectedDiagramKind) return;
	if (requiresMermaidDiagram(artifact.view)) {
		if (!artifact.markdown.includes("```mermaid")) {
			throw new Error(
				`${artifact.view} must be rendered as a Mermaid diagram.`,
			);
		}
		if (!artifact.diagramKind) {
			throw new Error(
				`${artifact.view} Mermaid output must include diagramKind.`,
			);
		}
		if (artifact.diagramKind !== expectedDiagramKind) {
			throw new Error(`${artifact.view} must use ${expectedDiagramKind}.`);
		}
	}
	if (artifact.diagramKind && artifact.diagramKind !== expectedDiagramKind) {
		throw new Error(`${artifact.view} must use ${expectedDiagramKind}.`);
	}
	if (artifact.markdown.includes("```mermaid")) {
		if (!artifact.diagramKind) {
			throw new Error(
				`${artifact.view} Mermaid output must include diagramKind.`,
			);
		}
		const requiredMarker =
			expectedDiagramKind === "flowchart" ? "flowchart " : expectedDiagramKind;
		if (!artifact.markdown.includes(requiredMarker)) {
			throw new Error(
				`${artifact.view} Mermaid output must include ${requiredMarker}.`,
			);
		}
	}
}

export function diagramKindForView(view: MarkdownPlanView) {
	if (view === "user_flow") return "flowchart" as const;
	if (view === "activity_flow") return "flowchart" as const;
	if (view === "sequence_flow") return "sequenceDiagram" as const;
	return null;
}

export function requiresMermaidDiagram(view: MarkdownPlanView) {
	return Boolean(diagramKindForView(view));
}

export function buildClientMermaidRepairPrompt(input: MermaidRenderRepair) {
	return [
		"ブラウザで Mermaid 図の表示に失敗しました。意味と画面遷移を維持し、エラー箇所だけを最小修正してください。",
		"",
		`失敗段階: ${input.stage}`,
		"エラー:",
		input.error,
		"",
		"前回の Mermaid source:",
		"```mermaid",
		input.chart.trim(),
		"```",
	].join("\n");
}
