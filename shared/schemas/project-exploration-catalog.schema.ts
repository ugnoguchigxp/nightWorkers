import { z } from "@hono/zod-openapi";

const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const projectExplorationCatalogPilotSettingsSchema = z
	.object({
		enabled: z.boolean().default(false),
		mcpServerId: z.string().trim().min(1).nullable().default(null),
	})
	.strict();
export type ProjectExplorationCatalogPilotSettings = z.infer<
	typeof projectExplorationCatalogPilotSettingsSchema
>;

const legacyProjectExplorationCatalogRunPinSchema = z.discriminatedUnion(
	"available",
	[
		z
			.object({
				version: z.literal(1),
				available: z.literal(true),
				serverId: z.string().min(1),
				rootRef: sha256HexSchema,
				projectId: z.string().min(1),
				scanRunId: z.string().min(1),
				generationId: z.string().uuid(),
				snapshotRef: z.string().min(1),
				sourceTreeHash: sha256HexSchema,
				sourceStateHash: sha256HexSchema,
				sourceRevisionHead: z.string().min(1),
				toolName: z.literal("vuln_get_project_exploration_catalog"),
			})
			.strict(),
		z
			.object({
				version: z.literal(1),
				available: z.literal(false),
				reason: z.enum([
					"disabled",
					"wrong_runtime_lane",
					"server_missing",
					"tool_missing",
					"source_missing",
					"source_unusable",
					"revision_mismatch",
					"manifest_invalid",
					"mcp_failed",
				]),
			})
			.strict(),
	],
);

export const projectExplorationAvailabilityV2Schema = z.discriminatedUnion(
	"available",
	[
		z
			.object({
				version: z.literal(2),
				available: z.literal(true),
				serverId: z.string().min(1),
				toolName: z.literal("vuln_get_project_exploration_catalog"),
				preparedAt: z.string().min(1),
				preparationStatus: z.literal("ready"),
				freshness: z
					.object({
						status: z.literal("current"),
						sourceRevisionKind: z.enum(["git", "tree_hash_only"]),
						sourceRevisionValue: z.string().min(1),
					})
					.strict(),
				readiness: z
					.object({
						codeStructure: z.enum(["available", "degraded"]),
						reasonCodes: z.array(z.string()),
					})
					.strict(),
				preparation: z
					.object({
						reused: z.boolean(),
						durationMs: z.number().int().nonnegative(),
						pollCount: z.number().int().nonnegative(),
					})
					.strict(),
			})
			.strict(),
		z
			.object({
				version: z.literal(2),
				available: z.literal(false),
				reason: z.enum([
					"disabled",
					"wrong_runtime_lane",
					"server_missing",
					"tool_missing",
					"workspace_mismatch",
					"revision_unavailable",
					"preparation_pending",
					"preparation_timeout",
					"not_prepared",
					"stale",
					"degraded_unusable",
					"contract_invalid",
					"mcp_failed",
				]),
				retryable: z.boolean().optional(),
				errorCode: z.string().min(1).optional(),
				preparation: z
					.object({
						durationMs: z.number().int().nonnegative(),
						pollCount: z.number().int().nonnegative(),
					})
					.strict()
					.optional(),
			})
			.strict(),
	],
);

export const projectExplorationCatalogRunPinSchema = z.union([
	projectExplorationAvailabilityV2Schema,
	legacyProjectExplorationCatalogRunPinSchema,
]);
export type ProjectExplorationCatalogRunPin = z.infer<
	typeof projectExplorationCatalogRunPinSchema
>;

export type ProjectExplorationAvailabilityV2 = z.infer<
	typeof projectExplorationAvailabilityV2Schema
>;

const projectRelativePathSchema = z
	.string()
	.trim()
	.min(1)
	.max(1024)
	.refine(
		(value) =>
			!value.includes("\0") &&
			!value.includes("\\") &&
			!value.startsWith("/") &&
			!/^[a-zA-Z]:/.test(value) &&
			!value.split("/").includes(".."),
		"project_relative_path_required",
	);

export const projectExplorationCatalogFocusSchema = z
	.object({
		paths: z.array(projectRelativePathSchema).max(10).optional(),
		modules: z.array(z.string().trim().min(1).max(256)).max(5).optional(),
		terms: z.array(z.string().trim().min(2).max(80)).max(10).optional(),
	})
	.strict()
	.refine(
		(focus) =>
			(focus.paths?.length ?? 0) +
				(focus.modules?.length ?? 0) +
				(focus.terms?.length ?? 0) >
			0,
		{ message: "focus requires at least one path, module, or term." },
	);
export type ProjectExplorationCatalogFocus = z.infer<
	typeof projectExplorationCatalogFocusSchema
>;

const boundedCatalogLabelSchema = z.string().trim().min(1).max(256);
const boundedCatalogPathSchema = z.string().trim().min(1).max(1024);
const boundedCatalogLabelsSchema = z.array(boundedCatalogLabelSchema).max(20);

export const projectExplorationKnowledgeSourceListSchema = z
	.object({
		ok: z.literal(true),
		status: z.literal("completed"),
		sources: z.array(
			z
				.object({
					projectId: z.string().min(1),
					rootRef: sha256HexSchema,
					scanRunId: z.string().min(1),
					generationId: z.string().uuid(),
					generationGeneratedAt: z.string(),
					sourceRevision: z
						.object({
							kind: z.enum(["git", "tree_hash_only"]),
							head: z.string().min(1).optional(),
							dirtyHash: z.string().optional(),
							value: z.string().min(1),
						})
						.strict(),
					readiness: z.enum(["available", "stale", "degraded"]),
				})
				.passthrough(),
		),
	})
	.passthrough();

export const projectExplorationManifestSchema = z
	.object({
		ok: z.literal(true),
		status: z.literal("completed"),
		manifest: z
			.object({
				project: z.object({ id: z.string().min(1) }).passthrough(),
				scan: z.object({ id: z.string().min(1) }).passthrough(),
				generation: z
					.object({
						generationId: z.string().uuid(),
						snapshotRef: z.string().min(1),
						sourceTreeHash: sha256HexSchema,
						sourceStateHash: sha256HexSchema,
						status: z.enum(["available", "degraded", "stale"]),
					})
					.passthrough(),
			})
			.passthrough(),
	})
	.passthrough();

const projectExplorationCatalogCandidateFields = {
	likelyFiles: z
		.array(
			z
				.object({
					rank: z.number().int().positive().max(10_000).optional(),
					path: boundedCatalogPathSchema,
					roleTags: boundedCatalogLabelsSchema.optional(),
					reasonCodes: boundedCatalogLabelsSchema.optional(),
				})
				.passthrough(),
		)
		.max(20),
	relatedTests: z
		.array(
			z
				.object({
					rank: z.number().int().positive().max(10_000).optional(),
					path: boundedCatalogPathSchema,
					reasonCodes: boundedCatalogLabelsSchema.optional(),
				})
				.passthrough(),
		)
		.max(10),
	verificationCandidates: z
		.array(
			z
				.object({
					rank: z.number().int().positive().max(10_000).optional(),
					command: z.string().trim().min(1).max(2048),
					candidateOnly: z.literal(true),
				})
				.passthrough(),
		)
		.max(6),
};

const projectExplorationCatalogPresentationFields = {
	focusResolution: z
		.object({
			matchedPaths: z.array(boundedCatalogPathSchema).max(10),
			matchedModuleIds: boundedCatalogLabelsSchema,
			matchedTerms: boundedCatalogLabelsSchema,
			unmatched: boundedCatalogLabelsSchema,
		})
		.strict()
		.optional(),
	truncation: z
		.object({
			truncated: z.boolean(),
			omittedFiles: z.number().int().nonnegative(),
			omittedTests: z.number().int().nonnegative(),
			omittedVerificationCommands: z.number().int().nonnegative(),
		})
		.strict()
		.optional(),
	degradedReasons: boundedCatalogLabelsSchema.optional(),
};

const legacyProjectExplorationCatalogResultSchema = z
	.object({
		ok: z.literal(true),
		status: z.enum(["completed", "degraded"]),
		generation: z
			.object({
				scanRunId: z.string().min(1),
				generationId: z.string().uuid(),
			})
			.passthrough(),
		...projectExplorationCatalogCandidateFields,
		...projectExplorationCatalogPresentationFields,
	})
	.passthrough();

export const projectExplorationPathCatalogResultSchema = z
	.object({
		ok: z.literal(true),
		status: z.enum(["completed", "degraded"]),
		freshness: z.object({ status: z.enum(["fresh", "stale"]) }).passthrough(),
		...projectExplorationCatalogCandidateFields,
		...projectExplorationCatalogPresentationFields,
	})
	.passthrough();
export type ProjectExplorationPathCatalogResult = z.infer<
	typeof projectExplorationPathCatalogResultSchema
>;

export const projectExplorationCatalogResultSchema = z.union([
	projectExplorationPathCatalogResultSchema,
	legacyProjectExplorationCatalogResultSchema,
]);
