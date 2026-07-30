import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishQuestionnaireTransition } from "../api/modules/questionnaire/questionnaire-events";
import { initializeQuestionnaireRealtime } from "../api/modules/questionnaire/questionnaire-realtime";
import { nightWorkersRealtimeBroker } from "../api/services/realtime/nightworkers-ws";
import type { DesignQuestionnaireSession } from "../shared/schemas/design-questionnaire.schema";

afterEach(() => vi.restoreAllMocks());

describe("Questionnaire realtime backend projection", () => {
	it("publishes only canonical identity and revision data after a state transition", async () => {
		initializeQuestionnaireRealtime();
		const publish = vi
			.spyOn(nightWorkersRealtimeBroker, "publish")
			.mockImplementation(() => undefined);
		const session = {
			id: crypto.randomUUID(),
			taskId: crypto.randomUUID(),
			repositoryId: crypto.randomUUID(),
			sourceBlueprintMessageId: null,
			status: "review_ready",
			createdAt: new Date("2026-07-30T01:00:00.000Z"),
			updatedAt: new Date("2026-07-30T01:00:01.000Z"),
			questionSets: [],
			answers: [
				{
					id: crypto.randomUUID(),
					questionId: "api-style",
					answer: {
						questionId: "api-style",
						selectedOptionIds: ["rest"],
						rankedOptionIds: [],
						deferred: false,
					},
					answeredAt: new Date("2026-07-30T01:00:01.000Z"),
				},
			],
			reviews: [],
		} satisfies DesignQuestionnaireSession;

		await publishQuestionnaireTransition(session);

		expect(publish).toHaveBeenCalledWith(session.taskId, {
			type: "questionnaire.state_changed",
			payload: {
				taskId: session.taskId,
				questionnaireSessionId: session.id,
				status: "review_ready",
				revision: session.updatedAt.getTime(),
				stateDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
			},
		});
		expect(publish.mock.calls[0]?.[1]).not.toHaveProperty("payload.answers");
	});
});
