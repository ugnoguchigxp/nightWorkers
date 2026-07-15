import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { MissionPilotAuthorizationV3 } from "../../../../shared/schemas/mission-pilot.schema";
import { db } from "../../../db/client";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../../../db/mission-pilot-schema";
import { tasks } from "../../../db/schema";

export async function claimAgentPlay(taskId: string, expectedVersion: number) {
	return db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.taskId, taskId));
		const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
		if (
			!session ||
			!task ||
			session.runtimeKind !== "agent" ||
			session.version !== expectedVersion ||
			session.desiredState !== "stopped"
		) {
			return null;
		}
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
		const reuseActivation =
			currentAuthorization?.version === 3 &&
			currentAuthorization.activationContextDigest === digest;
		const revision = reuseActivation
			? currentAuthorization.activationContextRevision
			: session.contextRevision + 1;
		const now = new Date();
		if (!reuseActivation) {
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
		}
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
				push: true,
			},
			pushPolicy: "allowed",
		};
		const [row] = await tx
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				runtimeState: "idle",
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
					eq(missionPilotSessions.runtimeKind, "agent"),
					eq(missionPilotSessions.desiredState, "stopped"),
				),
			)
			.returning();
		return row ?? null;
	});
}

export async function getMissionPilotSessionById(id: string) {
	const [row] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, id));
	return row ?? null;
}

export async function claimAgentStop(taskId: string, expectedVersion: number) {
	const now = new Date();
	const [row] = await db
		.update(missionPilotSessions)
		.set({
			desiredState: "stopped",
			runtimeState: "stopped",
			leaseOwner: null,
			leaseExpiresAt: null,
			stoppedAt: now,
			version: expectedVersion + 1,
			updatedAt: now,
		})
		.where(
			and(
				eq(missionPilotSessions.taskId, taskId),
				eq(missionPilotSessions.runtimeKind, "agent"),
				eq(missionPilotSessions.version, expectedVersion),
			),
		)
		.returning();
	return row ?? null;
}
