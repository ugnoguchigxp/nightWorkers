import { z } from "zod";
import { canonicalDigest } from "../../agentsShare";

export type CodingAgentUnknownToolCall = {
	callId: string;
	toolName: string;
	argumentsDigest: string;
	startedEventSeq: number;
	evidenceRef: string;
	outcome: "unknown";
};

export type CodingAgentProcessInterruptionSnapshot = {
	version: 1;
	kind: "process_interrupted";
	revision: number;
	interruptedAt: string;
	reason: "graceful_shutdown" | "process_restarted" | "worker_lost";
	resumableRunningTodo: boolean;
	previousOwner: {
		kind: "api_process" | "worker_process";
		instanceId: string;
		leaseVersion: number;
	};
	run: {
		id: string;
		agentModeSessionId: string;
		status: string;
	};
	currentTodo: {
		id: string;
		todoKey: string;
		revision: number;
		status: "running";
	} | null;
	workspace: {
		id: string;
		allocationVersion: number;
		repositoryIdentityRevision: number;
		attestationId: string;
		attestationDigest: string;
	} | null;
	providerSession: {
		stateId: string;
		providerThreadId: string;
		model: string | null;
	} | null;
	unresolvedToolCalls: CodingAgentUnknownToolCall[];
};

type ToolEventRow = {
	id: string;
	seq: number;
	payloadJson: unknown;
};

const processInterruptionSnapshotSchema = z
	.object({
		version: z.literal(1),
		kind: z.literal("process_interrupted"),
		revision: z.number().int().positive(),
		interruptedAt: z.string().min(1),
		reason: z.enum(["graceful_shutdown", "process_restarted", "worker_lost"]),
		resumableRunningTodo: z.boolean(),
		previousOwner: z
			.object({
				kind: z.enum(["api_process", "worker_process"]),
				instanceId: z.string().min(1),
				leaseVersion: z.number().int().nonnegative(),
			})
			.strict(),
		run: z
			.object({
				id: z.string().min(1),
				agentModeSessionId: z.string().min(1),
				status: z.string().min(1),
			})
			.strict(),
		currentTodo: z
			.object({
				id: z.string().min(1),
				todoKey: z.string().min(1),
				revision: z.number().int().nonnegative(),
				status: z.literal("running"),
			})
			.strict()
			.nullable(),
		workspace: z
			.object({
				id: z.string().min(1),
				allocationVersion: z.number().int().nonnegative(),
				repositoryIdentityRevision: z.number().int().nonnegative(),
				attestationId: z.string().min(1),
				attestationDigest: z.string().min(1),
			})
			.strict()
			.nullable(),
		providerSession: z
			.object({
				stateId: z.string().min(1),
				providerThreadId: z.string().min(1),
				model: z.string().nullable(),
			})
			.strict()
			.nullable(),
		unresolvedToolCalls: z.array(
			z
				.object({
					callId: z.string().min(1),
					toolName: z.string().min(1),
					argumentsDigest: z.string().min(1),
					startedEventSeq: z.number().int().nonnegative(),
					evidenceRef: z.string().min(1),
					outcome: z.literal("unknown"),
				})
				.strict(),
		),
	})
	.strict();

export function projectUnknownOutcomeToolCalls(
	events: readonly ToolEventRow[],
): CodingAgentUnknownToolCall[] {
	const open = new Map<string, CodingAgentUnknownToolCall>();
	for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
		const runEvent = record(record(event.payloadJson)?.runEvent);
		const type = readString(runEvent?.type);
		if (type !== "tool.call_started" && type !== "tool.call_finished") continue;
		const data = record(runEvent?.data);
		const callId = readString(data?.callId) ?? readString(data?.providerItemId);
		if (!callId) continue;
		if (type === "tool.call_finished") {
			open.delete(callId);
			continue;
		}
		const toolName =
			readString(data?.toolName) ??
			readString(data?.mcpTool) ??
			readString(data?.providerItemType) ??
			"unknown_tool";
		const argumentsValue =
			data?.arguments ?? data?.command ?? data?.providerEventSummary ?? null;
		open.set(callId, {
			callId,
			toolName,
			argumentsDigest: canonicalDigest(argumentsValue),
			startedEventSeq: event.seq,
			evidenceRef: `task_event:${event.id}`,
			outcome: "unknown",
		});
	}
	return [...open.values()].sort(
		(left, right) => left.startedEventSeq - right.startedEventSeq,
	);
}

export function readProcessInterruptionSnapshot(
	value: unknown,
): CodingAgentProcessInterruptionSnapshot | null {
	const root = record(value);
	const parsed = processInterruptionSnapshotSchema.safeParse(
		root?.runtimePause,
	);
	return parsed.success ? parsed.data : null;
}

export function renderProcessInterruptionRecoveryGuidance(value: unknown) {
	const snapshot = readProcessInterruptionSnapshot(value);
	if (!snapshot) return "";
	const currentTodo = snapshot.currentTodo
		? `${snapshot.currentTodo.todoKey} (id=${snapshot.currentTodo.id}, revision=${snapshot.currentTodo.revision}, status=running)`
		: "none";
	const unknownCalls = snapshot.unresolvedToolCalls.length
		? snapshot.unresolvedToolCalls
				.map(
					(call) =>
						`- callId=${call.callId} tool=${call.toolName} argumentsDigest=${call.argumentsDigest} evidence=${call.evidenceRef} outcome=unknown`,
				)
				.join("\n")
		: "- none";
	return [
		"<PROCESS_INTERRUPTION_STATE_CARD>",
		`同じRunをprocess interruption revision=${snapshot.revision}から再開しています。`,
		`Run ID: ${snapshot.run.id}`,
		`Agent Mode Session ID: ${snapshot.run.agentModeSessionId}`,
		`Current Todo: ${currentTodo}`,
		"結果未確認のtool callを成功・失敗と推定せず、自動再実行しないでください。まずworkspaceと保存済みevidenceを観測し、必要な再検証または次actionを選んでください。",
		"Unknown outcome tool calls:",
		unknownCalls,
		"</PROCESS_INTERRUPTION_STATE_CARD>",
	].join("\n");
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
