import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSessionByTaskId: vi.fn(),
	listPlanSteps: vi.fn(),
	getLatestPlanReview: vi.fn(),
	listArtifactCorrectionRuns: vi.fn(),
}));

vi.mock("../api/modules/missionPilot/mission-pilot.repository", () => ({
	getSessionByTaskId: mocks.getSessionByTaskId,
}));
vi.mock("../api/modules/missionPilot/mission-pilot-plan.repository", () => ({
	listPlanSteps: mocks.listPlanSteps,
	getLatestPlanReview: mocks.getLatestPlanReview,
	listArtifactCorrectionRuns: mocks.listArtifactCorrectionRuns,
}));

const { getMissionPilotPlanProgress } = await import(
	"../api/modules/missionPilot/mission-pilot-plan-progress.service"
);

describe("Mission Pilot Plan progress projection", () => {
	beforeEach(() => {
		mocks.getSessionByTaskId.mockReset();
		mocks.listPlanSteps.mockReset();
		mocks.getLatestPlanReview.mockReset();
		mocks.listArtifactCorrectionRuns.mockReset();
		mocks.getLatestPlanReview.mockResolvedValue(null);
		mocks.listArtifactCorrectionRuns.mockResolvedValue([]);
	});

	it("returns null for a normal task", async () => {
		mocks.getSessionByTaskId.mockResolvedValue(null);
		await expect(
			getMissionPilotPlanProgress("11111111-1111-4111-8111-111111111111"),
		).resolves.toBeNull();
		expect(mocks.listPlanSteps).not.toHaveBeenCalled();
	});

	it("projects ordered persisted steps and the running step", async () => {
		mocks.getSessionByTaskId.mockResolvedValue({
			id: "22222222-2222-4222-8222-222222222222",
			taskId: "11111111-1111-4111-8111-111111111111",
			phase: "generating_artifacts",
			desiredState: "playing",
			version: 7,
			contextRevision: 4,
			lastErrorMessage: null,
			updatedAt: new Date("2026-07-11T14:00:00.000Z"),
		});
		mocks.listPlanSteps.mockResolvedValue([
			{
				stepKey: "blueprint",
				ordinal: 2,
				evidenceJson: { kind: "blueprint", view: "blueprint" },
				status: "completed",
				attempt: 1,
				artifactMessageId: "33333333-3333-4333-8333-333333333333",
				lastError: null,
				startedAt: new Date("2026-07-11T13:58:00.000Z"),
				finishedAt: new Date("2026-07-11T13:59:00.000Z"),
				updatedAt: new Date("2026-07-11T13:59:00.000Z"),
			},
			{
				stepKey: "data_model",
				ordinal: 3,
				evidenceJson: { kind: "data_model", view: "data_model" },
				status: "running",
				attempt: 1,
				artifactMessageId: null,
				lastError: null,
				startedAt: new Date("2026-07-11T14:00:00.000Z"),
				finishedAt: null,
				updatedAt: new Date("2026-07-11T14:00:00.000Z"),
			},
		]);

		await expect(
			getMissionPilotPlanProgress("11111111-1111-4111-8111-111111111111"),
		).resolves.toMatchObject({
			currentStepKey: "data_model",
			phase: "generating_artifacts",
			steps: [
				expect.objectContaining({ key: "blueprint", status: "completed" }),
				expect.objectContaining({ key: "data_model", status: "running" }),
			],
		});
	});
});
