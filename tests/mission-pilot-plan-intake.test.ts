import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	preparePlanIntake: vi.fn(),
	listQuestionnaires: vi.fn(),
	publishReady: vi.fn(),
	runPipeline: vi.fn(),
	assertMutable: vi.fn(),
}));

vi.mock("../api/modules/questionnaire/questionnaire.service", () => ({
	listDesignQuestionnaires: mocks.listQuestionnaires,
}));
vi.mock("../api/modules/questionnaire/questionnaire-events", () => ({
	publishQuestionnaireReady: mocks.publishReady,
}));
vi.mock("../api/modules/missionPilot/mission-pilot-workbench.port", () => ({
	prepareMissionPilotPlanModeIntake: mocks.preparePlanIntake,
}));
vi.mock(
	"../api/modules/missionPilot/mission-pilot-plan-coordinator.service",
	() => ({
		runMissionPilotPlanPipeline: mocks.runPipeline,
	}),
);
vi.mock(
	"../api/modules/missionPilot/mission-pilot-pre-queue-recovery.service",
	() => ({ assertMissionPilotPreQueueMutable: mocks.assertMutable }),
);

const { startOrResumeMissionPilotPlanIntake } = await import(
	"../api/modules/missionPilot/mission-pilot-plan-intake.service"
);

beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.assertMutable.mockResolvedValue(undefined);
});

describe("Mission Pilot typed Plan intake", () => {
	it("creates a Questionnaire directly without starting a TaskRun", async () => {
		mocks.listQuestionnaires.mockResolvedValue([]);
		mocks.preparePlanIntake.mockResolvedValue({
			id: "questionnaire-1",
			status: "answering",
		});

		await expect(
			startOrResumeMissionPilotPlanIntake({
				taskId: "task-1",
				initialPrompt: "計画を作成する",
			}),
		).resolves.toEqual({
			questionnaireSessionId: "questionnaire-1",
			questionnaireStatus: "answering",
		});
		expect(mocks.preparePlanIntake).toHaveBeenCalledWith({
			taskId: "task-1",
			prompt: "計画を作成する",
		});
		expect(mocks.runPipeline).not.toHaveBeenCalled();
	});

	it("reuses an answering Questionnaire and republishes its ready event", async () => {
		const questionnaire = { id: "questionnaire-2", status: "answering" };
		mocks.listQuestionnaires.mockResolvedValue([questionnaire]);
		mocks.preparePlanIntake.mockResolvedValue(questionnaire);

		await startOrResumeMissionPilotPlanIntake({
			taskId: "task-2",
			initialPrompt: "既存Questionnaireを再利用する",
		});

		expect(mocks.preparePlanIntake).toHaveBeenCalledWith({
			taskId: "task-2",
			prompt: "既存Questionnaireを再利用する",
			questionnaireSession: questionnaire,
		});
		expect(mocks.publishReady).toHaveBeenCalledWith(questionnaire);
	});

	it("resumes the pipeline without rearming intervention for pre-Feature Plan questions", async () => {
		const questionnaire = {
			id: "questionnaire-pre-feature",
			status: "answering",
			questionSets: [
				{
					questionnaire: {
						questionSets: [{ metadata: { source: "pre_feature_plan_gate" } }],
					},
				},
			],
		};
		mocks.listQuestionnaires.mockResolvedValue([questionnaire]);
		mocks.preparePlanIntake.mockResolvedValue(questionnaire);
		mocks.runPipeline.mockResolvedValue(undefined);

		await startOrResumeMissionPilotPlanIntake({
			taskId: "task-pre-feature",
			initialPrompt: "Feature Plan直前から再開する",
		});

		await vi.waitFor(() =>
			expect(mocks.runPipeline).toHaveBeenCalledWith("task-pre-feature"),
		);
		expect(mocks.publishReady).not.toHaveBeenCalled();
	});

	it("schedules the Plan pipeline for reviewed Questionnaire evidence", async () => {
		const questionnaire = { id: "questionnaire-3", status: "review_ready" };
		mocks.listQuestionnaires.mockResolvedValue([questionnaire]);
		mocks.preparePlanIntake.mockResolvedValue(questionnaire);
		mocks.runPipeline.mockResolvedValue(undefined);

		await startOrResumeMissionPilotPlanIntake({
			taskId: "task-3",
			initialPrompt: "review済み計画を再開する",
		});
		await vi.waitFor(() =>
			expect(mocks.runPipeline).toHaveBeenCalledWith("task-3"),
		);
		expect(mocks.preparePlanIntake).toHaveBeenCalledWith({
			taskId: "task-3",
			prompt: "review済み計画を再開する",
			questionnaireSession: questionnaire,
		});
	});

	it("stops at an invalid Questionnaire instead of bypassing it", async () => {
		mocks.listQuestionnaires.mockResolvedValue([
			{ id: "questionnaire-4", status: "needs_edit" },
		]);

		await expect(
			startOrResumeMissionPilotPlanIntake({
				taskId: "task-4",
				initialPrompt: "不正なQuestionnaireを確認する",
			}),
		).rejects.toMatchObject({
			statusCode: 409,
			code: "MISSION_PILOT_PLAN_INTAKE_NEEDS_EDIT",
		});
		expect(mocks.preparePlanIntake).not.toHaveBeenCalled();
		expect(mocks.runPipeline).not.toHaveBeenCalled();
	});
});
