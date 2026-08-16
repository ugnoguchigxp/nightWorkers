import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { MissionPilotActionFailure } from "@nightworkers/mission-pilot/contracts";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../../../../db/client";
import type { ProviderToolCall } from "../../../../services/structured-llm/public";
import {
	missionPilotAgentSessions,
	missionPilotAgentTurns,
	missionPilotConversationItems,
	missionPilotSessions,
	missionPilotTaskEventInbox,
	missionPilotToolCalls,
} from "../index";

const MISSION_PILOT_AGENT_LEASE_MS = 60_000;

export {
	finishMissionPilotAgentTurn,
	getMissionPilotConversationCheckpoint,
	listMissionPilotConversation,
	loadMissionPilotProviderMessages,
	reconcileInterruptedMissionPilotAgentSessions,
} from "./conversation-query.repository";
export {
	appendMissionPilotRuntimeFailure,
	appendMissionPilotUserMessage,
	compactMissionPilotConversation,
	seedMissionPilotConversation,
} from "./conversation-write.repository";

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
					typeof payload.messageId !== "string" ||
					typeof payload.content !== "string"
				)
					continue;
				projectedItems.push({
					id: crypto.randomUUID(),
					sessionId: base.id,
					sequence: conversationSequence++,
					kind: "user" as const,
					turnId,
					bodyJson: { content: payload.content },
					sourceKind: "task_message",
					sourceId: payload.messageId,
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
			const [nextEvent] = await tx
				.select({ availableAt: missionPilotTaskEventInbox.availableAt })
				.from(missionPilotTaskEventInbox)
				.where(
					and(
						eq(missionPilotTaskEventInbox.sessionId, base.id),
						isNull(missionPilotTaskEventInbox.consumedAt),
					),
				)
				.orderBy(asc(missionPilotTaskEventInbox.availableAt))
				.limit(1);
			const nextWakeAt =
				nextEvent?.availableAt &&
				nextEvent.availableAt.getTime() > now.getTime()
					? nextEvent.availableAt
					: null;
			await tx
				.update(missionPilotSessions)
				.set({ nextWakeAt, updatedAt: now })
				.where(eq(missionPilotSessions.id, base.id));
			base.nextWakeAt = nextWakeAt;
			base.updatedAt = now;
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
			triggerEvents: events.map((event) => ({
				sequence: event.sequence,
				eventType: event.eventType,
			})),
			providerRetryAttempt: events.reduce((latest, event) => {
				if (event.eventType !== "mission_pilot.retry_timer_elapsed")
					return latest;
				const payload =
					event.payloadJson &&
					typeof event.payloadJson === "object" &&
					!Array.isArray(event.payloadJson)
						? (event.payloadJson as Record<string, unknown>)
						: {};
				return typeof payload.nextAttempt === "number" &&
					Number.isInteger(payload.nextAttempt)
					? Math.max(latest, payload.nextAttempt)
					: latest;
			}, 1),
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
	resolvedActionIds?: Readonly<Record<string, string>>;
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
			const actionId = input.resolvedActionIds?.[call.id] ?? call.name;
			const idempotencyKey =
				typeof call.arguments.idempotencyKey === "string" &&
				call.arguments.idempotencyKey
					? call.arguments.idempotencyKey
					: `${session.id}:${input.turnId}:${call.id}`;
			const [row] = await tx
				.insert(missionPilotToolCalls)
				.values({
					id: crypto.randomUUID(),
					sessionId: session.id,
					turnId: input.turnId,
					providerCallId: call.id,
					actionId,
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
					existing.actionId === actionId &&
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

function readExpectedRevision(argumentsJson: Record<string, unknown>) {
	const value =
		argumentsJson.expectedResourceRevision ??
		argumentsJson.expectedTaskRevision ??
		argumentsJson.expectedRevision;
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
