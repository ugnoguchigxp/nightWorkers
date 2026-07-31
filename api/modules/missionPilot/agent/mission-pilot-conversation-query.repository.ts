import { createHash } from "node:crypto";
import {
	missionPilotAgentSessions,
	missionPilotAgentTurns,
	missionPilotConversationItems,
	missionPilotSessions,
	missionPilotToolCalls,
	toControlSummary,
} from "@nightworkers/mission-pilot/backend";
import type { MissionPilotActionFailure } from "@nightworkers/mission-pilot/contracts";
import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "../../../db/client";
import type {
	ProviderToolCall,
	ProviderToolMessage,
} from "../../../services/structured-llm/public";
import { publishMissionPilotUpdated } from "../mission-pilot-realtime";
import { reconcileMissionPilotActionExecutionReceipts } from "./mission-pilot-action-execution.repository";
import { clearMissionPilotAgentTaskActive } from "./mission-pilot-agent-active-registry";
import { sliceMissionPilotUtf8Page } from "./mission-pilot-content-page";

export async function finishMissionPilotAgentTurn(input: {
	sessionId: string;
	turnId: string;
	leaseOwner: string;
	state: "waiting" | "attention" | "completed" | "stopped";
	error?: unknown;
}) {
	const now = new Date();
	const updated = await db.transaction(async (tx) => {
		const [base] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, input.sessionId));
		await tx
			.update(missionPilotAgentTurns)
			.set({
				status:
					input.state === "stopped"
						? "cancelled"
						: input.error
							? "failed"
							: "completed",
				finishedAt: now,
				errorJson: input.error ?? null,
			})
			.where(
				and(
					eq(missionPilotAgentTurns.id, input.turnId),
					inArray(missionPilotAgentTurns.status, ["running", "waiting_tool"]),
				),
			);
		await tx
			.update(missionPilotAgentSessions)
			.set({
				runtimeState: input.state,
				currentTurnId: null,
				leaseOwner: null,
				leaseExpiresAt: null,
				lastFailureJson: input.error
					? (input.error as MissionPilotActionFailure)
					: null,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotAgentSessions.sessionId, input.sessionId),
					eq(missionPilotAgentSessions.leaseOwner, input.leaseOwner),
				),
			);
		if (!base || input.state === "stopped") return null;
		const phase =
			input.state === "attention"
				? "attention"
				: input.state === "completed"
					? "completed"
					: base.nextWakeAt
						? "waiting_intervention"
						: "paused";
		const [updated] = await tx
			.update(missionPilotSessions)
			.set({
				phase,
				desiredState:
					input.state === "completed" ? "stopped" : base.desiredState,
				nextWakeAt: input.state === "completed" ? null : base.nextWakeAt,
				stoppedAt: input.state === "completed" ? now : base.stoppedAt,
				lastErrorCode: input.error
					? (input.error as MissionPilotActionFailure).kind
					: null,
				lastErrorMessage: input.error
					? (input.error as MissionPilotActionFailure).message
					: null,
				version: base.version + 1,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.id, input.sessionId),
					eq(missionPilotSessions.desiredState, "playing"),
					eq(missionPilotSessions.version, base.version),
				),
			)
			.returning();
		return updated ?? null;
	});
	if (updated) {
		if (input.state === "completed")
			clearMissionPilotAgentTaskActive(updated.taskId);
		publishMissionPilotUpdated(updated.taskId, toControlSummary(updated));
	}
	return updated;
}

export async function loadMissionPilotProviderMessages(
	sessionId: string,
): Promise<ProviderToolMessage[]> {
	const items = await listMissionPilotConversation(sessionId);
	const latestCompactionIndex = items.findLastIndex(
		(item) => item.kind === "compaction_summary",
	);
	const latestCompaction = items[latestCompactionIndex];
	const compactionBody = asRecord(latestCompaction?.bodyJson);
	const sourceThroughSequence =
		typeof compactionBody.sourceThroughSequence === "number"
			? compactionBody.sourceThroughSequence
			: (latestCompaction?.sequence ?? 0) - 1;
	const projectedItems =
		latestCompactionIndex < 0
			? items
			: [
					...items.filter(
						(item, index) =>
							item.kind === "system_context" && index < latestCompactionIndex,
					),
					latestCompaction,
					...items.filter(
						(item) =>
							item.id !== latestCompaction?.id &&
							item.kind !== "system_context" &&
							item.sequence > sourceThroughSequence,
					),
				];
	const recentTurnIds = [
		...new Set(
			projectedItems
				.map((item) => item.turnId)
				.filter((turnId): turnId is string => Boolean(turnId))
				.reverse(),
		),
	].slice(0, 6);
	const latestTurnId = projectedItems.findLast((item) => item.turnId)?.turnId;
	const latestUserItemId = projectedItems.findLast((item) =>
		["user", "repair_request"].includes(item.kind),
	)?.id;
	const boundedItems = projectedItems.filter(
		(item) =>
			item.kind === "system_context" ||
			item.kind === "compaction_summary" ||
			item.id === latestUserItemId ||
			(item.turnId ? recentTurnIds.includes(item.turnId) : false),
	);
	const messages = boundedItems.flatMap((item): ProviderToolMessage[] => {
		const body = asRecord(item.bodyJson);
		if (item.kind === "system_context")
			return [{ role: "system", content: text(body.content) }];
		if (["user", "repair_request"].includes(item.kind))
			return [
				{
					role: "user",
					content: text(body.content) || JSON.stringify(item.bodyJson),
				},
			];
		if (
			item.kind === "task_event" ||
			item.kind === "run_outcome" ||
			item.kind === "compaction_summary" ||
			item.kind === "runtime_failure"
		)
			return [{ role: "user", content: JSON.stringify(item.bodyJson) }];
		if (item.kind === "assistant")
			return [
				{
					role: "assistant",
					content: text(body.content),
					...(Array.isArray(body.toolCalls)
						? { toolCalls: body.toolCalls as ProviderToolCall[] }
						: {}),
				},
			];
		if (item.kind === "tool_result")
			if (item.turnId !== latestTurnId)
				return [
					{
						role: "user",
						content: JSON.stringify({
							type: "consumed_resource_receipt",
							toolCallId: item.toolCallId,
							sourceRef: {
								kind: item.sourceKind ?? "tool_result",
								id: item.sourceId ?? item.id,
							},
							sourceRevision: item.sequence,
							sourceDigest: digest(JSON.stringify(item.bodyJson)),
						}),
					},
				];
		if (item.kind === "tool_result")
			return [
				{
					role: "tool",
					toolCallId: text(body.providerCallId) || item.toolCallId || "",
					content: text(body.content) || JSON.stringify(body),
				},
			];
		return [];
	});
	return boundMissionPilotProviderConversation(messages);
}

const MAX_PROVIDER_CONVERSATION_BYTES = 48_000;
const MAX_PROVIDER_MESSAGE_BYTES = 12_000;
export function boundMissionPilotProviderConversation(
	messages: ProviderToolMessage[],
) {
	const system = messages.find((message) => message.role === "system");
	const selected: ProviderToolMessage[] = [];
	let bytes = system ? Buffer.byteLength(JSON.stringify(system), "utf8") : 0;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const source = messages[index];
		if (!source || source === system) continue;
		const message = boundProviderMessage(source);
		const nextBytes = Buffer.byteLength(JSON.stringify(message), "utf8");
		if (bytes + nextBytes > MAX_PROVIDER_CONVERSATION_BYTES) continue;
		selected.unshift(message);
		bytes += nextBytes;
	}
	return system ? [system, ...selected] : selected;
}

function boundProviderMessage(
	message: ProviderToolMessage,
): ProviderToolMessage {
	if (typeof message.content !== "string") return message;
	const originalBytes = Buffer.byteLength(message.content, "utf8");
	if (originalBytes <= MAX_PROVIDER_MESSAGE_BYTES) return message;
	const page = sliceMissionPilotUtf8Page(message.content, {
		maxBytes: 8_000,
		maxChars: 8_000,
	});
	return {
		...message,
		content: JSON.stringify({
			type: "bounded_conversation_receipt",
			contentPrefix: page.content,
			originalBytes,
			sourceDigest: digest(message.content),
			nextCursor: page.page.nextCursor,
		}),
	};
}

function digest(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function getMissionPilotConversationCheckpoint(sessionId: string) {
	return db.transaction(async (tx) => {
		const [agent] = await tx
			.select({ revision: missionPilotAgentSessions.conversationRevision })
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, sessionId));
		const [last] = await tx
			.select({ sequence: missionPilotConversationItems.sequence })
			.from(missionPilotConversationItems)
			.where(eq(missionPilotConversationItems.sessionId, sessionId))
			.orderBy(desc(missionPilotConversationItems.sequence))
			.limit(1);
		return agent
			? {
					revision: agent.revision,
					sourceThroughSequence: last?.sequence ?? 0,
				}
			: null;
	});
}

export async function listMissionPilotConversation(sessionId: string) {
	return db
		.select()
		.from(missionPilotConversationItems)
		.where(eq(missionPilotConversationItems.sessionId, sessionId))
		.orderBy(asc(missionPilotConversationItems.sequence));
}

export async function reconcileInterruptedMissionPilotAgentSessions(
	now = new Date(),
) {
	const sessions = await db
		.select({ session: missionPilotSessions, agent: missionPilotAgentSessions })
		.from(missionPilotSessions)
		.innerJoin(
			missionPilotAgentSessions,
			eq(missionPilotAgentSessions.sessionId, missionPilotSessions.id),
		)
		.where(
			and(
				eq(missionPilotAgentSessions.engineMode, "agent"),
				eq(missionPilotAgentSessions.runtimeState, "running"),
				or(
					isNull(missionPilotAgentSessions.leaseExpiresAt),
					lte(missionPilotAgentSessions.leaseExpiresAt, now),
				),
			),
		);
	for (const { session, agent } of sessions) {
		const reconciledReceipts =
			await reconcileMissionPilotActionExecutionReceipts(session.id);
		const receiptByToolCallId = new Map(
			reconciledReceipts.map((receipt) => [receipt.toolCallId, receipt]),
		);
		const unresolvedCalls = await db
			.select()
			.from(missionPilotToolCalls)
			.where(
				and(
					eq(missionPilotToolCalls.sessionId, session.id),
					inArray(missionPilotToolCalls.status, ["pending", "running"]),
				),
			);
		for (const call of unresolvedCalls) {
			const receipt = receiptByToolCallId.get(call.id);
			if (receipt?.status === "succeeded") {
				await import("./mission-pilot-conversation.repository").then(
					({ completeMissionPilotToolCall }) =>
						completeMissionPilotToolCall({
							id: call.id,
							result: receipt.resultJson,
						}),
				);
				continue;
			}
			if (
				receipt?.status === "failed" ||
				receipt?.status === "outcome_unknown"
			) {
				await import("./mission-pilot-conversation.repository").then(
					({ completeMissionPilotToolCall }) =>
						completeMissionPilotToolCall({
							id: call.id,
							failure: receipt.failureJson ?? interruptedToolCallFailure(call),
						}),
				);
				continue;
			}
			await import("./mission-pilot-conversation.repository").then(
				({ completeMissionPilotToolCall }) =>
					completeMissionPilotToolCall({
						id: call.id,
						failure: interruptedToolCallFailure(call),
					}),
			);
		}
		await db
			.update(missionPilotAgentTurns)
			.set({
				status: "failed",
				finishedAt: now,
				errorJson: { kind: "outcome_unknown", reason: "lease_expired" },
			})
			.where(
				and(
					eq(missionPilotAgentTurns.sessionId, session.id),
					inArray(missionPilotAgentTurns.status, ["running", "waiting_tool"]),
				),
			);
		await db
			.update(missionPilotAgentSessions)
			.set({
				runtimeState:
					session.desiredState === "playing" ? "waiting" : "stopped",
				currentTurnId: null,
				leaseOwner: null,
				leaseExpiresAt: null,
				lastFailureJson: interruptedRuntimeFailure(),
				updatedAt: now,
			})
			.where(eq(missionPilotAgentSessions.sessionId, agent.sessionId));
	}
	return sessions.map(({ session }) => session);
}

function interruptedToolCallFailure(
	call: typeof missionPilotToolCalls.$inferSelect,
): MissionPilotActionFailure {
	return {
		kind: call.status === "running" ? "outcome_unknown" : "domain_precondition",
		retryable: false,
		providerCode: null,
		httpStatus: null,
		message:
			call.status === "running"
				? "Process stopped while this mutation was running. Re-read current state before deciding whether to retry."
				: "Process stopped before this action started. Re-read current state before deciding whether to retry.",
		retryAfterMs: null,
		attempt: 1,
		actionId: call.actionId,
		idempotencyKey: call.idempotencyKey,
		currentTaskRevision: null,
		details: null,
	};
}

function interruptedRuntimeFailure(): MissionPilotActionFailure {
	return {
		kind: "outcome_unknown",
		retryable: false,
		providerCode: null,
		httpStatus: null,
		message:
			"Process stopped while this turn was running. Re-read current state before deciding whether to retry.",
		retryAfterMs: null,
		attempt: 1,
		actionId: "runtime.reconcile",
		idempotencyKey: null,
		currentTaskRevision: null,
		details: null,
	};
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function text(value: unknown) {
	return typeof value === "string" ? value : "";
}
