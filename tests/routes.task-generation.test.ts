import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../api/lib/types";
import { errorHandler } from "../api/middleware/error-handler";

const taskGenerationMocks = vi.hoisted(() => ({
	generateTaskCandidates: vi.fn(),
}));
const securityTaskGenerationMocks = vi.hoisted(() => ({
	generateSecurityScanTaskCandidates: vi.fn(),
}));

vi.mock(
	"../api/modules/taskGeneration/task-generation-orchestrator.service",
	() => taskGenerationMocks,
);
vi.mock(
	"../api/modules/taskGeneration/security-task-candidate.service",
	() => securityTaskGenerationMocks,
);

import { taskGenerationRouter } from "../api/modules/taskGeneration/task-generation.routes";

const createApp = () => {
	const app = new OpenAPIHono<AppEnv>();
	app.route("/api", taskGenerationRouter);
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

	it("passes selected security Finding refs to security task generation", async () => {
		const repositoryId = "22222222-2222-4222-8222-222222222222";
		const scanRunRef = "provider-scan-ref_2026";
		securityTaskGenerationMocks.generateSecurityScanTaskCandidates.mockResolvedValueOnce(
			{
				batchId: null,
				status: "completed",
				candidates: [],
				duplicates: [],
				needsHuman: [],
				coverageWarnings: [],
				llmUsage: null,
			},
		);

		const response = await createApp().request(
			`/api/repositories/${repositoryId}/task-candidates/generate-from-security-scan`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					scanRunRef,
					findingRefs: ["finding-1", "finding-2"],
				}),
			},
		);

		expect(response.status, await response.clone().text()).toBe(201);
		expect(
			securityTaskGenerationMocks.generateSecurityScanTaskCandidates,
		).toHaveBeenCalledWith({
			repositoryId,
			scanRunRef,
			findingRefs: ["finding-1", "finding-2"],
		});
	});

	it("rejects duplicate security Finding refs before generation", async () => {
		const repositoryId = "22222222-2222-4222-8222-222222222222";
		const response = await createApp().request(
			`/api/repositories/${repositoryId}/task-candidates/generate-from-security-scan`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					scanRunRef: "33333333-3333-4333-8333-333333333333",
					findingRefs: ["finding-1", "finding-1"],
				}),
			},
		);

		expect(response.status).toBe(400);
		expect(
			securityTaskGenerationMocks.generateSecurityScanTaskCandidates,
		).not.toHaveBeenCalled();
	});

	it("rejects oversized security Finding selections before generation", async () => {
		const repositoryId = "22222222-2222-4222-8222-222222222222";
		const response = await createApp().request(
			`/api/repositories/${repositoryId}/task-candidates/generate-from-security-scan`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					scanRunRef: "provider-scan-ref_2026",
					findingRefs: Array.from(
						{ length: 26 },
						(_, index) => `finding-${index}`,
					),
				}),
			},
		);

		expect(response.status).toBe(400);
		expect(
			securityTaskGenerationMocks.generateSecurityScanTaskCandidates,
		).not.toHaveBeenCalled();
	});
});
