import { createRoute, z } from "@hono/zod-openapi";
import {
	SUPPORTED_CURRENCIES,
	SUPPORTED_LANGUAGES,
	validateTimezone,
} from "../services/settings/general-settings";
import {
	llmProviderEndpointSchema,
	llmSettingsSchema,
} from "./settings-runtime";

const llmModelsSchema = z.object({
	activeProvider: z.enum(["azure", "openai", "bedrock", "codex"]),
	options: z.array(z.object({ value: z.string(), label: z.string() })),
});

const llmProviderHealthSchema = z.object({
	ok: z.boolean(),
	reachable: z.boolean(),
	providerEndpointId: z.string(),
	providerKind: z.enum([
		"azure",
		"openai",
		"openai-compatible",
		"bedrock",
		"codex",
		"local",
	]),
	url: z.string().nullable(),
	status: z.number().nullable(),
	durationMs: z.number(),
	checkedAt: z.string(),
	message: z.string(),
	probeKind: z.enum(["connectivity", "execution_readiness"]).optional(),
	model: z.string().nullable().optional(),
	targetDigest: z.string().nullable().optional(),
});

const codexSdkStatusSchema = z.object({
	loggedIn: z.boolean(),
	authSource: z.enum([
		"settings-token",
		"environment-token",
		"codex-auth-json",
		"missing",
	]),
	codexHome: z.string(),
	models: z.array(z.object({ value: z.string(), label: z.string() })),
	modelSource: z.enum(["codex-models-cache", "settings", "fallback"]),
	checkedAt: z.string(),
});

const generalSettingsSchema = z.object({
	timezone: z.string().refine(validateTimezone, "Invalid timezone"),
	language: z.enum(SUPPORTED_LANGUAGES as [string, string]),
	currency: z.enum(SUPPORTED_CURRENCIES as [string, string, string]),
	fx: z.object({
		source: z.enum(["ecb", "manual"]),
		autoRefresh: z.boolean(),
		lastRefreshedAt: z.string().nullable(),
	}),
	planMode: z.object({
		capabilities: z.object({
			feature_plan: z.boolean(),
			questionnaire: z.boolean(),
			user_flow: z.boolean(),
			blueprint: z.boolean(),
			data_model: z.boolean(),
			api_io_contract: z.boolean(),
			activity_flow: z.boolean(),
			sequence_flow: z.boolean(),
			zod_schema_design: z.boolean(),
		}),
	}),
	llmUsage: z
		.object({
			promptPartObservabilityEnabled: z.boolean(),
		})
		.optional(),
	dataRetention: z
		.object({
			apiLogDays: z
				.number()
				.int()
				.refine((value): boolean => value === 7),
			llmRawLogDays: z
				.number()
				.int()
				.refine((value): boolean => value === 3),
			codingAgentFullRecordDays: z.number().int().min(1).max(365),
			usageDataDays: z
				.number()
				.int()
				.refine((value): boolean => value === 30),
			auditEventDays: z
				.number()
				.int()
				.refine((value): boolean => value === 90),
			apiLogMaxBytes: z
				.number()
				.int()
				.positive()
				.max(128 * 1024 * 1024),
			llmRawLogsMaxBytes: z
				.number()
				.int()
				.positive()
				.max(256 * 1024 * 1024),
			runtimeLogsMaxBytes: z
				.number()
				.int()
				.positive()
				.max(512 * 1024 * 1024),
			apiSegmentMaxBytes: z
				.number()
				.int()
				.positive()
				.max(32 * 1024 * 1024),
			llmSegmentMaxBytes: z
				.number()
				.int()
				.positive()
				.max(64 * 1024 * 1024),
			sweepIntervalMinutes: z
				.number()
				.int()
				.positive()
				.max(24 * 60),
		})
		.optional(),
});

const fxRateCacheSchema = z
	.object({
		source: z.enum(["ecb", "manual"]),
		baseCurrency: z.literal("EUR"),
		validOn: z.string(),
		fetchedAt: z.string(),
		rates: z.record(z.string(), z.number()),
	})
	.nullable();

const pricingRowSchema = z.object({
	id: z.string(),
	provider: z.string(),
	model: z.string(),
	currencyCode: z.string(),
	inputPer1m: z.number().nullable(),
	cachedInputPer1m: z.number().nullable(),
	outputPer1m: z.number().nullable(),
	reasoningOutputPer1m: z.number().nullable(),
	sourceUrl: z.string().nullable(),
	sourceLabel: z.string().nullable(),
	effectiveFrom: z.unknown(),
	fetchedAt: z.unknown().nullable(),
	manualOverride: z.boolean(),
	enabled: z.boolean(),
	createdAt: z.unknown(),
	updatedAt: z.unknown(),
});

const pricingInputSchema = z.object({
	provider: z.string().min(1),
	model: z.string().min(1),
	currencyCode: z.string().default("USD"),
	inputPer1m: z.number().nonnegative().nullable().optional(),
	cachedInputPer1m: z.number().nonnegative().nullable().optional(),
	outputPer1m: z.number().nonnegative().nullable().optional(),
	reasoningOutputPer1m: z.number().nonnegative().nullable().optional(),
	sourceUrl: z.string().nullable().optional(),
	sourceLabel: z.string().nullable().optional(),
	effectiveFrom: z.string().nullable().optional(),
	fetchedAt: z.string().nullable().optional(),
	manualOverride: z.boolean().optional(),
	enabled: z.boolean().optional(),
});

const pricingPageSchema = z.object({
	rows: z.array(pricingRowSchema),
	totalCount: z.number().int().nonnegative(),
	nextCursor: z.string().nullable(),
});

const publicPricingImportSchema = z.object({
	sourceUrl: z.string(),
	fetchedAt: z.string(),
	imported: z.number(),
	skipped: z.number(),
	providers: z.array(z.string()),
	rows: z.array(pricingRowSchema),
});

const startupPreflightSchema = z.object({
	mode: z.enum(["desktop", "development", "production"]),
	runtimeRoot: z.string(),
	resourceRoot: z.string(),
	checks: z.array(
		z.object({
			id: z.string(),
			label: z.string(),
			status: z.enum(["pass", "warn", "fail"]),
			detail: z.string(),
		}),
	),
});

export const getLlmSettingsRoute = createRoute({
	method: "get",
	path: "/llm",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: llmSettingsSchema,
				},
			},
			description: "Get LLM Settings",
		},
	},
});

export const saveLlmSettingsRoute = createRoute({
	method: "post",
	path: "/llm",
	request: {
		body: {
			content: {
				"application/json": {
					schema: llmSettingsSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean().openapi({ example: true }),
					}),
				},
			},
			description: "Save LLM Settings",
		},
	},
});

export const getLlmModelsRoute = createRoute({
	method: "get",
	path: "/llm/models",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: llmModelsSchema,
				},
			},
			description: "Get model options for active provider",
		},
	},
});

export const getCodexSdkStatusRoute = createRoute({
	method: "get",
	path: "/codex/status",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: codexSdkStatusSchema,
				},
			},
			description: "Get Codex SDK login status and model options",
		},
	},
});

export const getGeneralSettingsRoute = createRoute({
	method: "get",
	path: "/general",
	responses: {
		200: {
			content: { "application/json": { schema: generalSettingsSchema } },
			description: "Get general settings",
		},
	},
});

export const saveGeneralSettingsRoute = createRoute({
	method: "post",
	path: "/general",
	request: {
		body: {
			content: {
				"application/json": {
					schema: generalSettingsSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: generalSettingsSchema } },
			description: "Save general settings",
		},
	},
});

const retentionCleanupPreviewSchema = z.object({
	previewId: z.string(),
	settingsRevision: z.number().int().nonnegative(),
	policyDigest: z.string(),
	cutoffAt: z.string(),
	expiresAt: z.string(),
	databaseBytesBefore: z.number().nonnegative(),
	walBytesBefore: z.number().nonnegative(),
	deletable: z.object({
		payloads: z.number().int().nonnegative(),
		detailRows: z.number().int().nonnegative(),
		estimatedPayloadBytes: z.number().int().nonnegative(),
		estimatedDatabaseBytes: z.number().int().nonnegative(),
	}),
	protected: z.object({
		activeRuns: z.number().int().nonnegative(),
		reviewPendingRuns: z.number().int().nonnegative(),
		closeoutPendingRuns: z.number().int().nonnegative(),
		needsHumanRuns: z.number().int().nonnegative(),
	}),
	categories: z.array(
		z.object({
			kind: z.string(),
			records: z.number().int().nonnegative(),
			estimatedBytes: z.number().int().nonnegative(),
		}),
	),
});

export const previewDataRetentionCleanupRoute = createRoute({
	method: "post",
	path: "/data-retention/cleanup/preview",
	responses: {
		200: {
			content: {
				"application/json": { schema: retentionCleanupPreviewSchema },
			},
			description: "Preview expired Coding Agent full-record cleanup",
		},
	},
});

export const executeDataRetentionCleanupRoute = createRoute({
	method: "post",
	path: "/data-retention/cleanup",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						previewId: z.string().min(1),
						expectedSettingsRevision: z.number().int().nonnegative(),
						idempotencyKey: z.string().min(8).max(200),
						reclaimDiskSpace: z.enum(["incremental", "skip"]),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						status: z.literal("completed"),
						runsPurged: z.number().int().nonnegative(),
						detailRowsDeleted: z.number().int().nonnegative(),
						detailBytesPurged: z.number().int().nonnegative(),
						rowsDeleted: z.record(z.string(), z.number()),
						reclaim: z.object({
							requested: z.enum(["incremental", "skip"]),
							status: z.enum(["completed", "skipped", "unsupported"]),
						}),
					}),
				},
			},
			description: "Execute an approved cleanup preview",
		},
	},
});

export const getFxRatesRoute = createRoute({
	method: "get",
	path: "/fx",
	responses: {
		200: {
			content: { "application/json": { schema: fxRateCacheSchema } },
			description: "Get FX rate cache",
		},
	},
});

export const refreshFxRatesRoute = createRoute({
	method: "post",
	path: "/fx/refresh",
	responses: {
		200: {
			content: { "application/json": { schema: fxRateCacheSchema.unwrap() } },
			description: "Refresh FX rate cache",
		},
		500: {
			content: {
				"application/json": { schema: z.object({ error: z.string() }) },
			},
			description: "FX refresh failed",
		},
	},
});

export const getStartupPreflightRoute = createRoute({
	method: "get",
	path: "/preflight/startup",
	responses: {
		200: {
			content: { "application/json": { schema: startupPreflightSchema } },
			description: "Get startup preflight diagnostics",
		},
	},
});

export const listPricingRoute = createRoute({
	method: "get",
	path: "/pricing",
	request: {
		query: z.object({
			provider: z.string().trim().min(1).optional(),
			model: z.string().trim().optional(),
			limit: z.coerce.number().int().min(1).max(100).default(50),
			cursor: z.string().regex(/^\d+$/).optional(),
		}),
	},
	responses: {
		200: {
			content: { "application/json": { schema: pricingPageSchema } },
			description: "List LLM model pricing",
		},
	},
});

export const savePricingRoute = createRoute({
	method: "post",
	path: "/pricing",
	request: {
		body: {
			content: {
				"application/json": {
					schema: pricingInputSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: pricingRowSchema } },
			description: "Create or update LLM model pricing",
		},
	},
});

export const seedCodexPricingRoute = createRoute({
	method: "post",
	path: "/pricing/seed-codex",
	responses: {
		200: {
			content: { "application/json": { schema: z.array(pricingRowSchema) } },
			description: "Seed official Codex credit pricing rows",
		},
	},
});

export const importPublicPricingRoute = createRoute({
	method: "post",
	path: "/pricing/import-public",
	responses: {
		200: {
			content: { "application/json": { schema: publicPricingImportSchema } },
			description:
				"Import LLM pricing rows from the public LiteLLM model price JSON",
		},
		500: {
			content: {
				"application/json": { schema: z.object({ error: z.string() }) },
			},
			description: "Public LLM pricing import failed",
		},
	},
});

export const smokeLlmRoute = createRoute({
	method: "post",
	path: "/llm/smoke",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						ok: z.boolean(),
						provider: z.string(),
						message: z.string(),
					}),
				},
			},
			description: "Run LLM smoke test with active provider",
		},
	},
});

export const testLlmProviderHealthRoute = createRoute({
	method: "post",
	path: "/llm/providers/{id}/health",
	request: {
		params: z.object({ id: z.string().min(1) }),
		body: {
			required: false,
			content: {
				"application/json": {
					schema: z.object({ endpoint: llmProviderEndpointSchema.optional() }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: llmProviderHealthSchema,
				},
			},
			description:
				"Check provider execution readiness using its configured model and API path",
		},
		404: {
			description: "LLM provider endpoint not found",
		},
	},
});

export * from "../modules/settings";
