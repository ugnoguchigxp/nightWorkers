import { z } from "@hono/zod-openapi";
import {
	projectExplorationCatalogReadinessSchema,
	projectExplorationCatalogSourceSchema,
} from "../../../../shared/schemas/project-exploration-catalog.schema";

export const PROJECT_INTELLIGENCE_TOOLS = {
	prepare: "vuln_prepare_project_intelligence",
	status: "vuln_get_project_intelligence_status",
	catalog: "vuln_get_project_exploration_catalog",
} as const;

export const PROJECT_INTELLIGENCE_PREPARATION_POLICY = {
	maxWaitMs: 30_000,
	minPollMs: 250,
	maxPollMs: 2_000,
} as const;

export type ProjectIntelligencePreparationPolicy = {
	maxWaitMs: number;
	minPollMs: number;
	maxPollMs: number;
};

export const projectIntelligenceStatusSchema = z
	.object({
		ok: z.boolean(),
		status: z.enum([
			"not_prepared",
			"queued",
			"running",
			"ready",
			"stale",
			"failed",
		]),
		projectPath: z.string().min(1),
		stage: z
			.enum([
				"structure_scan",
				"security_scan",
				"generation_build",
				"publishing",
				"complete",
			])
			.optional(),
		reused: z.boolean().optional(),
		retryAfterMs: z.number().int().nonnegative().optional(),
		nextAction: z.literal("vuln_prepare_project_intelligence").optional(),
		errorCode: z.string().min(1).optional(),
		message: z.string().optional(),
		retryable: z.boolean().optional(),
		durationMs: z.number().int().nonnegative().optional(),
		source: projectExplorationCatalogSourceSchema.optional(),
		readiness: projectExplorationCatalogReadinessSchema.optional(),
		provenance: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();
export type ProjectIntelligenceStatus = z.infer<
	typeof projectIntelligenceStatusSchema
>;

export function parseMcpJson(value: unknown): unknown {
	if (!value || typeof value !== "object" || !("content" in value)) {
		throw new Error("MCP response content is missing.");
	}
	const content = (value as { content?: unknown }).content;
	if (!Array.isArray(content)) {
		throw new Error("MCP response content is invalid.");
	}
	const text = content
		.filter(
			(block): block is { type: "text"; text: string } =>
				Boolean(block) &&
				typeof block === "object" &&
				(block as { type?: unknown }).type === "text" &&
				typeof (block as { text?: unknown }).text === "string",
		)
		.map((block) => block.text)
		.join("\n");
	if (!text) throw new Error("MCP response text is missing.");
	return JSON.parse(text);
}

export function clampProjectIntelligencePollMs(
	retryAfterMs: number | undefined,
	policy: ProjectIntelligencePreparationPolicy,
) {
	const requested = retryAfterMs ?? policy.maxPollMs;
	return Math.max(policy.minPollMs, Math.min(policy.maxPollMs, requested));
}
