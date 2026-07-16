import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignQuestionnaireSession } from "../shared/schemas/design-questionnaire.schema";

const mocks = vi.hoisted(() => ({
	listTaskRunsForTask: vi.fn(),
	listNeedsHumanTaskRuns: vi.fn(),
	listTaskRunTodosForRun: vi.fn(),
	resumeTaskRunTodo: vi.fn(),
	getDesignQuestionnaireSession: vi.fn(),
	logEvent: vi.fn(),
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	listTaskRunsForTask: mocks.listTaskRunsForTask,
	listNeedsHumanTaskRuns: mocks.listNeedsHumanTaskRuns,
	listTaskRunTodosForRun: mocks.listTaskRunTodosForRun,
}));
vi.mock(
	"../api/modules/nightworkers/nightworkers.run-orchestration.service",
	() => ({
		resumeTaskRunTodo: mocks.resumeTaskRunTodo,
	}),
);
vi.mock("../api/lib/logger", () => ({
	logEvent: mocks.logEvent,
}));
vi.mock("../api/modules/questionnaire/questionnaire.service", () => ({
	getDesignQuestionnaireSession: mocks.getDesignQuestionnaireSession,
}));

import {
	reconcileCodingAgentPlanModeContinuations,
	resumeCodingAgentRunAfterQuestionnaire,
} from "../api/modules/planMode/plan-mode-coding-agent-continuation.service";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("Coding Agent Plan Mode continuation", () => {
	it("resumes the matching paused Todo with the latest accepted review", async () => {
		mocks.listTaskRunsForTask.mockResolvedValue([
			{
				id: "run-1",
				status: "needs_human",
				contextSnapshot: {
					codingAgentPlanMode: {
						awaitingQuestionnaireSessionId: "questionnaire-1",
					},
				},
			},
		]);
		mocks.listTaskRunTodosForRun.mockResolvedValue([
			{ id: "todo-1", status: "needs_human", revision: 4 },
		]);
		mocks.resumeTaskRunTodo.mockResolvedValue({ id: "run-1" });

		const result = await resumeCodingAgentRunAfterQuestionnaire(
			questionnaire({
				status: "accepted",
				reviews: [
					review("latest-review", "accepted", "Latest accepted review"),
					review("older-review", "accepted", "Older accepted review"),
				],
			}),
		);

		expect(result).toEqual({ id: "run-1" });
		expect(mocks.resumeTaskRunTodo).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "run-1",
				todoId: "todo-1",
				expectedTodoRevision: 4,
				userContext: expect.stringContaining("Latest accepted review"),
			}),
		);
		expect(
			mocks.resumeTaskRunTodo.mock.calls[0]?.[0].userContext,
		).not.toContain("Older accepted review");
	});

	it("ignores transitions that have not been accepted", async () => {
		const result = await resumeCodingAgentRunAfterQuestionnaire(
			questionnaire({ status: "review_ready" }),
		);

		expect(result).toBeNull();
		expect(mocks.listTaskRunsForTask).not.toHaveBeenCalled();
		expect(mocks.resumeTaskRunTodo).not.toHaveBeenCalled();
	});

	it("recovers an already accepted Questionnaire continuation at startup", async () => {
		const waitingRun = {
			id: "run-1",
			taskId: "task-1",
			status: "needs_human",
			contextSnapshot: {
				codingAgentPlanMode: {
					awaitingQuestionnaireSessionId: "questionnaire-1",
				},
			},
		};
		mocks.listNeedsHumanTaskRuns.mockResolvedValue([waitingRun]);
		mocks.getDesignQuestionnaireSession.mockResolvedValue(questionnaire());
		mocks.listTaskRunsForTask.mockResolvedValue([waitingRun]);
		mocks.listTaskRunTodosForRun.mockResolvedValue([
			{ id: "todo-1", status: "needs_human", revision: 4 },
		]);
		mocks.resumeTaskRunTodo.mockResolvedValue({ id: "run-1" });

		const resumed = await reconcileCodingAgentPlanModeContinuations();

		expect(resumed).toBe(1);
		expect(mocks.getDesignQuestionnaireSession).toHaveBeenCalledWith(
			"task-1",
			"questionnaire-1",
		);
		expect(mocks.resumeTaskRunTodo).toHaveBeenCalledWith(
			expect.objectContaining({ runId: "run-1", todoId: "todo-1" }),
		);
	});
});

function questionnaire(
	overrides: Partial<DesignQuestionnaireSession> = {},
): DesignQuestionnaireSession {
	return {
		id: "questionnaire-1",
		taskId: "task-1",
		repositoryId: "repository-1",
		sourceBlueprintMessageId: null,
		status: "accepted",
		createdAt: new Date("2026-07-16T00:00:00.000Z"),
		updatedAt: new Date("2026-07-16T00:01:00.000Z"),
		questionSets: [],
		answers: [],
		reviews: [],
		...overrides,
	};
}

function review(
	id: string,
	status: "accepted",
	title: string,
): DesignQuestionnaireSession["reviews"][number] {
	return {
		id,
		review: {
			version: 1,
			title,
			summary: title,
			decisions: [],
			openQuestions: [],
			implementationNotes: [],
		},
		status,
		publishedMessageId: `${id}-message`,
		createdAt: new Date("2026-07-16T00:00:00.000Z"),
		updatedAt: new Date("2026-07-16T00:01:00.000Z"),
	};
}
