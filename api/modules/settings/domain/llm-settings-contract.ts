import { z } from "@hono/zod-openapi";
import {
	MAX_LLM_REQUEST_TIMEOUT_SECONDS,
	MIN_LLM_REQUEST_TIMEOUT_SECONDS,
	LLM_ROLE_ORDER as SHARED_LLM_ROLE_ORDER,
} from "../../../../shared/llm-role";

const providerEndpointKindSchema = z.enum([
	"azure",
	"openai",
	"openai-compatible",
	"bedrock",
	"codex",
	"local",
]);

export const llmRoleSchema = z.enum(SHARED_LLM_ROLE_ORDER);

const thinkingDepthSchema = z.enum(["", "low", "medium", "high", "very_high"]);

const llmModelCapabilitySchema = z.object({
	contextWindowTokens: z.number().int().positive().optional(),
	safePromptBudgetTokens: z.number().int().positive().optional(),
	reservedOutputTokens: z.number().int().positive().optional(),
	supportsProviderSideCompression: z.boolean().optional(),
	compressionProfile: z.string().optional(),
});

export const llmProviderEndpointSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	kind: providerEndpointKindSchema,
	enabled: z.boolean().default(true),
	apiKey: z.string().optional().default(""),
	baseUrl: z.string().optional().default(""),
	endpoint: z.string().optional().default(""),
	apiVersion: z.string().optional().default(""),
	region: z.string().optional().default(""),
	models: z.array(z.string()).default([]),
	modelDisplayNames: z.record(z.string(), z.string()).optional().default({}),
	defaultModelCapability: llmModelCapabilitySchema.optional(),
	modelCapabilities: z.record(z.string(), llmModelCapabilitySchema).optional(),
});

export const llmModelTargetSchema = z.object({
	providerEndpointId: z.string().default(""),
	model: z.string().default(""),
	thinkingDepth: thinkingDepthSchema.optional().default(""),
	requestTimeoutSeconds: z
		.number()
		.int()
		.min(MIN_LLM_REQUEST_TIMEOUT_SECONDS)
		.max(MAX_LLM_REQUEST_TIMEOUT_SECONDS)
		.optional(),
});

export const llmRoleRouteSchema = z.object({
	role: llmRoleSchema,
	primary: llmModelTargetSchema.optional(),
	fallbacks: z.array(llmModelTargetSchema).default([]),
	providerEndpointId: z.string().optional(),
	model: z.string().optional(),
	fallbackProviderEndpointId: z.string().optional(),
	fallbackModel: z.string().optional(),
});

export const llmSettingsSchema = z.object({
	settingsRevision: z.string().optional(),
	endpointIdSchemaVersion: z.number().int().positive().optional(),
	providerEnablementMigrationVersion: z.number().int().positive().optional(),
	ACTIVE_LLM_PROVIDER: z
		.string()
		.default("azure")
		.openapi({ example: "azure" }),
	OPENAI_ENABLED: z.boolean().default(true).openapi({ example: true }),
	AZURE_OPENAI_API_KEY: z
		.string()
		.default("")
		.openapi({ example: "your-azure-key" }),
	AZURE_OPENAI_ENABLED: z.boolean().default(false).openapi({ example: false }),
	AZURE_OPENAI_ENDPOINT: z
		.string()
		.default("")
		.openapi({ example: "https://xxx.openai.azure.com/" }),
	AZURE_OPENAI_DEPLOYMENT_NAME: z
		.string()
		.default("")
		.openapi({ example: "gpt-5-mini" }),
	AZURE_OPENAI_API_VERSION: z
		.string()
		.default("")
		.openapi({ example: "2024-05-01-preview" }),
	AWS_BEDROCK_ENABLED: z.boolean().default(false).openapi({ example: false }),
	AWS_ACCESS_KEY_ID: z
		.string()
		.default("")
		.openapi({ example: "your-aws-access-key" }),
	AWS_SECRET_ACCESS_KEY: z
		.string()
		.default("")
		.openapi({ example: "your-aws-secret-key" }),
	AWS_REGION: z.string().default("").openapi({ example: "us-east-1" }),
	AWS_BEDROCK_MODEL: z
		.string()
		.default("")
		.openapi({ example: "anthropic.claude-3-5-sonnet-20241022-v2:0" }),
	OPENAI_API_KEY: z
		.string()
		.default("")
		.openapi({ example: "sk-your-openai-key" }),
	OPENAI_BASE_URL: z
		.string()
		.default("")
		.openapi({ example: "https://api.openai.com/v1" }),
	OPENAI_MODEL: z.string().default("").openapi({ example: "gpt-4o" }),
	CODEX_ENABLED: z.boolean().default(false).openapi({ example: false }),
	CODEX_ACCESS_TOKEN: z
		.string()
		.default("")
		.openapi({ example: "your-codex-token" }),
	CODEX_MODEL: z.string().default("").openapi({ example: "gpt-5.4-mini" }),
	IMPLEMENTATION_RUNTIME_LANE: z
		.enum([
			"",
			"native-api-runner",
			"native-supervisor",
			"codex-sdk",
			"codex-agent",
		])
		.default("")
		.openapi({ example: "codex-sdk" }),
	SESSION_QUEUE_MAX_CONCURRENCY: z
		.number()
		.int()
		.positive()
		.default(2)
		.openapi({ example: 2 }),
	providerEndpoints: z.array(llmProviderEndpointSchema).default([]),
	roleRoutes: z.array(llmRoleRouteSchema).default([]),
});

export type RawLlmSettings = z.infer<typeof llmSettingsSchema>;
export type LlmProviderEndpoint = RawLlmSettings["providerEndpoints"][number];
export type LlmModelTarget = {
	providerEndpointId: string;
	model: string;
	thinkingDepth: z.infer<typeof thinkingDepthSchema>;
	requestTimeoutSeconds?: number;
};
export type LlmRole = z.infer<typeof llmRoleSchema>;
export type LlmRoleRoute = {
	role: LlmRole;
	primary: LlmModelTarget;
	fallbacks: LlmModelTarget[];
};
export type LlmSettings = Omit<RawLlmSettings, "roleRoutes"> & {
	roleRoutes: LlmRoleRoute[];
};

export const SECRET_SETTING_KEYS = [
	"AZURE_OPENAI_API_KEY",
	"AWS_SECRET_ACCESS_KEY",
	"OPENAI_API_KEY",
	"CODEX_ACCESS_TOKEN",
] as const satisfies ReadonlyArray<keyof RawLlmSettings>;

export const providerModelOptions = {
	azure: ["gpt-5.5", "gpt-5.4-mini", "gpt-5-mini"],
	openai: ["gpt-5.5", "gpt-5.4-mini", "gpt-5-mini", "gpt-4.1-mini"],
	bedrock: ["anthropic.claude-3-5-sonnet-20241022-v2:0"],
	codex: ["gpt-5.5", "gpt-5.4-mini", "gpt-5-mini"],
} as const;

export const LLM_ROLE_ORDER: LlmRole[] = [...SHARED_LLM_ROLE_ORDER];
