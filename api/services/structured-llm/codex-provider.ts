import { Codex, type Thread as CodexThread } from "@openai/codex-sdk";
import { RuntimeSessionStateStore } from "../agent-runtime/runtime-session-state";
import { normalizeProviderUsage } from "../llm-usage";
import { resolveCodexOutputSchemaMode } from "./codex-output-schema";
import type { RawLlmCallOptions } from "./providers";
import {
	getResolvedProviderEndpoint,
	toCodexReasoningEffort,
} from "./providers";
import {
	type getStructuredLlmBoolSetting,
	getStructuredLlmSetting,
	type readStructuredLlmProviderSettings,
} from "./settings";
import type { ProviderCallResult } from "./types";

const CODEX_STRUCTURED_RUNTIME_LANE = "structured-llm";
const CODEX_RESUMED_SYSTEM_REFRESH_MAX_CHARS = 2_000;
const defaultCodexStructuredSessionStore = new RuntimeSessionStateStore();
export type CodexProviderInput = {
	provider: string;
	systemPrompt: string;
	userPrompt: string;
	options: RawLlmCallOptions;
	signal: AbortSignal;
	setProviderDebug: (value: Record<string, unknown>) => void;
};

export function buildCodexStructuredExecutionMode(input: {
	role?: string | null;
	model: string | null;
	schemaName: string;
}) {
	return [
		"structured",
		input.role || "default",
		input.model || "default-model",
		input.schemaName,
	].join(":");
}

export function buildCodexResumedStructuredPrompt(input: {
	schemaName: string;
	systemPrompt: string;
	userPrompt: string;
}) {
	const systemRefresh = compactCodexResumedSystemPrompt(input.systemPrompt);
	return [
		"Continue the existing NightWorkers structured artifact thread.",
		"The stable system and project context from the earlier turn is already present in this Codex thread.",
		`Current structured output schema: ${input.schemaName}`,
		"Follow the current turn outputSchema when one is provided. Return only the requested structured output.",
		"",
		"## Current Turn System Refresh",
		systemRefresh,
		"",
		"## Current Turn User Prompt",
		input.userPrompt,
	].join("\n");
}

function compactCodexResumedSystemPrompt(systemPrompt: string) {
	const trimmed = systemPrompt.trim();
	if (trimmed.length <= CODEX_RESUMED_SYSTEM_REFRESH_MAX_CHARS) return trimmed;
	return [
		trimmed.slice(0, CODEX_RESUMED_SYSTEM_REFRESH_MAX_CHARS).trimEnd(),
		"",
		`[System prompt truncated for resumed Codex thread: ${trimmed.length - CODEX_RESUMED_SYSTEM_REFRESH_MAX_CHARS} chars omitted. Stable prior context remains in the resumed thread.]`,
	].join("\n");
}

export async function callCodexProvider(
	input: CodexProviderInput,
	isEnabled: (
		key: Parameters<typeof getStructuredLlmBoolSetting>[1],
		fallback: boolean,
	) => boolean,
	settings: ReturnType<typeof readStructuredLlmProviderSettings>,
): Promise<ProviderCallResult> {
	const endpoint = getResolvedProviderEndpoint(input, settings);
	if (!endpoint?.enabled && !isEnabled("CODEX_ENABLED", false)) {
		throw new Error("Codex provider is inactive. Enable CODEX_ENABLED first.");
	}
	const model =
		input.options.normalizedRequest?.modelOrDeployment ||
		endpoint?.models[0] ||
		getStructuredLlmSetting(settings, "CODEX_MODEL", "gpt-5.4-mini");
	const accessToken =
		endpoint?.apiKey || getStructuredLlmSetting(settings, "CODEX_ACCESS_TOKEN");
	const modelReasoningEffort = toCodexReasoningEffort(
		input.options.normalizedRequest?.thinkingDepth ||
			getStructuredLlmSetting(settings, "CODEX_MODEL_REASONING_EFFORT") ||
			"low",
	);
	const codex = new Codex({
		env: {
			...sanitizeCodexProviderEnv(process.env),
			...(accessToken ? { CODEX_ACCESS_TOKEN: accessToken } : {}),
		},
		config: {
			features: { mcp: false },
			mcp_servers: {},
		},
	});
	const threadOptions = {
		model,
		sandboxMode: "read-only",
		approvalPolicy: "never",
		networkAccessEnabled: false,
		webSearchMode: "disabled",
		workingDirectory: input.options.workingDirectory || process.cwd(),
		skipGitRepoCheck: true,
		modelReasoningEffort,
	} as const;
	const sessionStore =
		input.options.runtimeSessionStore ?? defaultCodexStructuredSessionStore;
	const sessionLookup =
		input.options.taskId !== undefined
			? {
					taskId: input.options.taskId,
					runtimeLane: CODEX_STRUCTURED_RUNTIME_LANE,
					provider: "codex",
					executionMode: buildCodexStructuredExecutionMode({
						role: input.options.role,
						model,
						schemaName: input.options.jsonSchema?.name ?? input.options.label,
					}),
				}
			: null;
	let thread: CodexThread;
	let resumeState:
		| { status: "unavailable" }
		| { status: "reused"; providerThreadId: string; stateId: string }
		| {
				status: "fallback_started_fresh";
				providerThreadId: string;
				stateId: string;
				error: string;
		  } = { status: "unavailable" };
	if (sessionLookup) {
		const state =
			await sessionStore.getLatestRuntimeSessionStateForTask(sessionLookup);
		if (state?.providerSessionId) {
			try {
				thread = codex.resumeThread(state.providerSessionId, threadOptions);
				resumeState = {
					status: "reused",
					providerThreadId: state.providerSessionId,
					stateId: state.id,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await sessionStore.markRuntimeSessionStateResumeFailed({
					id: state.id,
					error: message,
				});
				thread = codex.startThread(threadOptions);
				resumeState = {
					status: "fallback_started_fresh",
					providerThreadId: state.providerSessionId,
					stateId: state.id,
					error: message,
				};
			}
		} else {
			thread = codex.startThread(threadOptions);
		}
	} else {
		thread = codex.startThread(threadOptions);
	}
	const outputSchemaMode = resolveCodexOutputSchemaMode(
		input.options.jsonSchema?.schema,
	);
	const omitOutputSchema = outputSchemaMode.mode === "prompt_validated_json";
	const runOptions: { outputSchema?: unknown; signal: AbortSignal } = {
		signal: input.signal,
	};
	const outputSchema = input.options.jsonSchema?.schema;
	if (!omitOutputSchema && outputSchema !== undefined) {
		runOptions.outputSchema = outputSchema;
	}
	let resumedThread = resumeState.status === "reused";
	let turnInput = resumedThread
		? [
				{
					type: "text" as const,
					text: buildCodexResumedStructuredPrompt({
						schemaName: input.options.jsonSchema?.name ?? input.options.label,
						systemPrompt: input.systemPrompt,
						userPrompt: input.userPrompt,
					}),
				},
			]
		: [
				{ type: "text" as const, text: input.systemPrompt },
				{ type: "text" as const, text: input.userPrompt },
			];
	let turn: Awaited<ReturnType<CodexThread["run"]>>;
	try {
		turn = await thread.run(turnInput, runOptions);
	} catch (error) {
		if (resumeState.status !== "reused" || !sessionLookup) throw error;
		const message = error instanceof Error ? error.message : String(error);
		await sessionStore.markRuntimeSessionStateResumeFailed({
			id: resumeState.stateId,
			error: message,
		});
		thread = codex.startThread(threadOptions);
		resumeState = {
			status: "fallback_started_fresh",
			providerThreadId: resumeState.providerThreadId,
			stateId: resumeState.stateId,
			error: message,
		};
		resumedThread = false;
		turnInput = [
			{ type: "text" as const, text: input.systemPrompt },
			{ type: "text" as const, text: input.userPrompt },
		];
		turn = await thread.run(turnInput, runOptions);
	}
	const content = turn.finalResponse || "";
	if (sessionLookup && thread.id) {
		await sessionStore.upsertRuntimeSessionState({
			...sessionLookup,
			runId: input.options.runId ?? null,
			providerSessionId: thread.id,
			model,
			metadata: {
				providerEndpointId: endpoint?.id ?? null,
				role: input.options.role ?? null,
				label: input.options.label,
				jsonSchemaName: input.options.jsonSchema?.name ?? null,
				resumeState: resumeState.status,
			},
		});
	}
	const providerDebug = {
		provider: "codex",
		providerEndpointId: endpoint?.id ?? null,
		providerMode: omitOutputSchema
			? "prompt_validated_json"
			: "structured_output",
		model,
		modelReasoningEffort,
		outputSchemaModeReasons: outputSchemaMode.reasons,
		resumeState: resumeState.status,
		providerThreadId: thread.id ?? null,
		resumedInputReduced: resumedThread,
		hasUsage: Boolean(turn.usage),
		itemCount: turn.items.length,
	};
	input.setProviderDebug(providerDebug);
	return {
		content,
		usage: normalizeProviderUsage({
			provider: "codex",
			rawUsage: turn.usage,
			fallback: {
				systemPrompt: input.systemPrompt,
				userPrompt: input.userPrompt,
				responseText: content,
			},
		}),
		model,
		providerDebug,
	};
}

export function sanitizeCodexProviderEnv(
	env: NodeJS.ProcessEnv,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(env).filter((entry): entry is [string, string] => {
			const [key, value] = entry;
			return (
				typeof value === "string" &&
				key !== "CODEX_THREAD_ID" &&
				key !== "CODEX_INTERNAL_ORIGINATOR_OVERRIDE" &&
				key !== "CODEX_SHELL" &&
				key !== "CODEX_CI"
			);
		}),
	);
}
