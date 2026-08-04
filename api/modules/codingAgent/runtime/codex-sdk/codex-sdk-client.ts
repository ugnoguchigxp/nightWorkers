import type { Input } from "@openai/codex-sdk";
import { Codex } from "@openai/codex-sdk";
import { assertCodexAuthJsonAvailable } from "../../../../services/codex-global-config/status";
import { redactSecretText } from "../../../../services/security/secret-redaction";
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
	  }
	| {
			status: "fallback_started";
			providerThreadId: string;
			stateId?: string | null;
	  };

export async function createCodexRuntimeThread(input: {
	context: AgentRunContext;
	developerInstructions?: string;
	threadFactory?: CodexThreadFactory;
	codexClient?: CodexRuntimeClient;
	onResumeEvent?: (event: CodexThreadResumeEvent) => void | Promise<void>;
}): Promise<CodexRuntimeThread> {
	if (input.threadFactory) return input.threadFactory(input.context);
	const providerEndpointId = readCodexProviderEndpointId(input.context);
	if (resolveCodexEndpointAccessToken(providerEndpointId)) {
		throw new Error(
			"CODEX_CHILD_PROVIDER_CREDENTIAL_BLOCKED: NightWorkersのprovider credentialをCodex SDK child processへ渡すruntime laneは無効です。",
		);
	}
	const codexOptions = buildCodexRuntimeSdkOptions({
		env: process.env,
		context: input.context,
		developerInstructions: input.developerInstructions,
	});
	if (!input.codexClient) {
		assertCodexAuthJsonAvailable(codexOptions.env?.CODEX_HOME ?? "");
	}
	const codex = input.codexClient ?? new Codex(codexOptions);
	const threadOptions = buildCodexRuntimeThreadOptions(input.context);
	const resumeState = readCodexResumeState(input.context);
	if (resumeState?.providerThreadId) {
		let resumedThread: CodexRuntimeThread;
		try {
			resumedThread = await codex.resumeThread(
				resumeState.providerThreadId,
				threadOptions,
			);
			await input.onResumeEvent?.({
				status: "reused",
				providerThreadId: resumeState.providerThreadId,
				stateId: resumeState.stateId,
			});
		} catch (error) {
			await input.onResumeEvent?.({
				status: "resume_failed",
				providerThreadId: resumeState.providerThreadId,
				stateId: resumeState.stateId,
				error: formatResumeError(error),
			});
			await reportFallbackStarted(input, resumeState);
			return codex.startThread(threadOptions);
		}
		return wrapResumedThreadWithFreshFallback({
			resumedThread,
			startFreshThread: () => codex.startThread(threadOptions),
			providerThreadId: resumeState.providerThreadId,
			stateId: resumeState.stateId,
			onResumeEvent: input.onResumeEvent,
		});
	} else {
		await input.onResumeEvent?.({ status: "unavailable" });
	}
	return codex.startThread(threadOptions);
}

function wrapResumedThreadWithFreshFallback(input: {
	resumedThread: CodexRuntimeThread;
	startFreshThread: () => Promise<CodexRuntimeThread> | CodexRuntimeThread;
	providerThreadId: string;
	stateId?: string | null;
	onResumeEvent?: (event: CodexThreadResumeEvent) => void | Promise<void>;
}): CodexRuntimeThread {
	return {
		async runStreamed(prompt, options) {
			let resumedTurn: Awaited<ReturnType<CodexRuntimeThread["runStreamed"]>>;
			try {
				resumedTurn = await input.resumedThread.runStreamed(prompt, options);
			} catch (error) {
				if (options.signal.aborted) throw error;
				await reportResumeFailure(input, error);
				await reportFallbackStarted(input, input);
				const freshThread = await input.startFreshThread();
				return freshThread.runStreamed(prompt, options);
			}
			return {
				events: resumeEventsWithFreshFallback({
					...input,
					prompt,
					options,
					resumedEvents: resumedTurn.events,
				}),
			};
		},
	};
}

async function* resumeEventsWithFreshFallback(input: {
	resumedEvents: AsyncIterable<unknown>;
	prompt: Input;
	options: { signal: AbortSignal };
	startFreshThread: () => Promise<CodexRuntimeThread> | CodexRuntimeThread;
	providerThreadId: string;
	stateId?: string | null;
	onResumeEvent?: (event: CodexThreadResumeEvent) => void | Promise<void>;
}) {
	let emittedProviderEvent = false;
	try {
		for await (const event of input.resumedEvents) {
			emittedProviderEvent = true;
			yield event;
		}
	} catch (error) {
		if (emittedProviderEvent || input.options.signal.aborted) throw error;
		await reportResumeFailure(input, error);
		await reportFallbackStarted(input, input);
		const freshThread = await input.startFreshThread();
		const freshTurn = await freshThread.runStreamed(
			input.prompt,
			input.options,
		);
		for await (const event of freshTurn.events) yield event;
	}
}

async function reportFallbackStarted(
	input: {
		onResumeEvent?: (event: CodexThreadResumeEvent) => void | Promise<void>;
	},
	resume: { providerThreadId: string; stateId?: string | null },
) {
	await input.onResumeEvent?.({
		status: "fallback_started",
		providerThreadId: resume.providerThreadId,
		stateId: resume.stateId,
	});
}

async function reportResumeFailure(
	input: {
		providerThreadId: string;
		stateId?: string | null;
		onResumeEvent?: (event: CodexThreadResumeEvent) => void | Promise<void>;
	},
	error: unknown,
) {
	await input.onResumeEvent?.({
		status: "resume_failed",
		providerThreadId: input.providerThreadId,
		stateId: input.stateId,
		error: formatResumeError(error),
	});
}

function formatResumeError(error: unknown) {
	return redactSecretText(
		error instanceof Error ? error.message : String(error),
	).slice(0, 2_000);
}

function readCodexProviderEndpointId(context: AgentRunContext) {
	const codex = readRecord(context.runtimeOptions?.codex);
	return readString(codex?.providerEndpointId);
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
