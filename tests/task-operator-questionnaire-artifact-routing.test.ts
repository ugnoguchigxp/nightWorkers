import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	LOCAL_TASK_OPERATOR_USER_AUTHORIZATION_REF,
	LOCAL_TASK_OPERATOR_USER_ID,
} from "../api/modules/taskOperator/policies/task-operator-authorization";

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

const questionnaireId = crypto.randomUUID();
const completedQuestionnaire = {
	id: questionnaireId,
	status: "review_ready",
	answers: [],
};

function command(kind: "human" | "delegated_user") {
	const delegatedAuthorization = {
		authorize: vi.fn().mockResolvedValue({ capabilities: ["plan"] }),
	};
	return executeTaskOperatorCommand({
		taskId: "task-1",
		actionId: "questionnaire.submit",
		expectedTaskRevision: 7,
		arguments: {
			questionnaireSessionId: questionnaireId,
			answers: [],
		},
		context: {
			principal:
				kind === "human"
					? {
							kind,
							actorId: LOCAL_TASK_OPERATOR_USER_ID,
							authorizationRef: LOCAL_TASK_OPERATOR_USER_AUTHORIZATION_REF,
						}
					: {
							kind,
							actorId: "mission-pilot-session",
							authorizationRef: "delegated-local-user",
							subjectUserId: LOCAL_TASK_OPERATOR_USER_ID,
							delegationRef: {
								sessionId: "mission-pilot-session",
								taskId: "task-1",
								grantedAt: new Date(0).toISOString(),
								capabilityDigest: `sha256:${"0".repeat(64)}`,
							},
						},
			requestId: `${kind}-request`,
			idempotencyKey: `${kind}-delivery`,
		},
		runtime: kind === "delegated_user" ? { delegatedAuthorization } : undefined,
	});
}

beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.executeIdempotentTaskOperatorCommand.mockImplementation(
		(input: { execute: () => Promise<unknown> }) => input.execute(),
	);
	mocks.readTaskOperatorProjection.mockResolvedValue({
		task: { revision: 7, status: "ready" },
		questionnaire: { id: questionnaireId },
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
	it("rejects a forged direct principal instead of granting user capabilities", async () => {
		await expect(
			executeTaskOperatorCommand({
				taskId: "task-1",
				actionId: "questionnaire.submit",
				expectedTaskRevision: 7,
				arguments: {
					questionnaireSessionId: questionnaireId,
					answers: [],
				},
				context: {
					principal: {
						kind: "human",
						actorId: "forged-user",
						authorizationRef: "forged-authorization",
					},
					requestId: "forged-request",
					idempotencyKey: "forged-delivery",
				},
			}),
		).rejects.toMatchObject({ code: "TASK_OPERATOR_PERMISSION_DENIED" });
		expect(mocks.executeIdempotentTaskOperatorCommand).not.toHaveBeenCalled();
	});

	it("enforces the canonical action schema before command delivery", async () => {
		await expect(
			executeTaskOperatorCommand({
				taskId: "task-1",
				actionId: "questionnaire.submit",
				expectedTaskRevision: 7,
				arguments: {
					questionnaireSessionId: "not-a-uuid",
					answers: [],
				},
				context: {
					principal: {
						kind: "human",
						actorId: LOCAL_TASK_OPERATOR_USER_ID,
						authorizationRef: LOCAL_TASK_OPERATOR_USER_AUTHORIZATION_REF,
					},
					requestId: "invalid-schema-request",
					idempotencyKey: "invalid-schema-delivery",
				},
			}),
		).rejects.toMatchObject({ code: "TASK_OPERATOR_SCHEMA_VALIDATION" });
		expect(mocks.executeIdempotentTaskOperatorCommand).not.toHaveBeenCalled();
	});

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

	it("uses the same artifact recommendation for delegated Mission Pilot answers", async () => {
		await expect(command("delegated_user")).resolves.toBe(
			completedQuestionnaire,
		);

		expect(mocks.saveDesignQuestionnaireAnswers).toHaveBeenCalledOnce();
		expect(mocks.recommendQuestionnaireArtifactRouting).toHaveBeenCalledWith(
			"task-1",
			completedQuestionnaire,
		);
	});
});
