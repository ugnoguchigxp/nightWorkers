import type { CodexOptions, ThreadOptions } from "@openai/codex-sdk";
import { buildNightWorkersCodexToolApprovalConfig } from "../../../../mcp/nightworkers-tool-manifest";
import { getCodexGlobalHome } from "../../../../services/codex-global-config/paths";
import { buildChildProcessEnvironment } from "../../../../services/execution/child-process-environment";
import { isRegistryCredentialEnvironmentKey } from "../../../../services/security/secret-redaction";
import type { AgentRunContext } from "../types";
import {
	buildCodexRuntimeDeveloperInstructions,
	isMinimalReviewRuntime,
} from "./codex-sdk-runtime-prompt";

type CodexRuntimeConfigInput = {
	env?: NodeJS.ProcessEnv;
	context?: AgentRunContext;
	developerInstructions?: string;
};

const DEFAULT_NIGHTWORKERS_API_PORT = 39_173;
const WORKSPACE_RUNTIME_ENVIRONMENT_KEYS = new Set([
	"PATH",
	"TMPDIR",
	"TMP",
	"TEMP",
	"HOME",
	"USERPROFILE",
	"XDG_CONFIG_HOME",
	"XDG_CACHE_HOME",
	"BUN_INSTALL_CACHE_DIR",
	"npm_config_cache",
	"YARN_CACHE_FOLDER",
	"UV_CACHE_DIR",
	"UV_PROJECT_ENVIRONMENT",
	"VIRTUAL_ENV",
	"PIP_CACHE_DIR",
	"POETRY_CACHE_DIR",
	"POETRY_VIRTUALENVS_PATH",
	"BUNDLE_PATH",
	"BUNDLE_CACHE_PATH",
	"BUNDLE_FROZEN",
	"COMPOSER_CACHE_DIR",
	"GOMODCACHE",
	"GOCACHE",
	"CARGO_HOME",
	"CARGO_TARGET_DIR",
	"NUGET_PACKAGES",
	"GRADLE_USER_HOME",
]);

export function buildCodexRuntimeSdkOptions(
	input: CodexRuntimeConfigInput = {},
): CodexOptions {
	const env = input.env ?? process.env;
	const sdkOptions: CodexOptions = {};
	const sanitizedEnv = buildChildProcessEnvironment({
		purpose: "provider_runtime",
		source: env,
	});
	const workspaceEnv = readWorkspaceRuntimeEnvironment(input.context);
	sdkOptions.env = {
		...sanitizedEnv,
		...workspaceEnv,
		CODEX_HOME: getCodexGlobalHome(env),
	};
	if (input.context) {
		const nightworkersMcpUrl = buildRequestScopedNightWorkersMcpUrl(
			input.context,
			env,
		);
		sdkOptions.config = isMinimalReviewRuntime(input.context)
			? {
					mcp_servers: {
						nightworkers: {
							url: nightworkersMcpUrl,
							enabled: false,
						},
					},
				}
			: {
					developer_instructions:
						input.developerInstructions ??
						buildCodexRuntimeDeveloperInstructions(input.context),
					mcp_servers: {
						nightworkers: {
							url: nightworkersMcpUrl,
							enabled: true,
							required: true,
							tools: buildNightWorkersCodexToolApprovalConfig(),
						},
					},
				};
	}
	return sdkOptions;
}

export function buildRequestScopedNightWorkersMcpUrl(
	context: Pick<AgentRunContext, "runId" | "taskId">,
	env: NodeJS.ProcessEnv = process.env,
) {
	const configuredMcpUrl = env.NIGHTWORKERS_CODEX_MCP_URL?.trim();
	const apiOrigin =
		env.NIGHTWORKERS_API_ORIGIN?.trim() ||
		`http://127.0.0.1:${readListenPort(env.PORT)}`;
	const url = configuredMcpUrl
		? new URL(configuredMcpUrl)
		: new URL("/mcp/nightworkers", apiOrigin);
	url.searchParams.set("taskId", context.taskId);
	url.searchParams.set("runId", context.runId);
	return url.toString();
}

function readListenPort(value: string | undefined) {
	const port = Number(value);
	return Number.isInteger(port) && port >= 1 && port <= 65_535
		? port
		: DEFAULT_NIGHTWORKERS_API_PORT;
}

export function buildCodexRuntimeThreadOptions(
	context: AgentRunContext,
): ThreadOptions {
	const codexOptions =
		context.runtimeOptions?.codex &&
		typeof context.runtimeOptions.codex === "object"
			? (context.runtimeOptions.codex as Record<string, unknown>)
			: {};
	const model =
		typeof codexOptions.model === "string" ? codexOptions.model : undefined;
	const configuredEffort =
		typeof codexOptions.thinkingDepth === "string"
			? codexOptions.thinkingDepth
			: process.env.CODEX_MODEL_REASONING_EFFORT;
	const modelReasoningEffort = toCodexReasoningEffort(configuredEffort);
	return {
		model,
		sandboxMode: "workspace-write",
		approvalPolicy: "never",
		workingDirectory: context.repoRoot,
		skipGitRepoCheck: true,
		...readAdditionalDirectories(context),
		...(modelReasoningEffort ? { modelReasoningEffort } : {}),
	};
}

function readAdditionalDirectories(
	context: AgentRunContext,
): Pick<ThreadOptions, "additionalDirectories"> {
	if (!isMinimalReviewRuntime(context)) return {};
	const reviewRuntime = context.runtimeOptions?.reviewRuntime;
	if (
		!reviewRuntime ||
		typeof reviewRuntime !== "object" ||
		Array.isArray(reviewRuntime)
	) {
		return {};
	}
	const value = (reviewRuntime as Record<string, unknown>)
		.additionalDirectories;
	if (!Array.isArray(value)) return {};
	const additionalDirectories = value.filter(
		(directory): directory is string =>
			typeof directory === "string" && directory.length > 0,
	);
	return additionalDirectories.length > 0 ? { additionalDirectories } : {};
}

function readWorkspaceRuntimeEnvironment(context?: AgentRunContext) {
	const candidate = context?.runtimeOptions?.workspaceRuntimeEnvironment;
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(candidate).filter(
			(entry): entry is [string, string] =>
				typeof entry[1] === "string" &&
				WORKSPACE_RUNTIME_ENVIRONMENT_KEYS.has(entry[0]) &&
				!isRegistryCredentialEnvironmentKey(entry[0], entry[1]),
		),
	);
}

function toCodexReasoningEffort(
	value: string | undefined,
): "minimal" | "low" | "medium" | "high" | "xhigh" | null {
	if (
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high"
	) {
		return value;
	}
	if (value === "very_high" || value === "xhigh") return "xhigh";
	return null;
}
