import { createRoute, z } from "@hono/zod-openapi";
import {
	agentHookConfigSchema,
	agentHookInputSchema,
	agentHooksResponseSchema,
	agentHookTestResponseSchema,
	agentHookUpdateInputSchema,
} from "../services/hooks/hooks-config-schema";
import {
	mcpServerConfigSchema,
	mcpServerImportRequestSchema,
	mcpServerImportResponseSchema,
	mcpServerInputSchema,
	mcpServersResponseSchema,
	mcpServerTestResponseSchema,
	mcpServerUpdateInputSchema,
} from "../services/mcp/mcp-config-schema";
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
			description: "Check provider endpoint /health reachability",
		},
		404: {
			description: "LLM provider endpoint not found",
		},
	},
});

export const getMcpServersRoute = createRoute({
	method: "get",
	path: "/mcp/servers",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: mcpServersResponseSchema,
				},
			},
			description: "List configured MCP servers",
		},
	},
});

export const createMcpServerRoute = createRoute({
	method: "post",
	path: "/mcp/servers",
	request: {
		body: {
			content: {
				"application/json": {
					schema: mcpServerInputSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: mcpServerConfigSchema,
				},
			},
			description: "Create MCP server",
		},
	},
});

export const importMcpServersRoute = createRoute({
	method: "post",
	path: "/mcp/servers/import",
	request: {
		body: {
			content: {
				"application/json": {
					schema: mcpServerImportRequestSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: mcpServerImportResponseSchema,
				},
			},
			description: "Import MCP servers from pasted JSON config",
		},
	},
});

export const updateMcpServerRoute = createRoute({
	method: "put",
	path: "/mcp/servers/{id}",
	request: {
		params: z.object({ id: z.string().uuid() }),
		body: {
			content: {
				"application/json": {
					schema: mcpServerUpdateInputSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: mcpServerConfigSchema,
				},
			},
			description: "Update MCP server",
		},
		404: {
			description: "MCP server not found",
		},
	},
});

export const deleteMcpServerRoute = createRoute({
	method: "delete",
	path: "/mcp/servers/{id}",
	request: {
		params: z.object({ id: z.string().uuid() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: mcpServerConfigSchema,
				},
			},
			description: "Delete MCP server",
		},
		404: {
			description: "MCP server not found",
		},
	},
});

export const testMcpServerRoute = createRoute({
	method: "post",
	path: "/mcp/servers/{id}/test",
	request: {
		params: z.object({ id: z.string().uuid() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: mcpServerTestResponseSchema,
				},
			},
			description: "Test MCP server connection",
		},
		404: {
			description: "MCP server not found",
		},
	},
});

export const getAgentHooksRoute = createRoute({
	method: "get",
	path: "/hooks",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: agentHooksResponseSchema,
				},
			},
			description: "List configured agent hooks",
		},
	},
});

export const createAgentHookRoute = createRoute({
	method: "post",
	path: "/hooks",
	request: {
		body: {
			content: {
				"application/json": {
					schema: agentHookInputSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: agentHookConfigSchema,
				},
			},
			description: "Create agent hook",
		},
	},
});

export const updateAgentHookRoute = createRoute({
	method: "put",
	path: "/hooks/{id}",
	request: {
		params: z.object({ id: z.string().uuid() }),
		body: {
			content: {
				"application/json": {
					schema: agentHookUpdateInputSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: agentHookConfigSchema,
				},
			},
			description: "Update agent hook",
		},
		404: {
			description: "Agent hook not found",
		},
	},
});

export const deleteAgentHookRoute = createRoute({
	method: "delete",
	path: "/hooks/{id}",
	request: {
		params: z.object({ id: z.string().uuid() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: agentHookConfigSchema,
				},
			},
			description: "Delete agent hook",
		},
		404: {
			description: "Agent hook not found",
		},
	},
});

export const testAgentHookRoute = createRoute({
	method: "post",
	path: "/hooks/{id}/test",
	request: {
		params: z.object({ id: z.string().uuid() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: agentHookTestResponseSchema,
				},
			},
			description: "Test agent hook",
		},
		404: {
			description: "Agent hook not found",
		},
	},
});
