import crypto from "node:crypto";
import type { MissionPilotActionFailure } from "@nightworkers/mission-pilot/contracts";
import { and, eq } from "drizzle-orm";
import { db } from "../../../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotConversationItems,
	missionPilotSessions,
} from "../index";

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
	return appendMissionPilotConversationItem({
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
	return appendMissionPilotConversationItem({
		sessionId: input.sessionId,
		kind: "runtime_failure",
		body: { failure: input.failure },
		sourceKind: "runtime_failure",
		sourceId: input.failure.actionId,
		leaseOwner: input.leaseOwner,
	});
}

export async function appendMissionPilotConversationItem(input: {
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

export async function compactMissionPilotConversation(input: {
	sessionId: string;
	summary: string;
	leaseOwner: string;
	sourceRevision: number;
	sourceDigest: string;
	sourceThroughSequence: number;
}) {
	const item = await appendMissionPilotConversationItem({
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
