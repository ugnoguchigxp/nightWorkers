import crypto from "node:crypto";
import "./helpers/mission-pilot-runtime";
import {
	buildMissionPilotCurrentStepContext,
	claimAgentPlay,
	createMissionPilotTaskOperatorAccess,
	missionPilotTaskReadPort,
} from "@nightworkers/mission-pilot/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, tasks } from "../api/db/schema";
import {
	createSession,
	missionPilotSessions,
} from "../api/modules/missionPilot/persistence";
import {
	executeTaskOperatorCommand,
	humanTaskOperatorQueryContext,
	readTaskOperatorProjection,
} from "../api/modules/taskOperator";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
});

async function fixture(principal?: {
	kind: "human";
	actorId: string;
	authorizationRef: string;
}) {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	const session = await db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "delegated authorization",
			localPath: "/tmp/delegated-authorization",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "delegated authorization",
				objective: "ユーザー権限以下でTaskを操作する",
				status: "ready",
			})
			.returning();
		return createSession({ task, sourceKind: "task", sourceId: task.id }, tx);
	});
	const playing = await claimAgentPlay(taskId, session.version, principal);
	if (!playing) throw new Error("Mission Pilot did not start");
	return { taskId, sessionId: session.id };
}

describe("Mission Pilot delegated user authorization", () => {
	it("does not expand a user principal that has no current capabilities", async () => {
		const state = await fixture({
			kind: "human",
			actorId: "user-without-capabilities",
			authorizationRef: "revoked-user",
		});
		const [session] = await db
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, state.sessionId));
		expect(session?.authorizationJson?.version).toBe(4);
		if (session?.authorizationJson?.version !== 4)
			throw new Error("V4 delegation is missing");
		expect(Object.values(session.authorizationJson.scopes)).not.toContain(true);
		const access = await createMissionPilotTaskOperatorAccess(state);
		const projection = await readTaskOperatorProjection(
			state.taskId,
			access.context,
			access.delegatedAuthorization,
		);
		expect(projection.commandCatalog.availableIds).toEqual([]);
	});

	it("exposes only the intersection of user and Play delegation", async () => {
		const state = await fixture();
		const access = await createMissionPilotTaskOperatorAccess(state);
		const [human, delegated, missionPilotActions] = await Promise.all([
			readTaskOperatorProjection(state.taskId, humanTaskOperatorQueryContext()),
			readTaskOperatorProjection(
				state.taskId,
				access.context,
				access.delegatedAuthorization,
			),
			missionPilotTaskReadPort.listAvailableTaskActions(state),
		]);
		expect(
			delegated.commandCatalog.availableIds.every((id) =>
				human.commandCatalog.availableIds.includes(id),
			),
		).toBe(true);
		expect(delegated.commandCatalog.availableIds).not.toContain("git.push");
		expect(missionPilotActions.map((action) => action.id)).toContain(
			"questionnaire.submit",
		);
	});

	it("rejects a capability that the Play delegation does not grant", async () => {
		const state = await fixture();
		const access = await createMissionPilotTaskOperatorAccess(state);
		const projection = await readTaskOperatorProjection(
			state.taskId,
			access.context,
			access.delegatedAuthorization,
		);
		await expect(
			executeTaskOperatorCommand({
				taskId: state.taskId,
				actionId: "git.push",
				expectedTaskRevision: projection.task.revision,
				arguments: {
					sourceRunId: crypto.randomUUID(),
				},
				context: {
					...access.context,
					requestId: crypto.randomUUID(),
					idempotencyKey: crypto.randomUUID(),
				},
				runtime: {
					delegatedAuthorization: access.delegatedAuthorization,
				},
			}),
		).rejects.toMatchObject({ code: "TASK_OPERATOR_PERMISSION_DENIED" });
	});

	it("re-evaluates current user authorization and active Play state", async () => {
		const state = await fixture();
		const access = await createMissionPilotTaskOperatorAccess(state);
		const [session] = await db
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, state.sessionId));
		if (session?.authorizationJson?.version !== 4)
			throw new Error("V4 delegation is missing");
		await db
			.update(missionPilotSessions)
			.set({
				authorizationJson: {
					...session.authorizationJson,
					userAuthorizationRef: "revoked-local-user",
				},
			})
			.where(eq(missionPilotSessions.id, state.sessionId));
		await expect(
			readTaskOperatorProjection(
				state.taskId,
				access.context,
				access.delegatedAuthorization,
			),
		).rejects.toMatchObject({ code: "TASK_OPERATOR_PERMISSION_DENIED" });
		await expect(
			buildMissionPilotCurrentStepContext({
				taskId: state.taskId,
				sessionId: state.sessionId,
				readPort: missionPilotTaskReadPort,
			}),
		).resolves.toMatchObject({
			taskRef: {
				id: state.taskId,
				revision: null,
				status: "unavailable",
			},
			availableActionIds: [],
			readFailure: {
				code: "TASK_OPERATOR_PERMISSION_DENIED",
			},
		});

		await db
			.update(missionPilotSessions)
			.set({
				authorizationJson: session.authorizationJson,
				desiredState: "stopped",
			})
			.where(eq(missionPilotSessions.id, state.sessionId));
		await expect(
			readTaskOperatorProjection(
				state.taskId,
				access.context,
				access.delegatedAuthorization,
			),
		).rejects.toMatchObject({ code: "TASK_OPERATOR_PERMISSION_DENIED" });
	});
});
