import type { Input } from "@openai/codex-sdk";
import { Codex } from "@openai/codex-sdk";
import { resolveCodexEndpointAccessToken } from "../../../../services/structured-llm/codex-auth-scope";
import type { AgentRunContext } from "../types";
import {
	buildCodexRuntimeSdkOptions,
	buildCodexRuntimeThreadOptions,
} from "./codex-sdk-runtime-config";

export type CodexRuntimeThread = {
	runStreamed(
		prompt: Input,
		options: { signal: AbortSignal },
	): Promise<{ events: AsyncIterable<unknown> }>;
};

export type CodexRuntimeClient = {
	startThread(
		options: ReturnType<typeof buildCodexRuntimeThreadOptions>,
	): Promise<CodexRuntimeThread> | CodexRuntimeThread;
	resumeThread(
		id: string,
		options: ReturnType<typeof buildCodexRuntimeThreadOptions>,
	): Promise<CodexRuntimeThread> | CodexRuntimeThread;
};

export type CodexThreadFactory = (
	context: AgentRunContext,
) => Promise<CodexRuntimeThread> | CodexRuntimeThread;

export type CodexThreadResumeEvent =
	| { status: "unavailable" }
	| { status: "reused"; providerThreadId: string; stateId?: string | null }
	| {
			status: "resume_failed";
			providerThreadId: string;
			stateId?: string | null;
			error: string;
	  };

export async function createCodexRuntimeThread(input: {
	context: AgentRunContext;
	threadFactory?: CodexThreadFactory;
	codexClient?: CodexRuntimeClient;
	onResumeEvent?: (event: CodexThreadResumeEvent) => void | Promise<void>;
	forceFresh?: boolean;
}): Promise<CodexRuntimeThread> {
	if (input.threadFactory) return input.threadFactory(input.context);
	const providerEndpointId = readCodexProviderEndpointId(input.context);
	const codexOptions = buildCodexRuntimeSdkOptions({
		accessToken: resolveCodexEndpointAccessToken(providerEndpointId),
		env: {
			...process.env,
			NIGHTWORKERS_TASK_ID: input.context.taskId,
			NIGHTWORKERS_RUN_ID: input.context.runId,
			NIGHTWORKERS_ONTOLOGY_MCP_ENABLED: readOntologyMcpEnabled(input.context)
				? "true"
				: "false",
		},
	});
	const codex = input.codexClient ?? new Codex(codexOptions);
	const threadOptions = buildCodexRuntimeThreadOptions(input.context);
	const resumeState = input.forceFresh
		? null
		: readCodexResumeState(input.context);
	if (resumeState?.providerThreadId) {
		try {
			let activeThread = await codex.resumeThread(
				resumeState.providerThreadId,
				threadOptions,
			);
			await input.onResumeEvent?.({
				status: "reused",
				providerThreadId: resumeState.providerThreadId,
				stateId: resumeState.stateId,
			});
			let firstTurn = true;
			return {
				async runStreamed(prompt, options) {
					const mayRecoverResume = firstTurn;
					firstTurn = false;
					if (!mayRecoverResume) {
						return activeThread.runStreamed(prompt, options);
					}
					const resumedThread = activeThread;
					return {
						events: recoverFirstResumedTurn({
							resumedThread,
							prompt,
							options,
							startFreshThread: async (error) => {
								await input.onResumeEvent?.({
									status: "resume_failed",
									providerThreadId: resumeState.providerThreadId,
									stateId: resumeState.stateId,
									error: error instanceof Error ? error.message : String(error),
								});
								activeThread = await codex.startThread(threadOptions);
								return activeThread;
							},
						}),
					};
				},
			};
		} catch (error) {
			await input.onResumeEvent?.({
				status: "resume_failed",
				providerThreadId: resumeState.providerThreadId,
				stateId: resumeState.stateId,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	} else {
		await input.onResumeEvent?.({ status: "unavailable" });
	}
	return codex.startThread(threadOptions);
}

async function* recoverFirstResumedTurn(input: {
	resumedThread: CodexRuntimeThread;
	prompt: Input;
	options: { signal: AbortSignal };
	startFreshThread: (error: unknown) => Promise<CodexRuntimeThread>;
}) {
	let emittedEvent = false;
	try {
		const resumedTurn = await input.resumedThread.runStreamed(
			input.prompt,
			input.options,
		);
		for await (const event of resumedTurn.events) {
			emittedEvent = true;
			yield event;
		}
		return;
	} catch (error) {
		if (emittedEvent || input.options.signal.aborted) throw error;
		const freshThread = await input.startFreshThread(error);
		const freshTurn = await freshThread.runStreamed(
			input.prompt,
			input.options,
		);
		for await (const event of freshTurn.events) yield event;
	}
}

function readCodexProviderEndpointId(context: AgentRunContext) {
	const codex = readRecord(context.runtimeOptions?.codex);
	return readString(codex?.providerEndpointId);
}

function readOntologyMcpEnabled(context: AgentRunContext) {
	const snapshot = context.contextSnapshot as Record<string, unknown>;
	const ontologyMcp = readRecord(snapshot.ontologyMcp);
	const enabled = ontologyMcp?.enabled;
	return enabled === true;
}

function readCodexResumeState(context: AgentRunContext) {
	const fromOptions = readRecord(context.runtimeOptions?.runtimeResume);
	const fromSnapshot = readRecord(context.contextSnapshot.runtimeResume);
	const resume = fromOptions ?? fromSnapshot;
	if (resume?.kind !== "codex_thread") return null;
	const providerThreadId = readString(resume.providerThreadId);
	if (!providerThreadId) return null;
	return {
		providerThreadId,
		stateId: readString(resume.stateId),
	};
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
