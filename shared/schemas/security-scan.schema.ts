import { z } from "zod";

export const SECURITY_SCAN_CONTRACT_VERSION = 1 as const;
export const SECURITY_SCAN_PROVIDER_BASE_PATH =
	"/api/integrations/nightworkers/v1";

export const securityScanPresetIdSchema = z.enum(["quick", "standard", "deep"]);
export type SecurityScanPresetId = z.infer<typeof securityScanPresetIdSchema>;

export const securityScanTargetKindSchema = z.enum(["working_tree", "full"]);
export type SecurityScanTargetKind = z.infer<
	typeof securityScanTargetKindSchema
>;

export const securityScanSelectionSchema = z.discriminatedUnion("mode", [
	z
		.object({
			mode: z.literal("preset"),
			presetId: securityScanPresetIdSchema,
		})
		.strict(),
	z
		.object({
			mode: z.literal("custom"),
			profileRef: z.string().trim().min(1).max(128),
		})
		.strict(),
]);
export type SecurityScanSelection = z.infer<typeof securityScanSelectionSchema>;

export const securityScanTargetSchema = z
	.object({ kind: securityScanTargetKindSchema })
	.strict();
export type SecurityScanTarget = z.infer<typeof securityScanTargetSchema>;

export const securityScanProviderSettingsInputSchema = z
	.object({
		enabled: z.boolean(),
		baseUrl: z.string().trim().url().max(2048),
		token: z.string().trim().min(1).max(4096).optional(),
	})
	.strict();
export type SecurityScanProviderSettingsInput = z.infer<
	typeof securityScanProviderSettingsInputSchema
>;

export const securityScanProviderSettingsSchema = z
	.object({
		enabled: z.boolean(),
		baseUrl: z.string().url(),
		tokenConfigured: z.boolean(),
	})
	.strict();
export type SecurityScanProviderSettings = z.infer<
	typeof securityScanProviderSettingsSchema
>;

const opaqueRefSchema = z.string().min(1).max(256);
const timestampSchema = z.string().datetime();
const nullableTimestampSchema = timestampSchema.nullable();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const securityScanProviderEnvelopeSchema = <T extends z.ZodType>(
	dataSchema: T,
) =>
	z
		.object({
			contractVersion: z.literal(SECURITY_SCAN_CONTRACT_VERSION),
			requestId: z.string().min(1).max(64),
			data: dataSchema,
		})
		.strict();

export const securityScanCapabilitiesSchema = z
	.object({
		provider: z
			.object({
				id: z.literal("vulnworkbench"),
				version: z.string().min(1).max(64),
			})
			.strict(),
		project: z
			.object({
				ref: opaqueRefSchema,
				displayName: z.string().min(1).max(256),
			})
			.strict(),
		presets: z.array(
			z
				.object({
					id: securityScanPresetIdSchema,
					displayName: z.string().min(1).max(128),
					description: z.string().min(1).max(1024),
					recommended: z.boolean(),
					targets: z.array(
						z
							.object({
								kind: securityScanTargetKindSchema,
								profileRef: opaqueRefSchema,
								estimatedDurationSeconds: z
									.object({
										min: z.number().int().nonnegative(),
										max: z.number().int().positive(),
									})
									.strict(),
								toolCategories: z.array(z.string().min(1).max(64)).max(32),
								warnings: z.array(z.string().max(512)).max(32),
							})
							.strict(),
					),
				})
				.strict(),
		),
		selectableProfiles: z.array(
			z
				.object({
					ref: opaqueRefSchema,
					name: z.string().min(1).max(256),
					description: z.string().max(2048),
					supportedTargets: z.array(securityScanTargetKindSchema).min(1),
					requirements: z.array(z.string().max(256)).max(32),
					warnings: z.array(z.string().max(512)).max(32),
				})
				.strict(),
		),
		limits: z
			.object({
				maxConcurrentScansForClient: z.number().int().positive(),
				maxFindingPageSize: z.number().int().positive(),
				maxEventPageSize: z.number().int().positive(),
				maxReportBytes: z.number().int().positive(),
			})
			.strict(),
	})
	.strict();
export type SecurityScanCapabilities = z.infer<
	typeof securityScanCapabilitiesSchema
>;

export const securityScanPreviewSchema = z
	.object({
		previewRef: opaqueRefSchema,
		resolvedProfileRef: opaqueRefSchema,
		target: z
			.object({
				kind: securityScanTargetKindSchema,
				digest: sha256Schema,
				sourceRevision: z.string().min(1).max(128).nullable(),
				fileCount: z.number().int().nonnegative().nullable(),
			})
			.strict(),
		estimatedDurationSeconds: z
			.object({
				min: z.number().int().nonnegative(),
				max: z.number().int().positive(),
			})
			.strict(),
		toolSteps: z.array(
			z
				.object({
					id: z.string().min(1).max(128),
					name: z.string().min(1).max(256),
					category: z.string().min(1).max(64),
					required: z.boolean(),
					availability: z.enum(["available", "unavailable", "conditional"]),
					reason: z.string().max(512).optional(),
				})
				.strict(),
		),
		warnings: z.array(z.string().max(512)).max(64),
		expiresAt: timestampSchema,
	})
	.strict();
export type SecurityScanPreview = z.infer<typeof securityScanPreviewSchema>;

export const securityScanStartResponseSchema = z
	.object({
		scanRunRef: opaqueRefSchema,
		status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
		resolvedProfileRef: opaqueRefSchema,
		target: z
			.object({
				kind: securityScanTargetKindSchema,
				digest: sha256Schema,
				sourceRevision: z.string().min(1).max(128).nullable(),
			})
			.strict(),
		createdAt: timestampSchema,
		replayed: z.boolean(),
	})
	.strict();
export type SecurityScanStartResponse = z.infer<
	typeof securityScanStartResponseSchema
>;

const securityScanSeverityCountsSchema = z
	.object({
		critical: z.number().int().nonnegative(),
		high: z.number().int().nonnegative(),
		medium: z.number().int().nonnegative(),
		low: z.number().int().nonnegative(),
		info: z.number().int().nonnegative(),
		unknown: z.number().int().nonnegative(),
	})
	.strict();

export const securityScanRunDetailSchema = z
	.object({
		scanRunRef: opaqueRefSchema,
		status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
		outcome: z
			.enum(["findings_present", "no_findings", "inconclusive", "unavailable"])
			.nullable(),
		presetId: securityScanPresetIdSchema.nullable(),
		profileRef: opaqueRefSchema,
		target: z
			.object({
				kind: securityScanTargetKindSchema,
				digest: sha256Schema,
				sourceRevision: z.string().min(1).max(128).nullable(),
			})
			.strict(),
		progress: z
			.object({
				completedSteps: z.number().int().nonnegative(),
				totalSteps: z.number().int().nonnegative(),
				currentStep: z.string().max(256).nullable(),
			})
			.strict(),
		summary: z
			.object({
				findingCount: z.number().int().nonnegative(),
				severityCounts: securityScanSeverityCountsSchema,
				coverage: z
					.object({
						completed: z.number().int().nonnegative(),
						skipped: z.number().int().nonnegative(),
						failed: z.number().int().nonnegative(),
						gaps: z.array(
							z
								.object({
									code: z.string().min(1).max(64),
									message: z.string().min(1).max(512),
								})
								.strict(),
						),
					})
					.strict(),
			})
			.strict()
			.nullable(),
		lastEventSeq: z.number().int().nonnegative(),
		createdAt: timestampSchema,
		startedAt: nullableTimestampSchema,
		completedAt: nullableTimestampSchema,
		error: z
			.object({
				code: z.string().min(1).max(128),
				message: z.string().min(1).max(1024),
				retryable: z.boolean(),
			})
			.strict()
			.nullable(),
	})
	.strict();
export type SecurityScanRunDetail = z.infer<typeof securityScanRunDetailSchema>;

export const securityScanFindingPageSchema = z
	.object({
		items: z.array(
			z
				.object({
					ref: opaqueRefSchema,
					severity: z.enum([
						"critical",
						"high",
						"medium",
						"low",
						"info",
						"unknown",
					]),
					title: z.string().min(1).max(1024),
					category: z.string().max(256).nullable(),
					tool: z.string().min(1).max(128),
					ruleId: z.string().max(512).nullable(),
					location: z
						.object({
							path: z.string().max(4096).nullable(),
							startLine: z.number().int().positive().nullable(),
							endLine: z.number().int().positive().nullable(),
						})
						.strict(),
					description: z.string().max(16_384).nullable(),
					evidence: z.string().max(16_384).nullable(),
					recommendation: z.string().max(16_384).nullable(),
					references: z.array(z.string().url().max(2048)).max(64),
				})
				.strict(),
		),
		nextCursor: z.string().max(2048).nullable(),
	})
	.strict();
export type SecurityScanFindingPage = z.infer<
	typeof securityScanFindingPageSchema
>;

export const securityScanReportDetailSchema = z
	.object({
		reportRef: opaqueRefSchema,
		scanRunRef: opaqueRefSchema,
		status: z.enum(["queued", "running", "completed", "failed"]),
		summaryMode: z.literal("deterministic_with_llm_summary"),
		title: z.string().max(512).nullable(),
		llm: z
			.object({
				provider: z.string().min(1).max(128),
				model: z.string().min(1).max(256),
			})
			.strict()
			.nullable(),
		createdAt: timestampSchema,
		startedAt: nullableTimestampSchema,
		completedAt: nullableTimestampSchema,
		content: z
			.object({
				mediaType: z.literal("text/markdown"),
				byteLength: z.number().int().nonnegative(),
				sha256: sha256Schema,
			})
			.strict()
			.nullable(),
		error: z
			.object({
				code: z.string().min(1).max(128),
				message: z.string().min(1).max(1024),
				retryable: z.boolean(),
			})
			.strict()
			.nullable(),
	})
	.strict();
export type SecurityScanReportDetail = z.infer<
	typeof securityScanReportDetailSchema
>;

export const securityScanReportListSchema = z
	.object({ items: z.array(securityScanReportDetailSchema) })
	.strict();

export const securityScanStartReportResponseSchema = z
	.object({
		report: securityScanReportDetailSchema,
		replayed: z.boolean(),
	})
	.strict();

export const securityScanBindingSchema = z
	.object({
		scanRunRef: opaqueRefSchema,
		selection: securityScanSelectionSchema,
		target: securityScanTargetSchema,
		createdAt: timestampSchema,
	})
	.strict();
export type SecurityScanBinding = z.infer<typeof securityScanBindingSchema>;

export const securityScanHistorySchema = z
	.object({ items: z.array(securityScanBindingSchema) })
	.strict();
