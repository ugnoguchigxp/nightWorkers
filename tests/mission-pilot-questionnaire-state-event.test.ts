import crypto from "node:crypto";
import {
	createSession,
	missionPilotSessions,
	missionPilotTaskEventInbox,
} from "@nightworkers/mission-pilot/backend";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, tasks } from "../api/db/schema";
import { claimAgentPlay } from "../api/modules/missionPilot/agent/mission-pilot-agent-session.repository";
import { listPendingMissionPilotTaskEvents } from "../api/modules/missionPilot/agent/mission-pilot-task-event.repository";
import { initializeMissionPilotAgentQuestionnaireEvents } from "../api/modules/missionPilot/mission-pilot.service";
import { publishQuestionnaireTransition } from "../api/modules/questionnaire/questionnaire-events";
import type { DesignQuestionnaireSession } from "../shared/schemas/design-questionnaire.schema";

const mocks = vi.hoisted(() => ({
	scheduleWake: vi.fn(),
}));

vi.mock(
	"../api/modules/missionPilot/agent/mission-pilot-agent-wake.service",
	() => ({
		scheduleMissionPilotAgentWake: mocks.scheduleWake,
	}),
);

const repositoryIds: string[] = [];

beforeAll(() => {
	ensureNightWorkersSchema();
	initializeMissionPilotAgentQuestionnaireEvents();
});

afterEach(async () => {
	mocks.scheduleWake.mockReset();
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
});

describe("Mission Pilot Questionnaire state events", () => {
	it("exposes answering only after 20 seconds and cancels it when the user answers first", async () => {
		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		const session = await db.transaction(async (tx) => {
			await tx.insert(repositories).values({
				id: repositoryId,
				name: "questionnaire state event",
				localPath: "/tmp/questionnaire-state-event",
				branch: "main",
			});
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Questionnaire state event",
					objective: "Questionnaire accepted後に再開する",
				})
				.returning();
			return createSession(
				{
					task,
					sourceKind: "task",
					sourceId: task.id,
					runtimeKind: "agent",
				},
				tx,
			);
		});
		const claimed = await claimAgentPlay(taskId, session.version);
		if (!claimed) throw new Error("agent session was not claimed");
		const questionnaireId = crypto.randomUUID();

		const answering = {
			id: questionnaireId,
			taskId,
			repositoryId,
			sourceBlueprintMessageId: null,
			status: "answering",
			createdAt: new Date("2026-07-16T07:50:24.000Z"),
			updatedAt: new Date("2026-07-16T07:50:38.000Z"),
			questionSets: [],
			answers: [],
			reviews: [],
		} satisfies DesignQuestionnaireSession;
		await publishQuestionnaireTransition(answering);
		const [event] = await db
			.select()
			.from(missionPilotTaskEventInbox)
			.where(eq(missionPilotTaskEventInbox.sessionId, claimed.id));

		expect(event).toMatchObject({
			eventType: "questionnaire.state_changed",
			payloadJson: {
				questionnaireSessionId: questionnaireId,
				status: "answering",
				questionSetCount: 0,
				stateDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
				responseDelayMs: 20_000,
			},
		});
		const timing = event?.payloadJson as
			| { detectedAt?: string; availableAt?: string }
			| undefined;
		expect(
			new Date(timing?.availableAt ?? 0).getTime() -
				new Date(timing?.detectedAt ?? 0).getTime(),
		).toBe(20_000);
		expect(
			await listPendingMissionPilotTaskEvents(
				claimed.id,
				new Date((event?.availableAt.getTime() ?? 0) - 1),
			),
		).toHaveLength(0);
		expect(
			await listPendingMissionPilotTaskEvents(
				claimed.id,
				event?.availableAt ?? new Date(0),
			),
		).toHaveLength(1);
		expect(event?.sourceEventId).toContain(
			`questionnaire-state:${questionnaireId}:answering:0:`,
		);
		const [waitingPilot] = await db
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, claimed.id));
		expect(waitingPilot?.nextWakeAt?.getTime()).toBe(
			event?.availableAt.getTime(),
		);
		expect(mocks.scheduleWake).toHaveBeenCalledWith({
			sessionId: claimed.id,
		});
		expect(
			await db
				.select()
				.from(missionPilotTaskEventInbox)
				.where(eq(missionPilotTaskEventInbox.id, event?.id ?? "")),
		).toHaveLength(1);

		await publishQuestionnaireTransition({
			...answering,
			status: "accepted",
			updatedAt: new Date("2026-07-16T07:50:39.000Z"),
			reviews: [
				{
					id: crypto.randomUUID(),
					review: null,
					publishedMessageId: null,
					status: "accepted",
					createdAt: new Date("2026-07-16T07:50:38.000Z"),
					updatedAt: new Date("2026-07-16T07:50:38.000Z"),
				},
			],
		});
		const changedEvent = (
			await db
				.select()
				.from(missionPilotTaskEventInbox)
				.where(eq(missionPilotTaskEventInbox.sessionId, claimed.id))
		).find(
			(candidate) =>
				(candidate.payloadJson as { status?: string }).status === "accepted",
		);

		expect(changedEvent?.id).not.toBe(event?.id);
		expect(changedEvent?.sourceEventId).not.toBe(event?.sourceEventId);
		const [consumedAnswering] = await db
			.select()
			.from(missionPilotTaskEventInbox)
			.where(eq(missionPilotTaskEventInbox.id, event?.id ?? ""));
		expect(consumedAnswering?.consumedAt).not.toBeNull();
		expect(changedEvent?.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
		const [resumedPilot] = await db
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, claimed.id));
		expect(resumedPilot?.nextWakeAt).toBeNull();
	});
});
