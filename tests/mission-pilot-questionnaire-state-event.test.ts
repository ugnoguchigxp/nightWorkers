import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { missionPilotTaskEventInbox } from "../api/db/mission-pilot-agent-schema";
import { repositories, tasks } from "../api/db/schema";
import { claimAgentPlay } from "../api/modules/missionPilot/agent/mission-pilot-agent-session.repository";
import { recordMissionPilotQuestionnaireStateChanged } from "../api/modules/missionPilot/agent/mission-pilot-task-event.adapter";
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";
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

beforeAll(() => ensureNightWorkersSchema());

afterEach(async () => {
	mocks.scheduleWake.mockReset();
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
});

describe("Mission Pilot Questionnaire state events", () => {
	it("records accepted as a wakeable state change event", async () => {
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

		const event = await recordMissionPilotQuestionnaireStateChanged({
			id: questionnaireId,
			taskId,
			repositoryId,
			sourceBlueprintMessageId: null,
			status: "accepted",
			createdAt: new Date("2026-07-16T07:50:24.000Z"),
			updatedAt: new Date("2026-07-16T07:50:38.000Z"),
			questionSets: [],
			answers: [],
			reviews: [],
		} satisfies DesignQuestionnaireSession);

		expect(event).toMatchObject({
			eventType: "questionnaire.state_changed",
			payloadJson: {
				questionnaireSessionId: questionnaireId,
				status: "accepted",
				questionSetCount: 0,
				stateDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
			},
		});
		expect(event?.sourceEventId).toContain(
			`questionnaire-state:${questionnaireId}:accepted:0:`,
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

		const changedEvent = await recordMissionPilotQuestionnaireStateChanged({
			id: questionnaireId,
			taskId,
			repositoryId,
			sourceBlueprintMessageId: null,
			status: "accepted",
			createdAt: new Date("2026-07-16T07:50:24.000Z"),
			updatedAt: new Date("2026-07-16T07:50:38.000Z"),
			questionSets: [],
			answers: [],
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
		} satisfies DesignQuestionnaireSession);

		expect(changedEvent?.id).not.toBe(event?.id);
		expect(changedEvent?.sourceEventId).not.toBe(event?.sourceEventId);
	});
});
