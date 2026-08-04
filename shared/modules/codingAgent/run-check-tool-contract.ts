import { z } from "zod";

export const codingAgentRunCheckInputSchema = z
	.object({
		command: z.string().trim().min(1),
		cwd: z.string().trim().optional(),
		checkKind: z.enum([
			"lint",
			"format_check",
			"typecheck",
			"test",
			"coverage",
			"build",
			"verify",
			"completion_check",
			"other",
		]),
		timeoutSeconds: z.number().int().positive().optional(),
		displayMode: z.enum(["summary", "error_excerpt", "full"]).optional(),
	})
	.strict();

export const codingAgentCollectTestInventoryInputSchema = z
	.object({
		cwd: z.string().trim().optional(),
		cursor: z.string().trim().min(1).max(1_000).optional(),
		limit: z.number().int().min(1).max(100).optional(),
		filePaths: z.array(z.string().trim().min(1).max(1_000)).max(50).optional(),
	})
	.strict();

export const codingAgentRunCheckJsonSchema = toProviderJsonSchema(
	codingAgentRunCheckInputSchema,
);
export const codingAgentCollectTestInventoryJsonSchema = toProviderJsonSchema(
	codingAgentCollectTestInventoryInputSchema,
);

function toProviderJsonSchema(schema: z.ZodType) {
	const { $schema: _, ...providerSchema } = z.toJSONSchema(schema);
	return providerSchema as Record<string, unknown>;
}
