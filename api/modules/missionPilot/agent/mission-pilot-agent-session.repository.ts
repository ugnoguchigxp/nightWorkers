import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { MissionPilotAuthorizationV3 } from "../../../../shared/schemas/mission-pilot.schema";
import type { DbTransaction } from "../../../db/client";
import { db } from "../../../db/client";
import { missionPilotAgentSessions } from "../../../db/mission-pilot-agent-schema";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../../../db/mission-pilot-schema";
import { tasks } from "../../../db/schema";
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

export async function claimAgentPlay(taskId: string, expectedVersion: number) {
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
		const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
		if (
			!session ||
			!agent ||
			!task ||
			agent.engineMode !== "agent" ||
			session.version !== expectedVersion ||
			session.desiredState !== "stopped" ||
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
		const context = {
			...(currentContext?.contextJson &&
			typeof currentContext.contextJson === "object" &&
			!Array.isArray(currentContext.contextJson)
				? currentContext.contextJson
				: {}),
			version: 1,
			session: {
				id: session.id,
				taskId,
				repositoryId: task.repositoryId,
				sourceRef: { source: session.sourceKind, id: session.sourceId },
			},
			task: {
				title: task.title,
				initialPrompt: task.objective ?? "",
				description: task.description,
				acceptanceCriteria: task.acceptanceCriteria,
				worktreePath: task.worktreePath,
				repositoryId: task.repositoryId,
			},
		};
		const serialized = JSON.stringify(context);
		const digest = crypto.createHash("sha256").update(serialized).digest("hex");
		const currentAuthorization = session.authorizationJson;
		const reuse =
			currentAuthorization?.version === 3 &&
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
		const authorization: MissionPilotAuthorizationV3 = {
			version: 3,
			sessionId: session.id,
			taskId,
			taskRef: { source: "task", id: taskId },
			activationContextRevision: revision,
			activationContextDigest: digest,
			grantedByAction: "mission_pilot_play",
			grantedAt: now.toISOString(),
			scopes: {
				plan: true,
				queue: true,
				implementation: true,
				testMutation: true,
				review: true,
				localCommit: true,
				taskComplete: true,
				taskArchive: true,
				push: false,
			},
			pushPolicy: "never",
		};
		const [claimed] = await tx
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				phase: "starting",
				authorizationVersion: 3,
				authorizationJson: authorization,
				initialPromptSnapshot: task.objective ?? "",
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
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotAgentSessions.sessionId, session.id),
					eq(missionPilotAgentSessions.engineMode, "agent"),
				),
			)
			.returning();
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
				phase: session.phase,
				version: expectedVersion + 1,
				stoppedAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.taskId, taskId),
					eq(missionPilotSessions.version, expectedVersion),
					eq(missionPilotSessions.desiredState, "playing"),
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
