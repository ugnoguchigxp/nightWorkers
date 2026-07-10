import { Codex } from "@openai/codex-sdk";
import type { AgentRunContext } from "../types";
import {
	buildCodexRuntimeSdkOptions,
	buildCodexRuntimeThreadOptions,
} from "./codex-sdk-runtime-config";

export type CodexRuntimeThread = {
	runStreamed(
		prompt: string,
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
			status: "fallback_started_fresh";
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
	const codexOptions = buildCodexRuntimeSdkOptions({
		accessToken: process.env.CODEX_ACCESS_TOKEN || "",
		env: {
			...process.env,
			NIGHTWORKERS_TASK_ID: input.context.taskId,
			NIGHTWORKERS_RUN_ID: input.context.runId,
			NIGHTWORKERS_EXECUTION_MODE: readCodexRuntimeExecutionMode(input.context),
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
			const thread = await codex.resumeThread(
				resumeState.providerThreadId,
				threadOptions,
			);
			await input.onResumeEvent?.({
				status: "reused",
				providerThreadId: resumeState.providerThreadId,
				stateId: resumeState.stateId,
			});
			return thread;
		} catch (error) {
			await input.onResumeEvent?.({
				status: "fallback_started_fresh",
				providerThreadId: resumeState.providerThreadId,
				stateId: resumeState.stateId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	} else {
		await input.onResumeEvent?.({ status: "unavailable" });
	}
	return codex.startThread(threadOptions);
}

function readCodexRuntimeExecutionMode(context: AgentRunContext) {
	const value = context.runtimeOptions?.executionMode;
	if (typeof value === "string") return value;
	const snapshotValue = context.contextSnapshot.executionMode;
	return typeof snapshotValue === "string" ? snapshotValue : "implementation";
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
	if (!resume || resume.kind !== "codex_thread") return null;
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
