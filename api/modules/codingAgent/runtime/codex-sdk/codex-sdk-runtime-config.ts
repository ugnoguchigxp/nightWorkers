import type { CodexOptions, ThreadOptions } from "@openai/codex-sdk";
import type { AgentRunContext } from "../types";

type CodexRuntimeConfigInput = {
	accessToken?: string;
	env?: NodeJS.ProcessEnv;
};

export function buildCodexRuntimeSdkOptions(
	input: CodexRuntimeConfigInput = {},
): CodexOptions {
	const env = input.env ?? process.env;
	const sdkOptions: CodexOptions = {};
	const sanitizedEnv = Object.fromEntries(
		Object.entries(env).filter((entry): entry is [string, string] => {
			const [key, value] = entry;
			return typeof value === "string" && !isCodexParentSessionEnv(key);
		}),
	);
	sdkOptions.env = {
		...sanitizedEnv,
		...(input.accessToken ? { CODEX_ACCESS_TOKEN: input.accessToken } : {}),
	};
	return sdkOptions;
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
		...(modelReasoningEffort ? { modelReasoningEffort } : {}),
	};
}
function isCodexParentSessionEnv(key: string) {
	return (
		key === "CODEX_THREAD_ID" ||
		key === "CODEX_INTERNAL_ORIGINATOR_OVERRIDE" ||
		key === "CODEX_SHELL" ||
		key === "CODEX_CI"
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
