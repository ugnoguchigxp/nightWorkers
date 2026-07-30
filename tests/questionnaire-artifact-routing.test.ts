import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../api/lib/errors";

const mocks = vi.hoisted(() => ({
	listPlanModeTaskMessages: vi.fn(),
	getPlanModeTask: vi.fn(),
	createPlanModeTaskMessage: vi.fn(),
	getPlanModeWorkspace: vi.fn(),
	getPlanModeRouting: vi.fn(),
	updatePlanModeRoutingFromQuestionnaire: vi.fn(),
	readGeneralSettings: vi.fn(),
	selectQuestionnaireArtifactRouting: vi.fn(),
}));

vi.mock("../api/modules/nightworkers/nightworkers.plan-mode-core.port", () => ({
	listPlanModeTaskMessages: mocks.listPlanModeTaskMessages,
	getPlanModeTask: mocks.getPlanModeTask,
	createPlanModeTaskMessage: mocks.createPlanModeTaskMessage,
}));
vi.mock("../api/modules/specification/plan-mode-workspace.service", () => ({
	getPlanModeWorkspace: mocks.getPlanModeWorkspace,
}));
vi.mock("../api/modules/planMode", () => ({
	getPlanModeRouting: mocks.getPlanModeRouting,
	updatePlanModeRoutingFromQuestionnaire:
		mocks.updatePlanModeRoutingFromQuestionnaire,
}));
vi.mock("../api/services/settings/general-settings", () => ({
	readGeneralSettings: mocks.readGeneralSettings,
}));
vi.mock(
	"../api/modules/questionnaire/questionnaire-artifact-selection.service",
	() => ({
		selectQuestionnaireArtifactRouting:
			mocks.selectQuestionnaireArtifactRouting,
	}),
);

const { recommendQuestionnaireArtifactRouting } = await import(
	"../api/modules/questionnaire/questionnaire-artifact-routing.service"
);

const questionnaire = {
	id: "questionnaire-1",
	status: "review_ready",
	answers: [
		{
			questionId: "api-boundary",
			answer: { questionId: "api-boundary", selectedOptionIds: ["required"] },
		},
	],
} as never;

const decisions = [
	{
		view: "api_io_contract",
		decision: "include",
		reason: "外部API境界をFeature Plan前に標準粒度で確定するため。",
	},
	{
		view: "blueprint",
		decision: "omit",
		reason: "画面変更がなくFeature Planへ統合できるため。",
	},
];

beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.listPlanModeTaskMessages.mockResolvedValue([]);
	mocks.getPlanModeTask.mockResolvedValue({
		title: "API追加",
		objective: "外部APIを追加する",
		acceptanceCriteria: "契約が明確である",
	});
	mocks.getPlanModeWorkspace.mockResolvedValue({
		routing: { revision: 0, entries: [] },
	});
	mocks.readGeneralSettings.mockReturnValue({
		planMode: { capabilities: { api_io_contract: true, blueprint: true } },
	});
	mocks.selectQuestionnaireArtifactRouting.mockResolvedValue(decisions);
	mocks.updatePlanModeRoutingFromQuestionnaire.mockResolvedValue({
		revision: 1,
		entries: decisions,
	});
	mocks.createPlanModeTaskMessage.mockResolvedValue({ id: "message-1" });
});

describe("Questionnaire artifact routing", () => {
	it("persists include and omit reasons from revision zero without Mission Pilot", async () => {
		await expect(
			recommendQuestionnaireArtifactRouting("task-1", questionnaire),
		).resolves.toEqual({ revision: 1, entries: decisions });

		expect(mocks.selectQuestionnaireArtifactRouting).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "task-1", questionnaire }),
		);
		expect(mocks.updatePlanModeRoutingFromQuestionnaire).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				expectedRevision: 0,
				changes: decisions,
			}),
		);
		expect(mocks.createPlanModeTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				payloadJson: expect.objectContaining({
					intent: "questionnaire_artifact_routing",
					viewDecisions: decisions,
				}),
			}),
		);
	});

	it("retries a structural revision conflict using the latest routing", async () => {
		mocks.getPlanModeWorkspace.mockResolvedValue({
			routing: { revision: 4, entries: [] },
		});
		mocks.updatePlanModeRoutingFromQuestionnaire
			.mockRejectedValueOnce(
				new AppError(
					409,
					"PLAN_MODE_ROUTING_REVISION_CONFLICT",
					"routing changed",
				),
			)
			.mockResolvedValueOnce({ revision: 6, entries: decisions });
		mocks.getPlanModeRouting.mockResolvedValue({
			revision: 5,
			entries: [],
		});

		await expect(
			recommendQuestionnaireArtifactRouting("task-1", questionnaire),
		).resolves.toEqual({ revision: 6, entries: decisions });

		expect(
			mocks.updatePlanModeRoutingFromQuestionnaire,
		).toHaveBeenNthCalledWith(
			1,
			"task-1",
			expect.objectContaining({ expectedRevision: 4 }),
		);
		expect(
			mocks.updatePlanModeRoutingFromQuestionnaire,
		).toHaveBeenNthCalledWith(
			2,
			"task-1",
			expect.objectContaining({ expectedRevision: 5 }),
		);
	});
});
