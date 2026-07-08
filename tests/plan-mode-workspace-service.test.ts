import { describe, expect, it, vi } from "vitest";
import { getPlanModeWorkspace } from "../api/modules/specification/plan-mode-workspace.service";
import { getPlanModeTask, listPlanModeTaskMessages } from "../api/modules/nightworkers/nightworkers.plan-mode-core.port";
import { listDesignQuestionnaires } from "../api/modules/questionnaire/questionnaire.service";
import { getBlueprintArtifactAdoption } from "../api/modules/blueprint/blueprint-adoption.service";

vi.mock("../api/modules/nightworkers/nightworkers.plan-mode-core.port", () => ({
	getPlanModeTask: vi.fn(),
	listPlanModeTaskMessages: vi.fn(),
}));

vi.mock("../api/modules/questionnaire/questionnaire.service", () => ({
	listDesignQuestionnaires: vi.fn().mockResolvedValue([]),
}));

vi.mock("../api/modules/blueprint/blueprint-adoption.service", () => ({
	getBlueprintArtifactAdoption: vi.fn().mockResolvedValue(null),
}));

describe("plan-mode-workspace.service", () => {
	it("throws NotFoundError if task is missing", async () => {
		vi.mocked(getPlanModeTask).mockResolvedValueOnce(null);
		await expect(getPlanModeWorkspace("task-1")).rejects.toThrow("Task not found");
	});

	it("returns workspace layout with artifacts and questionnaire parsed", async () => {
		const task = { id: "task-1", repositoryId: "repo-1" } as any;
		vi.mocked(getPlanModeTask).mockResolvedValueOnce(task);

		const messages = [
			{
				id: "msg-fp",
				messageType: "markdown_document",
				createdAt: "2026-07-08T00:00:00Z",
				metadataJson: {
					intent: "feature_plan",
					title: "Feature Plan",
				},
			},
			{
				id: "msg-bp",
				messageType: "markdown_document",
				createdAt: "2026-07-08T00:00:01Z",
				metadataJson: {
					intent: "app_blueprint",
					title: "App Blueprint",
					appBlueprint: { name: "app" },
				},
			},
			{
				id: "msg-dm",
				messageType: "markdown_document",
				createdAt: "2026-07-08T00:00:02Z",
				metadataJson: {
					artifactKind: "plan_mode_dedicated_view",
					view: "data_model",
					title: "Data Model",
				},
			},
			{
				id: "msg-dr",
				messageType: "markdown_document",
				createdAt: "2026-07-08T00:00:03Z",
				metadataJson: {
					intent: "design_decision_review",
					designDecisionReview: { id: "dr-1" },
				},
			},
			{
				id: "msg-ip",
				messageType: "markdown_document",
				createdAt: "2026-07-08T00:00:04Z",
				metadataJson: {
					intent: "implementation_plan",
				},
			},
		] as any;

		vi.mocked(listPlanModeTaskMessages).mockResolvedValueOnce(messages);
		vi.mocked(getBlueprintArtifactAdoption).mockResolvedValueOnce({ adopted: true } as any);

		const result = await getPlanModeWorkspace("task-1");

		expect(result.taskId).toBe("task-1");
		expect(result.repositoryId).toBe("repo-1");
		expect(result.featurePlanArtifacts).toHaveLength(1);
		expect(result.blueprintArtifacts).toHaveLength(1);
		expect(result.blueprintArtifacts[0].adoptionState).toBe("adopted");
		expect(result.dataModelArtifacts).toHaveLength(1);
		expect(result.decisionReviews).toHaveLength(1);
		expect(result.implementationReferences).toHaveLength(1);
	});
});
