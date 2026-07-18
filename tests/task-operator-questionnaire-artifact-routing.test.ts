import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	executeIdempotentTaskOperatorCommand: vi.fn(),
	readTaskOperatorProjection: vi.fn(),
	questionnaireSessionBelongsToTask: vi.fn(),
	saveDesignQuestionnaireAnswers: vi.fn(),
	recommendQuestionnaireArtifactRouting: vi.fn(),
}));

vi.mock("../api/modules/commandDelivery", () => ({
	executeIdempotentTaskOperatorCommand:
		mocks.executeIdempotentTaskOperatorCommand,
}));
vi.mock("../api/modules/taskOperator/application/task-operator.query", () => ({
	readTaskOperatorProjection: mocks.readTaskOperatorProjection,
}));
vi.mock("../api/modules/questionnaire", () => ({
	acceptDesignQuestionnaireReview: vi.fn(),
	createDesignQuestionnaire: vi.fn(),
	generateAdditionalDesignQuestionnaireQuestions: vi.fn(),
	generateDesignQuestionnaireFollowUp: vi.fn(),
	generateDesignQuestionnaireReview: vi.fn(),
	leaveDesignQuestionnaireReviewUnadopted: vi.fn(),
	questionnaireSessionBelongsToTask: mocks.questionnaireSessionBelongsToTask,
	recommendQuestionnaireArtifactRouting:
		mocks.recommendQuestionnaireArtifactRouting,
	saveDesignQuestionnaireAnswers: mocks.saveDesignQuestionnaireAnswers,
}));

const { executeTaskOperatorCommand } = await import(
	"../api/modules/taskOperator/application/task-operator.command"
);

const completedQuestionnaire = {
	id: "questionnaire-1",
	status: "review_ready",
	answers: [],
};

function command(kind: "human" | "automation") {
	return executeTaskOperatorCommand({
		taskId: "task-1",
		actionId: "questionnaire.submit",
		expectedTaskRevision: 7,
		arguments: {
			questionnaireSessionId: "questionnaire-1",
			answers: [],
		},
		context: {
			principal: {
				kind,
				actorId: `${kind}-1`,
				authorizationRef: `${kind}-authorization`,
			},
			requestId: `${kind}-request`,
			idempotencyKey: `${kind}-delivery`,
		},
	});
}

beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.executeIdempotentTaskOperatorCommand.mockImplementation(
		(input: { execute: () => Promise<unknown> }) => input.execute(),
	);
	mocks.readTaskOperatorProjection.mockResolvedValue({
		task: { revision: 7, status: "ready" },
		questionnaire: { id: "questionnaire-1" },
		commandCatalog: { availableIds: ["questionnaire.submit"] },
	});
	mocks.questionnaireSessionBelongsToTask.mockResolvedValue(true);
	mocks.saveDesignQuestionnaireAnswers.mockResolvedValue(
		completedQuestionnaire,
	);
	mocks.recommendQuestionnaireArtifactRouting.mockResolvedValue({
		revision: 0,
		entries: [],
	});
});

describe("Task Operator Questionnaire artifact routing", () => {
	it("selects artifacts from confirmed human answers before completing submit", async () => {
		await expect(command("human")).resolves.toBe(completedQuestionnaire);

		expect(mocks.recommendQuestionnaireArtifactRouting).toHaveBeenCalledWith(
			"task-1",
			completedQuestionnaire,
		);
		expect(
			mocks.saveDesignQuestionnaireAnswers.mock.invocationCallOrder[0],
		).toBeLessThan(
			mocks.recommendQuestionnaireArtifactRouting.mock.invocationCallOrder[0],
		);
	});

	it("leaves Mission Pilot automation selection to its own plan pipeline", async () => {
		await expect(command("automation")).resolves.toBe(completedQuestionnaire);

		expect(mocks.saveDesignQuestionnaireAnswers).toHaveBeenCalledOnce();
		expect(mocks.recommendQuestionnaireArtifactRouting).not.toHaveBeenCalled();
	});
});
