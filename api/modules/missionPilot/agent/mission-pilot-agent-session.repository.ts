import crypto from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { MissionPilotAuthorizationV4 } from "../../../../shared/modules/missionPilot";
import type { DbTransaction } from "../../../db/client";
import { db } from "../../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotConversationItems,
	missionPilotTaskEventInbox,
} from "../../../db/mission-pilot-agent-schema";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../../../db/mission-pilot-schema";
import {
	humanTaskOperatorPrincipal,
	readTaskOperatorProjection,
} from "../../taskOperator";
import { createMissionPilotAuthorization } from "../mission-pilot-delegation";
import {
	clearMissionPilotAgentTaskActive,
	markMissionPilotAgentTaskActive,
} from "./mission-pilot-agent-active-registry";

export async function createMissionPilotAgentSession(
	tx: DbTransaction,
	input: { sessionId: string; contextDigest: string; now: Date },
) {
	return tx.insert(missionPilotAgentSessions).values({
		sessionId: input.sessionId,
		engineMode: "agent",
		contextDigest: input.contextDigest,
		createdAt: input.now,
		updatedAt: input.now,
	});
}

/**
 * Additive startup migration for sessions created before the persistent agent
 * runtime became canonical. It only changes Mission Pilot-owned state: active
 * Coding Agent runs remain untouched and no wake/provider call is scheduled.
 */
export async function backfillStoppedMissionPilotAgentSessions() {
	const missing = await db
		.select({ session: missionPilotSessions })
		.from(missionPilotSessions)
		.leftJoin(
			missionPilotAgentSessions,
			eq(missionPilotAgentSessions.sessionId, missionPilotSessions.id),
		)
		.where(isNull(missionPilotAgentSessions.sessionId));
	let migrated = 0;
	for (const { session } of missing) {
		const inserted = await db.transaction(async (tx) => {
			const [current] = await tx
				.select()
				.from(missionPilotSessions)
				.where(eq(missionPilotSessions.id, session.id));
			if (!current) return false;
			const [existing] = await tx
				.select({ sessionId: missionPilotAgentSessions.sessionId })
				.from(missionPilotAgentSessions)
				.where(eq(missionPilotAgentSessions.sessionId, session.id));
			if (existing) return false;
			const now = new Date();
			const [claimed] = await tx
				.update(missionPilotSessions)
				.set({
					desiredState: "stopped",
					phase: "created",
					resumePhase: null,
					activeRunId: null,
					activePhaseRunId: null,
					activeVerificationSnapshotId: null,
					nextWakeAt: null,
					leaseOwner: null,
					leaseExpiresAt: null,
					stoppedAt: now,
					version: current.version + 1,
					updatedAt: now,
				})
				.where(
					and(
						eq(missionPilotSessions.id, session.id),
						eq(missionPilotSessions.version, current.version),
					),
				)
				.returning({ id: missionPilotSessions.id });
			if (!claimed)
				throw new Error(
					`Mission Pilot session ${session.id} changed during agent backfill`,
				);
			await createMissionPilotAgentSession(tx, {
				sessionId: session.id,
				contextDigest: current.contextDigest,
				now,
			});
			return true;
		});
		if (inserted) migrated += 1;
	}
	return migrated;
}

export async function isMissionPilotAgentSession(sessionId: string) {
	const [row] = await db
		.select({ engineMode: missionPilotAgentSessions.engineMode })
		.from(missionPilotAgentSessions)
		.where(eq(missionPilotAgentSessions.sessionId, sessionId));
	return row?.engineMode === "agent";
}

export async function getMissionPilotAgentSessionById(sessionId: string) {
	const [row] = await db
		.select()
		.from(missionPilotAgentSessions)
		.where(eq(missionPilotAgentSessions.sessionId, sessionId));
	return row ?? null;
}

export async function claimAgentPlay(
	taskId: string,
	expectedVersion: number,
	principal: {
		kind: "human";
		actorId: string;
		authorizationRef: string;
	} = humanTaskOperatorPrincipal(),
	activation?: {
		systemContext: (authorization: MissionPilotAuthorizationV4) => string;
		initialPrompt: string;
		acceptanceCriteria: string | null;
		taskRevision: number;
		sourceEventId: string;
	},
) {
	const taskProjection = await readTaskOperatorProjection(taskId, {
		principal,
	});
	if (activation && taskProjection.task.revision !== activation.taskRevision)
		return null;
	const claimed = await db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.taskId, taskId));
		const [agent] = session
			? await tx
					.select()
					.from(missionPilotAgentSessions)
					.where(eq(missionPilotAgentSessions.sessionId, session.id))
			: [];
		if (
			!session ||
			!agent ||
			agent.engineMode !== "agent" ||
			session.version !== expectedVersion ||
			session.desiredState !== "stopped" ||
			session.lastErrorCode === "MISSION_PILOT_RUNTIME_STOP_TIMEOUT" ||
			agent.runtimeState === "completed"
		)
			return null;
		const [currentContext] = await tx
			.select()
			.from(missionPilotContextSnapshots)
			.where(
				and(
					eq(missionPilotContextSnapshots.sessionId, session.id),
					eq(missionPilotContextSnapshots.revision, session.contextRevision),
				),
			);
		const previousContext =
			currentContext?.contextJson &&
			typeof currentContext.contextJson === "object" &&
			!Array.isArray(currentContext.contextJson)
				? currentContext.contextJson
				: {};
		const previousTask =
			previousContext.task &&
			typeof previousContext.task === "object" &&
			!Array.isArray(previousContext.task)
				? (previousContext.task as Record<string, unknown>)
				: {};
		const objective =
			activation?.initialPrompt ?? taskProjection.task.objective?.text ?? "";
		const context = {
			...previousContext,
			version: 1,
			session: {
				id: session.id,
				taskId,
				repositoryId: taskProjection.project.id,
				sourceRef: { source: session.sourceKind, id: session.sourceId },
			},
			task: {
				...previousTask,
				title: taskProjection.task.title,
				initialPrompt: objective,
				acceptanceCriteria:
					activation?.acceptanceCriteria ??
					taskProjection.task.acceptanceCriteria?.text ??
					null,
				repositoryId: taskProjection.project.id,
			},
		};
		const serialized = JSON.stringify(context);
		const digest = crypto.createHash("sha256").update(serialized).digest("hex");
		const currentAuthorization = session.authorizationJson;
		const reuse =
			currentAuthorization?.version === 4 &&
			currentAuthorization.activationContextDigest === digest;
		const revision = reuse
			? currentAuthorization.activationContextRevision
			: session.contextRevision + 1;
		const now = new Date();
		if (!reuse)
			await tx.insert(missionPilotContextSnapshots).values({
				id: crypto.randomUUID(),
				sessionId: session.id,
				revision,
				reason: "agent_play_activation",
				contextJson: context,
				digest,
				tokenEstimate: Math.ceil(serialized.length / 4),
				createdAt: now,
			});
		const authorization = createMissionPilotAuthorization({
			sessionId: session.id,
			taskId,
			activationContextRevision: revision,
			activationContextDigest: digest,
			grantedAt: now.toISOString(),
			principal,
		});
		const [existingConversation] = activation
			? await tx
					.select({ id: missionPilotConversationItems.id })
					.from(missionPilotConversationItems)
					.where(eq(missionPilotConversationItems.sessionId, session.id))
					.limit(1)
			: [];
		const [existingResumeEvent] = activation
			? await tx
					.select({ id: missionPilotTaskEventInbox.id })
					.from(missionPilotTaskEventInbox)
					.where(
						and(
							eq(missionPilotTaskEventInbox.sessionId, session.id),
							eq(
								missionPilotTaskEventInbox.sourceEventId,
								activation.sourceEventId,
							),
						),
					)
					.limit(1)
			: [];
		const shouldSeedConversation = Boolean(activation && !existingConversation);
		const shouldAppendResumeEvent = Boolean(activation && !existingResumeEvent);
		const [claimed] = await tx
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				phase: "starting",
				authorizationVersion: 4,
				authorizationJson: authorization,
				initialPromptSnapshot: objective,
				...(activation ? { initialPromptState: "sent" as const } : {}),
				contextRevision: revision,
				contextDigest: digest,
				startedAt: now,
				stoppedAt: null,
				lastErrorCode: null,
				lastErrorMessage: null,
				version: expectedVersion + 1,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.id, session.id),
					eq(missionPilotSessions.version, expectedVersion),
					eq(missionPilotSessions.desiredState, "stopped"),
					isNull(missionPilotSessions.activeRunId),
				),
			)
			.returning();
		if (!claimed) return null;
		const [claimedAgent] = await tx
			.update(missionPilotAgentSessions)
			.set({
				runtimeState: "waiting",
				contextRevision: revision,
				contextDigest: digest,
				lastFailureJson: null,
				currentTurnId: null,
				leaseOwner: null,
				leaseExpiresAt: null,
				nextConversationSequence: shouldSeedConversation
					? agent.nextConversationSequence + 2
					: agent.nextConversationSequence,
				conversationRevision: shouldSeedConversation
					? agent.conversationRevision + 1
					: agent.conversationRevision,
				nextEventSequence: shouldAppendResumeEvent
					? agent.nextEventSequence + 1
					: agent.nextEventSequence,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotAgentSessions.sessionId, session.id),
					eq(missionPilotAgentSessions.engineMode, "agent"),
				),
			)
			.returning();
		if (claimedAgent && activation && shouldSeedConversation) {
			await tx.insert(missionPilotConversationItems).values([
				{
					id: crypto.randomUUID(),
					sessionId: session.id,
					sequence: agent.nextConversationSequence,
					kind: "system_context",
					bodyJson: {
						version: agent.systemContextVersion,
						content: activation.systemContext(authorization),
					},
					createdAt: now,
				},
				{
					id: crypto.randomUUID(),
					sessionId: session.id,
					sequence: agent.nextConversationSequence + 1,
					kind: "user",
					bodyJson: { content: activation.initialPrompt },
					sourceKind: "task",
					sourceId: taskId,
					createdAt: now,
				},
			]);
		}
		if (claimedAgent && activation && shouldAppendResumeEvent) {
			await tx.insert(missionPilotTaskEventInbox).values({
				id: crypto.randomUUID(),
				sessionId: session.id,
				taskId,
				sequence: agent.nextEventSequence,
				eventType: "mission_pilot.resume_requested",
				sourceEventId: activation.sourceEventId,
				taskRevision: activation.taskRevision,
				payloadJson: { reason: "play" },
				availableAt: now,
				createdAt: now,
			});
		}
		return claimedAgent
			? { ...claimed, ...claimedAgent, id: claimed.id }
			: null;
	});
	if (claimed) markMissionPilotAgentTaskActive(taskId);
	return claimed;
}

export async function claimAgentStop(taskId: string, expectedVersion: number) {
	const stopped = await db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.taskId, taskId));
		if (!session) return null;
		const [agent] = await tx
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, session.id));
		if (agent?.engineMode !== "agent") return null;
		const now = new Date();
		const [row] = await tx
			.update(missionPilotSessions)
			.set({
				desiredState: "stopped",
				resumePhase:
					session.phase === "stopping" ? session.resumePhase : session.phase,
				phase: "stopping",
				nextWakeAt: null,
				version: expectedVersion + 1,
				stoppedAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.taskId, taskId),
					eq(missionPilotSessions.version, expectedVersion),
					inArray(missionPilotSessions.desiredState, ["playing", "stopped"]),
				),
			)
			.returning();
		if (!row) return null;
		await tx
			.update(missionPilotAgentSessions)
			.set({
				runtimeState: "stopped",
				currentTurnId: null,
				leaseOwner: null,
				leaseExpiresAt: null,
				updatedAt: now,
			})
			.where(eq(missionPilotAgentSessions.sessionId, session.id));
		return { ...row, ...agent, id: row.id, runtimeState: "stopped" as const };
	});
	if (stopped) clearMissionPilotAgentTaskActive(taskId);
	return stopped;
}

export async function getMissionPilotSessionById(id: string) {
	const [row] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, id));
	return row ?? null;
}

export async function listPlayingAgentSessions() {
	return db
		.select({ session: missionPilotSessions, agent: missionPilotAgentSessions })
		.from(missionPilotSessions)
		.innerJoin(
			missionPilotAgentSessions,
			eq(missionPilotAgentSessions.sessionId, missionPilotSessions.id),
		)
		.where(
			and(
				eq(missionPilotAgentSessions.engineMode, "agent"),
				eq(missionPilotSessions.desiredState, "playing"),
			),
		);
}
