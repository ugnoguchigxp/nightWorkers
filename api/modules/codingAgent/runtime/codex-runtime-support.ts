import type { RuntimeSessionStateStore } from "../../../services/runtime-session-state";
import type { AgentRunContext, AgentRuntimeEvent } from "./types";

export async function persistCodexProviderThreadIfPresent(
	store: RuntimeSessionStateStore,
	context: AgentRunContext,
	event: AgentRuntimeEvent,
) {
	if (event.type !== "runtime_started") return;
	const providerThreadId = readString(readEventPayload(event).providerThreadId);
	if (!providerThreadId) return;
	await store.upsertRuntimeSessionState({
		taskId: context.taskId,
		agentModeSessionId: context.agentModeSessionId,
		repositoryId: context.repositoryId,
		runId: context.runId,
		runtimeLane: "codex-sdk",
		provider: "codex",
		providerSessionId: providerThreadId,
		executionMode: "implementation",
		model: readCodexRuntimeModel(context),
		metadata: {
			source: "thread.started",
			providerThreadId,
		},
	});
	const runtimeResume =
		readRecord(context.runtimeOptions?.runtimeResume) ??
		readRecord(context.contextSnapshot.runtimeResume);
	const intakeStateId = readString(runtimeResume?.stateId);
	if (runtimeResume?.source === "intake_gate_handoff" && intakeStateId) {
		await store.markRuntimeSessionStateSuperseded({ id: intakeStateId });
	}
}

export function updateCodexSessionKey(
	current: string | null,
	event: AgentRuntimeEvent,
) {
	if (event.type !== "runtime_started") return current;
	return readString(readEventPayload(event).providerThreadId) ?? current;
}

export function readPromptPartObservabilityEnabled(context: AgentRunContext) {
	const llmUsage = readRecord(context.runtimeOptions?.llmUsage);
	return llmUsage?.promptPartObservabilityEnabled !== false;
}

function readCodexRuntimeModel(context: AgentRunContext) {
	return readString(readRecord(context.runtimeOptions?.codex)?.model);
}

function readEventPayload(event: AgentRuntimeEvent): Record<string, unknown> {
	return readRecord(event.payload) ?? {};
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function changedFilesFromDiff(diff: string): string[] {
	const files = new Set<string>();
	for (const line of diff.split("\n")) {
		const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
		if (match?.[2]) files.add(match[2]);
	}
	return [...files];
}
