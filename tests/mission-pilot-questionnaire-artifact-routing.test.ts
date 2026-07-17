import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSessionByTaskId: vi.fn(),
	ensureQuestionnaireContext: vi.fn(),
	getTask: vi.fn(),
	getPlanModeWorkspace: vi.fn(),
	readGeneralSettings: vi.fn(),
	selectQuestionnaireArtifacts: vi.fn(),
	executeMissionPilotPlanRoutingTool: vi.fn(),
}));

vi.mock("../api/modules/missionPilot/mission-pilot.repository", () => ({
	getSessionByTaskId: mocks.getSessionByTaskId,
}));
vi.mock("../api/modules/missionPilot/mission-pilot-plan-support", () => ({
	ensureQuestionnaireContext: mocks.ensureQuestionnaireContext,
}));
vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getTask: mocks.getTask,
}));
vi.mock("../api/modules/specification/plan-mode-workspace.service", () => ({
	getPlanModeWorkspace: mocks.getPlanModeWorkspace,
}));
vi.mock("../api/services/settings/general-settings", () => ({
	readGeneralSettings: mocks.readGeneralSettings,
}));
vi.mock(
	"../api/modules/missionPilot/planning/mission-pilot-questionnaire-artifact-selection.service",
	() => ({
		selectQuestionnaireArtifacts: mocks.selectQuestionnaireArtifacts,
	}),
);
vi.mock(
	"../api/modules/missionPilot/planning/plan-mode-routing.service",
	() => ({
		executeMissionPilotPlanRoutingTool:
			mocks.executeMissionPilotPlanRoutingTool,
	}),
);

const { selectQuestionnaireArtifactsForTask } = await import(
	"../api/modules/missionPilot/planning/mission-pilot-questionnaire-artifact-routing.service"
);

const questionnaire = {
	id: "questionnaire-1",
	status: "accepted",
} as never;

beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.readGeneralSettings.mockReturnValue({
		planMode: { capabilities: { api_io_contract: true } },
	});
	mocks.ensureQuestionnaireContext.mockResolvedValue(undefined);
});

describe("Mission Pilot Questionnaire artifact routing", () => {
	it("does not inspect or send Questionnaire data while Mission Pilot is stopped", async () => {
		mocks.getSessionByTaskId.mockResolvedValue({
			id: "pilot-1",
			desiredState: "stopped",
		});

		await expect(
			selectQuestionnaireArtifactsForTask({
				taskId: "task-1",
				questionnaire,
			}),
		).resolves.toBeNull();

		expect(mocks.getTask).not.toHaveBeenCalled();
		expect(mocks.getPlanModeWorkspace).not.toHaveBeenCalled();
		expect(mocks.selectQuestionnaireArtifacts).not.toHaveBeenCalled();
	});

	it("fills missing routing reasons after Mission Pilot is playing", async () => {
		const routing = { revision: 2, entries: [] };
		mocks.getSessionByTaskId.mockResolvedValue({
			id: "pilot-1",
			desiredState: "playing",
		});
		mocks.getTask.mockResolvedValue({
			title: "Todo",
			objective: "Implement Todo",
			acceptanceCriteria: "CRUD works",
		});
		mocks.getPlanModeWorkspace.mockResolvedValue({ routing });
		mocks.selectQuestionnaireArtifacts.mockResolvedValue([
			{
				view: "api_io_contract",
				decision: "include",
				reason: "API契約を確定するため。",
			},
		]);
		mocks.executeMissionPilotPlanRoutingTool.mockResolvedValue({
			revision: 1,
		});

		await expect(
			selectQuestionnaireArtifactsForTask({
				taskId: "task-1",
				questionnaire,
				sessionId: "pilot-1",
			}),
		).resolves.toEqual({ revision: 1 });

		expect(mocks.selectQuestionnaireArtifacts).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				sessionId: "pilot-1",
				questionnaire,
			}),
		);
		expect(mocks.executeMissionPilotPlanRoutingTool).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				expectedRevision: 2,
				changes: expect.any(Array),
			}),
		);
	});
});
