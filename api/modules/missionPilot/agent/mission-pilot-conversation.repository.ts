import crypto from "node:crypto";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import type { MissionPilotActionFailure } from "../../../../shared/schemas/mission-pilot-agent.schema";
import { db } from "../../../db/client";
import {
	missionPilotAgentTurns,
	missionPilotConversationItems,
	missionPilotTaskEventInbox,
	missionPilotToolCalls,
} from "../../../db/mission-pilot-agent-schema";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";
import type {
	ProviderToolCall,
	ProviderToolMessage,
} from "../../../services/structured-llm/public";
import { MISSION_PILOT_AGENT_LEASE_MS } from "./mission-pilot-agent.constants";
import {
	asRecord,
	readExpectedRevision,
	readToolCalls,
	stringValue,
} from "./mission-pilot-conversation-codec";
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
		if (session?.runtimeKind !== "agent") return false;
		const [existing] = await tx
			.select({ id: missionPilotConversationItems.id })
			.from(missionPilotConversationItems)
			.where(eq(missionPilotConversationItems.sessionId, session.id))
			.limit(1);
		if (existing) return false;
		const now = new Date();
		const sequence = session.nextConversationSequence;
		await tx.insert(missionPilotConversationItems).values([
			{
				id: crypto.randomUUID(),
				sessionId: session.id,
				sequence,
				kind: "system_context",
				bodyJson: {
					version: session.systemContextVersion,
					content: input.systemContext,
				},
				createdAt: now,
			},
			{
				id: crypto.randomUUID(),
				sessionId: session.id,
				sequence: sequence + 1,
				kind: "user",
				bodyJson: { content: input.initialPrompt },
				sourceKind: "task",
				sourceId: session.taskId,
				createdAt: now,
			},
		]);
		await tx
			.update(missionPilotSessions)
			.set({
				nextConversationSequence: sequence + 2,
				conversationRevision: session.conversationRevision + 1,
				updatedAt: now,
			})
			.where(eq(missionPilotSessions.id, session.id));
		return true;
	});
}

async function appendConversationItem(input: {
	sessionId: string;
	kind:
		| "user"
		| "assistant"
		| "tool_result"
		| "task_event"
		| "compaction_summary";
	body: unknown;
	turnId?: string | null;
	toolCallId?: string | null;
	sourceKind?: string | null;
	sourceId?: string | null;
	requiredLeaseOwner?: string;
}) {
	return db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, input.sessionId));
		if (
			!session ||
			(input.requiredLeaseOwner !== undefined &&
				(session.desiredState !== "playing" ||
					session.runtimeState !== "running" ||
					session.leaseOwner !== input.requiredLeaseOwner))
		)
			return null;
		const sequence = session.nextConversationSequence;
		const now = new Date();
		const [item] = await tx
			.insert(missionPilotConversationItems)
			.values({
				id: crypto.randomUUID(),
				sessionId: session.id,
				sequence,
				kind: input.kind,
				bodyJson: input.body,
				turnId: input.turnId ?? null,
				toolCallId: input.toolCallId ?? null,
				sourceKind: input.sourceKind ?? null,
				sourceId: input.sourceId ?? null,
				createdAt: now,
			})
			.returning();
		await tx
			.update(missionPilotSessions)
			.set({
				nextConversationSequence: sequence + 1,
				conversationRevision: session.conversationRevision + 1,
				updatedAt: now,
			})
			.where(eq(missionPilotSessions.id, session.id));
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
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, input.sessionId));
		if (
			session?.runtimeKind !== "agent" ||
			session.desiredState !== "playing" ||
			session.runtimeState === "completed" ||
			session.runtimeState === "running" ||
			(session.leaseExpiresAt && session.leaseExpiresAt > now)
		) {
			return null;
		}
		const events = await tx
			.select()
			.from(missionPilotTaskEventInbox)
			.where(
				and(
					eq(missionPilotTaskEventInbox.sessionId, session.id),
					isNull(missionPilotTaskEventInbox.consumedAt),
					lte(missionPilotTaskEventInbox.availableAt, now),
				),
			)
			.orderBy(asc(missionPilotTaskEventInbox.sequence));
		const turnIndex = session.nextTurnIndex;
		const turnId = crypto.randomUUID();
		const from = events[0]?.sequence ?? null;
		const to = events.at(-1)?.sequence ?? null;
		const nextConversationSequence =
			session.nextConversationSequence + (events.length ? 1 : 0);
		const [claimed] = await tx
			.update(missionPilotSessions)
			.set({
				runtimeState: "running",
				leaseOwner: input.leaseOwner,
				leaseExpiresAt: new Date(now.getTime() + MISSION_PILOT_AGENT_LEASE_MS),
				nextTurnIndex: turnIndex + 1,
				nextConversationSequence,
				lastConsumedEventSequence: to ?? session.lastConsumedEventSequence,
				conversationRevision:
					session.conversationRevision + (events.length ? 1 : 0),
				version: session.version + 1,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.id, session.id),
					eq(missionPilotSessions.version, session.version),
				),
			)
			.returning();
		if (!claimed) return null;
		await tx.insert(missionPilotAgentTurns).values({
			id: turnId,
			sessionId: session.id,
			turnIndex,
			triggerEventFrom: from,
			triggerEventTo: to,
			status: "running",
			startedAt: now,
		});
		if (events.length) {
			await tx.insert(missionPilotConversationItems).values({
				id: crypto.randomUUID(),
				sessionId: session.id,
				sequence: session.nextConversationSequence,
				kind: "task_event",
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
			});
			await tx
				.update(missionPilotTaskEventInbox)
				.set({ consumedAt: now })
				.where(
					and(
						eq(missionPilotTaskEventInbox.sessionId, session.id),
						inArray(
							missionPilotTaskEventInbox.id,
							events.map((event) => event.id),
						),
					),
				);
		}
		return { session: claimed, turnId, events };
	});
}

export async function appendMissionPilotRuntimeFailure(input: {
	sessionId: string;
	failure: MissionPilotActionFailure;
}) {
	return appendConversationItem({
		sessionId: input.sessionId,
		kind: "task_event",
		body: {
			events: [
				{
					eventType: "mission_pilot.runtime_failure",
					payload: input.failure,
				},
			],
		},
		sourceKind: "runtime_failure",
		sourceId: input.failure.actionId,
	});
}

export async function loadMissionPilotProviderMessages(sessionId: string) {
	const items = await db
		.select()
		.from(missionPilotConversationItems)
		.where(eq(missionPilotConversationItems.sessionId, sessionId))
		.orderBy(asc(missionPilotConversationItems.sequence));
	const latestSummaryIndex = items.findLastIndex(
		(item) => item.kind === "compaction_summary",
	);
	const selected =
		latestSummaryIndex >= 0 ? items.slice(latestSummaryIndex) : items;
	const messages: ProviderToolMessage[] = [];
	for (const item of selected) {
		const body = asRecord(item.bodyJson);
		if (item.kind === "system_context" || item.kind === "tool_call") continue;
		if (item.kind === "user") {
			messages.push({ role: "user", content: stringValue(body.content) });
			continue;
		}
		if (item.kind === "assistant") {
			messages.push({
				role: "assistant",
				content: stringValue(body.content),
				toolCalls: readToolCalls(body.toolCalls),
			});
			continue;
		}
		if (item.kind === "tool_result") {
			messages.push({
				role: "tool",
				toolCallId: stringValue(body.providerCallId),
				content: stringValue(body.content),
			});
			continue;
		}
		if (item.kind === "task_event") {
			messages.push({
				role: "user",
				content: `Task event:\n${JSON.stringify(body.events ?? [])}`,
			});
			continue;
		}
		if (item.kind === "compaction_summary") {
			messages.push({
				role: "user",
				content: `Mission Pilot conversation summary:\n${stringValue(body.summary)}`,
			});
		}
	}
	return messages;
}

export async function persistMissionPilotProviderTurn(input: {
	sessionId: string;
	turnId: string;
	leaseOwner: string;
	content: string;
	toolCalls: ProviderToolCall[];
	provider: string | null;
	model: string | null;
}) {
	return db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, input.sessionId));
		const [turn] = await tx
			.select({ status: missionPilotAgentTurns.status })
			.from(missionPilotAgentTurns)
			.where(eq(missionPilotAgentTurns.id, input.turnId));
		if (
			session?.runtimeKind !== "agent" ||
			session.desiredState !== "playing" ||
			session.runtimeState !== "running" ||
			session.leaseOwner !== input.leaseOwner ||
			turn?.status !== "running"
		)
			return null;
		let sequence = session.nextConversationSequence;
		const now = new Date();
		await tx.insert(missionPilotConversationItems).values({
			id: crypto.randomUUID(),
			sessionId: session.id,
			sequence: sequence++,
			kind: "assistant",
			turnId: input.turnId,
			bodyJson: { content: input.content, toolCalls: input.toolCalls },
			createdAt: now,
		});
		const createdCalls = [];
		for (const call of input.toolCalls) {
			const id = crypto.randomUUID();
			const idempotencyKey = `${session.id}:${call.id}`;
			const [created] = await tx
				.insert(missionPilotToolCalls)
				.values({
					id,
					sessionId: session.id,
					turnId: input.turnId,
					providerCallId: call.id,
					actionId:
						getMissionPilotActionByToolName(call.name)?.actionId ?? call.name,
					argumentsJson: call.arguments,
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
			if (!created) continue;
			createdCalls.push(created);
			await tx.insert(missionPilotConversationItems).values({
				id: crypto.randomUUID(),
				sessionId: session.id,
				sequence: sequence++,
				kind: "tool_call",
				turnId: input.turnId,
				toolCallId: id,
				bodyJson: call,
				createdAt: now,
			});
		}
		await tx
			.update(missionPilotAgentTurns)
			.set({
				status: input.toolCalls.length ? "waiting_tool" : "completed",
				provider: input.provider,
				model: input.model,
				finishedAt: input.toolCalls.length ? null : now,
			})
			.where(eq(missionPilotAgentTurns.id, input.turnId));
		await tx
			.update(missionPilotSessions)
			.set({
				nextConversationSequence: sequence,
				conversationRevision: session.conversationRevision + 1,
				runtimeState: input.toolCalls.length ? "running" : "waiting",
				leaseOwner: input.toolCalls.length ? session.leaseOwner : null,
				leaseExpiresAt: input.toolCalls.length ? session.leaseExpiresAt : null,
				version: session.version + 1,
				updatedAt: now,
			})
			.where(eq(missionPilotSessions.id, session.id));
		return createdCalls;
	});
}

export async function claimMissionPilotToolCall(input: {
	id: string;
	leaseOwner: string;
}) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(missionPilotToolCalls)
			.where(eq(missionPilotToolCalls.id, input.id));
		if (row?.status !== "pending") return row ?? null;
		const [session] = await tx
			.select({
				desiredState: missionPilotSessions.desiredState,
				runtimeState: missionPilotSessions.runtimeState,
				leaseOwner: missionPilotSessions.leaseOwner,
			})
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, row.sessionId));
		if (
			session?.desiredState !== "playing" ||
			session.runtimeState !== "running" ||
			session.leaseOwner !== input.leaseOwner
		)
			return null;
		const [claimed] = await tx
			.update(missionPilotToolCalls)
			.set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
			.where(
				and(
					eq(missionPilotToolCalls.id, input.id),
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
		if (
			call.status === "succeeded" ||
			call.status === "failed" ||
			call.status === "cancelled"
		)
			return call;
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, call.sessionId));
		if (!session) return null;
		const now = new Date();
		const content = JSON.stringify(
			input.failure
				? { ok: false, actionId: call.actionId, failure: input.failure }
				: { ok: true, actionId: call.actionId, data: input.result ?? null },
		);
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
			sequence: session.nextConversationSequence,
			kind: "tool_result",
			turnId: call.turnId,
			toolCallId: call.id,
			bodyJson: { providerCallId: call.providerCallId, content },
			createdAt: now,
		});
		await tx
			.update(missionPilotSessions)
			.set({
				nextConversationSequence: session.nextConversationSequence + 1,
				conversationRevision: session.conversationRevision + 1,
				updatedAt: now,
			})
			.where(eq(missionPilotSessions.id, session.id));
		return { ...call, status };
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
	sourceRevision: number;
	leaseOwner: string;
}) {
	const item = await appendConversationItem({
		sessionId: input.sessionId,
		kind: "compaction_summary",
		body: { summary: input.summary, sourceRevision: input.sourceRevision },
		sourceKind: "conversation_revision",
		sourceId: String(input.sourceRevision),
		requiredLeaseOwner: input.leaseOwner,
	});
	if (item) {
		await db
			.update(missionPilotSessions)
			.set({
				compactionRevision: input.sourceRevision,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(missionPilotSessions.id, input.sessionId),
					eq(missionPilotSessions.desiredState, "playing"),
					eq(missionPilotSessions.runtimeState, "running"),
					eq(missionPilotSessions.leaseOwner, input.leaseOwner),
				),
			);
	}
	return item;
}
