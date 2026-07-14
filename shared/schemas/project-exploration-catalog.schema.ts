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

export const projectExplorationCatalogRunPinSchema = z.discriminatedUnion(
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
export type ProjectExplorationCatalogRunPin = z.infer<
	typeof projectExplorationCatalogRunPinSchema
>;

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

export const projectExplorationCatalogResultSchema = z
	.object({
		ok: z.literal(true),
		status: z.enum(["completed", "degraded"]),
		generation: z
			.object({
				scanRunId: z.string().min(1),
				generationId: z.string().uuid(),
			})
			.passthrough(),
		likelyFiles: z.array(z.object({ path: z.string().min(1) }).passthrough()),
		relatedTests: z.array(z.object({ path: z.string().min(1) }).passthrough()),
		verificationCandidates: z.array(
			z
				.object({
					command: z.string().min(1),
					candidateOnly: z.literal(true),
				})
				.passthrough(),
		),
	})
	.passthrough();
