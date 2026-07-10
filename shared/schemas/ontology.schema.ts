import { z } from "@hono/zod-openapi";

export const ontologyToolProfileSchema = z.enum([
	"standard",
	"ontology_extended",
]);
export type OntologyToolProfile = z.infer<typeof ontologyToolProfileSchema>;

export const projectSecurityIntelligenceSettingsSchema = z
	.object({
		ontologyToolsEnabled: z.boolean(),
		securityMaxIterations: z.number().int().min(1).max(10),
	})
	.strict();
export type ProjectSecurityIntelligenceSettings = z.infer<
	typeof projectSecurityIntelligenceSettingsSchema
>;

export const projectSecurityIntelligenceSettingsResponseSchema = z
	.object({
		settings: projectSecurityIntelligenceSettingsSchema,
		securityOracle: z
			.object({
				alwaysEnabled: z.literal(true),
				configured: z.boolean(),
			})
			.strict(),
		ontology: z
			.object({
				thresholdSourceLoc: z.literal(50_000),
				measuredSourceLoc: z.number().int().nonnegative().nullable(),
				eligible: z.boolean(),
				effectiveEnabled: z.boolean(),
				toolProfile: ontologyToolProfileSchema,
				reason: z.enum([
					"enabled",
					"user_disabled",
					"below_threshold",
					"measurement_unavailable",
				]),
				scannedAt: z.union([z.string(), z.date()]).nullable(),
			})
			.strict(),
	})
	.strict();
export type ProjectSecurityIntelligenceSettingsResponse = z.infer<
	typeof projectSecurityIntelligenceSettingsResponseSchema
>;
