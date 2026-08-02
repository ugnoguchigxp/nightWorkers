import { z } from "zod";
import type { PlanApiContractArtifact } from "../../../../shared/schemas/plan-mode-artifact.schema";
import { planApiContractDraftSchema } from "../../../modules/planViews/plan-api-contract-normalizer";
import { p } from "../../../systemContexts/catalog";
import { normalizeStructuredOutputJsonSchema } from "../../structured-llm/json-schema";

export const PLAN_API_CONTRACT_PROMPT_VERSION =
	"plan-mode-api-contract-openapi31-draft";

export const planApiContractStructuredOutputSchema =
	normalizeStructuredOutputJsonSchema(
		z.toJSONSchema(planApiContractDraftSchema),
	);

export function buildPlanApiContractSystemPrompt() {
	return p("planViews.api-contract", {});
}

export function buildPlanApiContractUserPrompt(input: {
	task: string;
	projectStackContext?: string | null;
	featurePlan: string;
	questionnaire: string;
	blueprint: string;
	dataModel: string;
	prompt: string;
	projectionPrompt?: string;
}) {
	if (input.projectionPrompt?.trim()) return input.projectionPrompt.trim();
	return [
		"次の context から API Contract view を1つ生成してください。",
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
	].join("\n");
}

export function renderPlanApiContractSummary(
	artifact: PlanApiContractArtifact,
) {
	const operations = Object.entries(artifact.openapi.paths).flatMap(
		([path, methods]) =>
			Object.entries(methods).map(([method, operation]) => {
				const summary = operation.summary ? ` - ${operation.summary}` : "";
				return `- ${method.toUpperCase()} ${path} (${operation.operationId})${summary}`;
			}),
	);
	return [
		`# ${artifact.title}`,
		"",
		artifact.summary,
		"",
		"## Operations",
		...operations,
	].join("\n");
}
