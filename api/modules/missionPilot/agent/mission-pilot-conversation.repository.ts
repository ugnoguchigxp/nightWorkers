import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { MissionPilotActionFailure } from "../../../../shared/schemas/mission-pilot-agent.schema";
import { db } from "../../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotAgentTurns,
	missionPilotConversationItems,
	missionPilotTaskEventInbox,
	missionPilotToolCalls,
} from "../../../db/mission-pilot-agent-schema";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";
import {
	implementationQueueEntries,
	taskMessages,
	taskRuns,
} from "../../../db/schema";
import type {
	ProviderToolCall,
	ProviderToolMessage,
} from "../../../services/structured-llm/public";
import { MISSION_PILOT_AGENT_LEASE_MS } from "./mission-pilot-agent.constants";
import { getMissionPilotActionByToolName } from "./mission-pilot-task-action.registry";

export async function seedMissionPilotConversation(input: {
	sessionId: string;
	systemContext: string;
	initialPrompt: string;
}) {
	return db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, input.sessionId));
		const [agent] = await tx
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, input.sessionId));
		if (!session || !agent || agent.engineMode !== "agent") return false;
		const [existing] = await tx
			.select({ id: missionPilotConversationItems.id })
			.from(missionPilotConversationItems)
			.where(eq(missionPilotConversationItems.sessionId, session.id))
			.limit(1);
		if (existing) return false;
		const now = new Date();
		await tx.insert(missionPilotConversationItems).values([
			{
				id: crypto.randomUUID(),
				sessionId: session.id,
				sequence: agent.nextConversationSequence,
				kind: "system_context",
				bodyJson: {
					version: agent.systemContextVersion,
					content: input.systemContext,
				},
				createdAt: now,
			},
			{
				id: crypto.randomUUID(),
				sessionId: session.id,
				sequence: agent.nextConversationSequence + 1,
				kind: "user",
				bodyJson: { content: input.initialPrompt },
				sourceKind: "task",
				sourceId: session.taskId,
				createdAt: now,
			},
		]);
		await tx
			.update(missionPilotAgentSessions)
			.set({
				nextConversationSequence: agent.nextConversationSequence + 2,
				conversationRevision: agent.conversationRevision + 1,
				updatedAt: now,
			})
			.where(eq(missionPilotAgentSessions.sessionId, session.id));
		return true;
	});
}

export async function appendMissionPilotUserMessage(input: {
	sessionId: string;
	content: string;
	sourceKind?: string;
	sourceId?: string;
}) {
	return appendConversationItem({
		...input,
		kind: "user",
		body: { content: input.content },
	});
}

export async function appendMissionPilotRuntimeFailure(input: {
	sessionId: string;
	failure: MissionPilotActionFailure;
	leaseOwner?: string;
}) {
	return appendConversationItem({
		sessionId: input.sessionId,
		kind: "runtime_failure",
		body: { failure: input.failure },
		sourceKind: "runtime_failure",
		sourceId: input.failure.actionId,
		leaseOwner: input.leaseOwner,
	});
}

async function appendConversationItem(input: {
	sessionId: string;
	kind:
		| "user"
		| "assistant"
		| "task_event"
		| "run_outcome"
		| "compaction_summary"
		| "runtime_failure"
		| "repair_request";
	body: unknown;
	turnId?: string | null;
	sourceKind?: string | null;
	sourceId?: string | null;
	leaseOwner?: string;
}) {
	return db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, input.sessionId));
		const [agent] = await tx
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, input.sessionId));
		if (
			!session ||
			!agent ||
			(input.leaseOwner !== undefined &&
				(agent.runtimeState !== "running" ||
					agent.leaseOwner !== input.leaseOwner))
		)
			return null;
		const now = new Date();
		const [item] = await tx
			.insert(missionPilotConversationItems)
			.values({
				id: crypto.randomUUID(),
				sessionId: session.id,
				sequence: agent.nextConversationSequence,
				kind: input.kind,
				bodyJson: input.body,
				turnId: input.turnId ?? null,
				sourceKind: input.sourceKind ?? null,
				sourceId: input.sourceId ?? null,
				createdAt: now,
			})
			.returning();
		await tx
			.update(missionPilotAgentSessions)
			.set({
				nextConversationSequence: agent.nextConversationSequence + 1,
				conversationRevision: agent.conversationRevision + 1,
				updatedAt: now,
			})
			.where(eq(missionPilotAgentSessions.sessionId, session.id));
		return item ?? null;
	});
}

export async function claimMissionPilotAgentTurn(input: {
	sessionId: string;
	leaseOwner: string;
	now?: Date;
}) {
	const now = input.now ?? new Date();
	return db.transaction(async (tx) => {
		const [base] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, input.sessionId));
		const [agent] = await tx
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, input.sessionId));
		if (
			!base ||
			!agent ||
			agent.engineMode !== "agent" ||
			base.desiredState !== "playing" ||
			agent.runtimeState === "completed" ||
			agent.runtimeState === "running" ||
			(agent.leaseExpiresAt && agent.leaseExpiresAt > now)
		)
			return null;
		const events = await tx
			.select()
			.from(missionPilotTaskEventInbox)
			.where(
				and(
					eq(missionPilotTaskEventInbox.sessionId, base.id),
					isNull(missionPilotTaskEventInbox.consumedAt),
					lte(missionPilotTaskEventInbox.availableAt, now),
				),
			)
			.orderBy(asc(missionPilotTaskEventInbox.sequence));
		const turnId = crypto.randomUUID();
		const turnIndex = agent.nextTurnIndex;
		const from = events[0]?.sequence ?? null;
		const to = events.at(-1)?.sequence ?? null;
		const [claimedAgent] = await tx
			.update(missionPilotAgentSessions)
			.set({
				runtimeState: "running",
				leaseOwner: input.leaseOwner,
				leaseExpiresAt: new Date(now.getTime() + MISSION_PILOT_AGENT_LEASE_MS),
				currentTurnId: turnId,
				nextTurnIndex: turnIndex + 1,
				lastConsumedEventSequence: to ?? agent.lastConsumedEventSequence,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotAgentSessions.sessionId, base.id),
					eq(missionPilotAgentSessions.engineMode, "agent"),
					eq(missionPilotAgentSessions.runtimeState, agent.runtimeState),
				),
			)
			.returning();
		if (!claimedAgent) return null;
		await tx.insert(missionPilotAgentTurns).values({
			id: turnId,
			sessionId: base.id,
			turnIndex,
			triggerEventFrom: from,
			triggerEventTo: to,
			status: "running",
			startedAt: now,
		});
		if (events.length) {
			let conversationSequence = agent.nextConversationSequence;
			const projectedItems: Array<
				typeof missionPilotConversationItems.$inferInsert
			> = [
				{
					id: crypto.randomUUID(),
					sessionId: base.id,
					sequence: conversationSequence++,
					kind: "task_event" as const,
					turnId,
					bodyJson: {
						events: events.map((event) => ({
							sequence: event.sequence,
							eventType: event.eventType,
							taskRevision: event.taskRevision,
							payload: event.payloadJson,
						})),
					},
					sourceKind: "task_event_batch",
					sourceId: `${from}:${to}`,
					createdAt: now,
				},
			];
			for (const event of events) {
				const payload =
					event.payloadJson &&
					typeof event.payloadJson === "object" &&
					!Array.isArray(event.payloadJson)
						? (event.payloadJson as Record<string, unknown>)
						: {};
				if (
					event.eventType !== "task.user_message_added" ||
					typeof payload.messageId !== "string"
				)
					continue;
				const [message] = await tx
					.select({ id: taskMessages.id, content: taskMessages.content })
					.from(taskMessages)
					.where(
						and(
							eq(taskMessages.id, payload.messageId),
							eq(taskMessages.taskId, base.taskId),
						),
					);
				if (!message) continue;
				projectedItems.push({
					id: crypto.randomUUID(),
					sessionId: base.id,
					sequence: conversationSequence++,
					kind: "user" as const,
					turnId,
					bodyJson: { content: message.content },
					sourceKind: "task_message",
					sourceId: message.id,
					createdAt: now,
				});
			}
			await tx.insert(missionPilotConversationItems).values(projectedItems);
			await tx
				.update(missionPilotTaskEventInbox)
				.set({ consumedAt: now })
				.where(
					and(
						eq(missionPilotTaskEventInbox.sessionId, base.id),
						inArray(
							missionPilotTaskEventInbox.id,
							events.map((event) => event.id),
						),
					),
				);
			await tx
				.update(missionPilotAgentSessions)
				.set({
					nextConversationSequence: conversationSequence,
					conversationRevision: agent.conversationRevision + 1,
					updatedAt: now,
				})
				.where(eq(missionPilotAgentSessions.sessionId, base.id));
		}
		return {
			session: { ...base, ...claimedAgent, id: base.id },
			turnId,
			turnIndex,
		};
	});
}

export async function renewMissionPilotAgentTurnLease(input: {
	sessionId: string;
	turnId: string;
	leaseOwner: string;
}) {
	const [row] = await db
		.update(missionPilotAgentSessions)
		.set({
			leaseExpiresAt: new Date(Date.now() + MISSION_PILOT_AGENT_LEASE_MS),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotAgentSessions.sessionId, input.sessionId),
				eq(missionPilotAgentSessions.currentTurnId, input.turnId),
				eq(missionPilotAgentSessions.leaseOwner, input.leaseOwner),
				eq(missionPilotAgentSessions.runtimeState, "running"),
			),
		)
		.returning({ sessionId: missionPilotAgentSessions.sessionId });
	return Boolean(row);
}

export async function persistMissionPilotProviderTurn(input: {
	sessionId: string;
	turnId: string;
	leaseOwner: string;
	content: string;
	toolCalls: ProviderToolCall[];
	provider?: string | null;
	model?: string | null;
}) {
	return db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, input.sessionId));
		const [agent] = await tx
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, input.sessionId));
		if (
			!session ||
			!agent ||
			session.desiredState !== "playing" ||
			agent.runtimeState !== "running" ||
			agent.leaseOwner !== input.leaseOwner ||
			agent.currentTurnId !== input.turnId
		)
			return null;
		const now = new Date();
		let sequence = agent.nextConversationSequence;
		await tx.insert(missionPilotConversationItems).values({
			id: crypto.randomUUID(),
			sessionId: session.id,
			sequence,
			kind: "assistant",
			turnId: input.turnId,
			bodyJson: { content: input.content, toolCalls: input.toolCalls },
			createdAt: now,
		});
		sequence += 1;
		const rows = [];
		for (const call of input.toolCalls) {
			const action = getMissionPilotActionByToolName(call.name);
			const idempotencyKey = `${session.id}:${input.turnId}:${call.id}`;
			const [row] = await tx
				.insert(missionPilotToolCalls)
				.values({
					id: crypto.randomUUID(),
					sessionId: session.id,
					turnId: input.turnId,
					providerCallId: call.id,
					actionId: action?.actionId ?? call.name,
					argumentsJson: call.arguments,
					status: "pending",
					idempotencyKey,
					expectedTaskRevision: readExpectedRevision(call.arguments),
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoNothing({
					target: [
						missionPilotToolCalls.sessionId,
						missionPilotToolCalls.providerCallId,
					],
				})
				.returning();
			if (row) rows.push(row);
			else {
				const [existing] = await tx
					.select()
					.from(missionPilotToolCalls)
					.where(
						and(
							eq(missionPilotToolCalls.sessionId, session.id),
							eq(missionPilotToolCalls.providerCallId, call.id),
						),
					);
				if (
					existing &&
					existing.turnId === input.turnId &&
					existing.actionId === (action?.actionId ?? call.name) &&
					existing.idempotencyKey === idempotencyKey &&
					isDeepStrictEqual(existing.argumentsJson, call.arguments)
				)
					rows.push(existing);
				else
					throw new Error(
						`Provider tool call ${call.id} conflicts with its persisted idempotency record.`,
					);
			}
		}
		await tx
			.update(missionPilotAgentTurns)
			.set({
				provider: input.provider ?? null,
				model: input.model ?? null,
				status: input.toolCalls.length ? "waiting_tool" : "completed",
			})
			.where(eq(missionPilotAgentTurns.id, input.turnId));
		await tx
			.update(missionPilotAgentSessions)
			.set({
				nextConversationSequence: sequence,
				conversationRevision: agent.conversationRevision + 1,
				providerEndpointId: agent.providerEndpointId,
				model: input.model ?? agent.model,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotAgentSessions.sessionId, session.id),
					eq(missionPilotAgentSessions.leaseOwner, input.leaseOwner),
				),
			);
		return rows;
	});
}

export async function claimMissionPilotToolCall(input: {
	id: string;
	leaseOwner: string;
}) {
	return db.transaction(async (tx) => {
		const [call] = await tx
			.select()
			.from(missionPilotToolCalls)
			.where(eq(missionPilotToolCalls.id, input.id));
		if (call?.status !== "pending") return null;
		const [agent] = await tx
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, call.sessionId));
		if (
			agent?.runtimeState !== "running" ||
			agent.leaseOwner !== input.leaseOwner
		)
			return null;
		const [claimed] = await tx
			.update(missionPilotToolCalls)
			.set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
			.where(
				and(
					eq(missionPilotToolCalls.id, call.id),
					eq(missionPilotToolCalls.status, "pending"),
				),
			)
			.returning();
		return claimed ?? null;
	});
}

export async function completeMissionPilotToolCall(input: {
	id: string;
	result?: unknown;
	failure?: MissionPilotActionFailure;
	cancelled?: boolean;
}) {
	return db.transaction(async (tx) => {
		const [call] = await tx
			.select()
			.from(missionPilotToolCalls)
			.where(eq(missionPilotToolCalls.id, input.id));
		if (!call) return null;
		if (["succeeded", "failed", "cancelled"].includes(call.status)) return call;
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, call.sessionId));
		const [agent] = await tx
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, call.sessionId));
		if (!session || !agent) return null;
		const now = new Date();
		const status = input.cancelled
			? "cancelled"
			: input.failure
				? "failed"
				: "succeeded";
		await tx
			.update(missionPilotToolCalls)
			.set({
				status,
				resultJson: input.failure ? null : (input.result ?? null),
				failureJson: input.failure ?? null,
				finishedAt: now,
				updatedAt: now,
			})
			.where(eq(missionPilotToolCalls.id, call.id));
		await tx.insert(missionPilotConversationItems).values({
			id: crypto.randomUUID(),
			sessionId: session.id,
			sequence: agent.nextConversationSequence,
			kind: "tool_result",
			turnId: call.turnId,
			toolCallId: call.id,
			bodyJson: toolResultBody(call, input.failure, input.result),
			createdAt: now,
		});
		await tx
			.update(missionPilotAgentSessions)
			.set({
				nextConversationSequence: agent.nextConversationSequence + 1,
				conversationRevision: agent.conversationRevision + 1,
				updatedAt: now,
			})
			.where(eq(missionPilotAgentSessions.sessionId, session.id));
		return { ...call, status };
	});
}

export async function reprojectMissionPilotTerminalToolCall(input: {
	id: string;
	leaseOwner: string;
}) {
	return db.transaction(async (tx) => {
		const [call] = await tx
			.select()
			.from(missionPilotToolCalls)
			.where(eq(missionPilotToolCalls.id, input.id));
		if (!call || !["succeeded", "failed", "cancelled"].includes(call.status))
			return false;
		const [agent] = await tx
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, call.sessionId));
		if (
			agent?.runtimeState !== "running" ||
			agent.leaseOwner !== input.leaseOwner ||
			agent.currentTurnId !== call.turnId
		)
			return false;
		const now = new Date();
		await tx.insert(missionPilotConversationItems).values({
			id: crypto.randomUUID(),
			sessionId: call.sessionId,
			sequence: agent.nextConversationSequence,
			kind: "tool_result",
			turnId: call.turnId,
			toolCallId: call.id,
			bodyJson: toolResultBody(
				call,
				call.failureJson ?? undefined,
				call.resultJson,
			),
			createdAt: now,
		});
		await tx
			.update(missionPilotAgentSessions)
			.set({
				nextConversationSequence: agent.nextConversationSequence + 1,
				conversationRevision: agent.conversationRevision + 1,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotAgentSessions.sessionId, call.sessionId),
					eq(missionPilotAgentSessions.leaseOwner, input.leaseOwner),
				),
			);
		return true;
	});
}

export async function finishMissionPilotAgentTurn(input: {
	sessionId: string;
	turnId: string;
	leaseOwner: string;
	state: "waiting" | "attention" | "completed" | "stopped";
	error?: unknown;
}) {
	const now = new Date();
	await db.transaction(async (tx) => {
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
		if (!base || input.state === "stopped") return;
		const [activeRun] = await tx
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.taskId, base.taskId),
					inArray(taskRuns.status, [
						"running",
						"context_compiling",
						"finalizing",
					]),
				),
			)
			.orderBy(desc(taskRuns.startedAt))
			.limit(1);
		const [activeQueueEntry] = activeRun
			? []
			: await tx
					.select({ id: implementationQueueEntries.id })
					.from(implementationQueueEntries)
					.where(
						and(
							eq(implementationQueueEntries.taskId, base.taskId),
							inArray(implementationQueueEntries.status, [
								"queued",
								"claimed",
								"processing",
								"awaiting_commit_decision",
							]),
						),
					)
					.limit(1);
		const phase =
			input.state === "attention"
				? "attention"
				: input.state === "completed"
					? "completed"
					: activeRun
						? "implementation"
						: activeQueueEntry || base.phase === "queued"
							? "queued"
							: "paused";
		await tx
			.update(missionPilotSessions)
			.set({
				phase,
				activeRunId: activeRun?.id ?? null,
				lastErrorCode: input.error
					? (input.error as MissionPilotActionFailure).kind
					: null,
				lastErrorMessage: input.error
					? (input.error as MissionPilotActionFailure).message
					: null,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.id, input.sessionId),
					eq(missionPilotSessions.desiredState, "playing"),
				),
			);
	});
}

export async function loadMissionPilotProviderMessages(
	sessionId: string,
): Promise<ProviderToolMessage[]> {
	const items = await db
		.select()
		.from(missionPilotConversationItems)
		.where(eq(missionPilotConversationItems.sessionId, sessionId))
		.orderBy(asc(missionPilotConversationItems.sequence));
	const latestCompactionIndex = items.findLastIndex(
		(item) => item.kind === "compaction_summary",
	);
	const latestCompaction = items[latestCompactionIndex];
	const compactionBody =
		latestCompaction?.bodyJson &&
		typeof latestCompaction.bodyJson === "object" &&
		!Array.isArray(latestCompaction.bodyJson)
			? (latestCompaction.bodyJson as Record<string, unknown>)
			: {};
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
	return projectedItems.flatMap((item): ProviderToolMessage[] => {
		const body =
			item.bodyJson && typeof item.bodyJson === "object"
				? (item.bodyJson as Record<string, unknown>)
				: {};
		if (item.kind === "system_context")
			return [
				{
					role: "system",
					content: typeof body.content === "string" ? body.content : "",
				},
			];
		if (["user", "repair_request"].includes(item.kind))
			return [
				{
					role: "user",
					content:
						typeof body.content === "string"
							? body.content
							: JSON.stringify(item.bodyJson),
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
					content: typeof body.content === "string" ? body.content : "",
					...(Array.isArray(body.toolCalls)
						? { toolCalls: body.toolCalls as ProviderToolCall[] }
						: {}),
				},
			];
		if (item.kind === "tool_result")
			return [
				{
					role: "tool",
					toolCallId:
						typeof body.providerCallId === "string"
							? body.providerCallId
							: (item.toolCallId ?? ""),
					content:
						typeof body.content === "string"
							? body.content
							: JSON.stringify(body),
				},
			];
		return [];
	});
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

export async function compactMissionPilotConversation(input: {
	sessionId: string;
	summary: string;
	leaseOwner: string;
	sourceRevision: number;
	sourceDigest: string;
	sourceThroughSequence: number;
}) {
	const item = await appendConversationItem({
		sessionId: input.sessionId,
		kind: "compaction_summary",
		body: {
			summary: input.summary,
			source: "conversation_revision",
			sourceRevision: input.sourceRevision,
			sourceDigest: input.sourceDigest,
			sourceThroughSequence: input.sourceThroughSequence,
			paging: {
				fromSequence: 1,
				throughSequence: input.sourceThroughSequence,
			},
		},
		sourceKind: "conversation",
		sourceId: input.leaseOwner,
		leaseOwner: input.leaseOwner,
	});
	if (item)
		await db
			.update(missionPilotAgentSessions)
			.set({ compactionRevision: item.sequence, updatedAt: new Date() })
			.where(
				and(
					eq(missionPilotAgentSessions.sessionId, input.sessionId),
					eq(missionPilotAgentSessions.leaseOwner, input.leaseOwner),
				),
			);
	return item;
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
		const unresolvedCalls = await db
			.select()
			.from(missionPilotToolCalls)
			.where(
				and(
					eq(missionPilotToolCalls.sessionId, session.id),
					inArray(missionPilotToolCalls.status, ["pending", "running"]),
				),
			);
		for (const call of unresolvedCalls)
			await completeMissionPilotToolCall({
				id: call.id,
				failure: {
					kind:
						call.status === "running"
							? "outcome_unknown"
							: "domain_precondition",
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
				},
			});
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
				lastFailureJson: {
					kind: "outcome_unknown",
					retryable: null,
					providerCode: null,
					httpStatus: null,
					message:
						"Process stopped while this turn was running. Re-read current state before deciding whether to retry.",
					retryAfterMs: null,
					attempt: 1,
					actionId: "runtime.reconcile",
					idempotencyKey: null,
				},
				updatedAt: now,
			})
			.where(eq(missionPilotAgentSessions.sessionId, agent.sessionId));
	}
	return sessions.map(({ session }) => session);
}

function readExpectedRevision(argumentsJson: Record<string, unknown>) {
	const value =
		argumentsJson.expectedTaskRevision ?? argumentsJson.expectedRevision;
	return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function toolResultBody(
	call: Pick<
		typeof missionPilotToolCalls.$inferSelect,
		"providerCallId" | "actionId"
	>,
	failure: MissionPilotActionFailure | undefined,
	result: unknown,
) {
	return {
		providerCallId: call.providerCallId,
		content: JSON.stringify(
			failure
				? { ok: false, actionId: call.actionId, failure }
				: { ok: true, actionId: call.actionId, data: result ?? null },
		),
	};
}
