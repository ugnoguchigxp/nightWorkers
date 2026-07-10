import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../api/lib/types";
import { errorHandler } from "../api/middleware/error-handler";

const taskGenerationMocks = vi.hoisted(() => ({
	generateTaskCandidates: vi.fn(),
}));

vi.mock(
	"../api/modules/project-detail/task-generation-orchestrator.service",
	() => taskGenerationMocks,
);

import { projectDetailRouter } from "../api/modules/project-detail/project-detail.routes";

const createApp = () => {
	const app = new OpenAPIHono<AppEnv>();
	app.route("/api", projectDetailRouter);
	app.onError(errorHandler);
	return app;
};

describe("unified task generation route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("passes the validated Goal selection to the orchestrator", async () => {
		const repositoryId = "22222222-2222-4222-8222-222222222222";
		const goalId = "11111111-1111-4111-8111-111111111111";
		taskGenerationMocks.generateTaskCandidates.mockResolvedValueOnce({
			status: "completed",
			generationPath: "direct_task_candidates",
			estimate: {
				estimatedChangedLines: 100,
				estimatedFileCount: 2,
				estimatedTaskCount: 1,
				confidencePercent: 90,
				rationale: "small change",
				assumptions: [],
				scale: "small",
			},
			candidates: [],
			missions: [],
			proposals: [],
			decompositionFailures: [],
		});

		const response = await createApp().request(
			`/api/repositories/${repositoryId}/task-candidates/generate`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					goalIds: [goalId],
					includeInactiveGoals: true,
				}),
			},
		);

		expect(response.status).toBe(201);
		expect(taskGenerationMocks.generateTaskCandidates).toHaveBeenCalledWith({
			repositoryId,
			goalIds: [goalId],
			includeInactiveGoals: true,
		});
	});

	it("rejects an invalid Goal id before orchestration", async () => {
		const repositoryId = "22222222-2222-4222-8222-222222222222";
		const response = await createApp().request(
			`/api/repositories/${repositoryId}/task-candidates/generate`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ goalIds: ["not-a-uuid"] }),
			},
		);

		expect(response.status).toBe(400);
		expect(taskGenerationMocks.generateTaskCandidates).not.toHaveBeenCalled();
	});
});
