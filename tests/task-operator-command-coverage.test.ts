import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getActionDefinition: vi.fn(),
	resolveCapabilities: vi.fn(),
	validateJsonSchema: vi.fn(),
	executeIdempotent: vi.fn(),
	describeResult: vi.fn(),
	readProjection: vi.fn(),
	assertActiveRun: vi.fn(),
	backgroundBelongs: vi.fn(),
	stopBackground: vi.fn(),
	generateBlueprint: vi.fn(),
	generateDataModel: vi.fn(),
	generateFeaturePlan: vi.fn(),
	generatePlanView: vi.fn(),
	commitCloseout: vi.fn(),
	deferMerge: vi.fn(),
	executeMerge: vi.fn(),
	overrideMergeTarget: vi.fn(),
	previewMerge: vi.fn(),
	pushCloseout: vi.fn(),
	requestRework: vi.fn(),
	updateRoutingDelegated: vi.fn(),
	updateRoutingUser: vi.fn(),
	acceptReview: vi.fn(),
	createQuestionnaire: vi.fn(),
	generateAdditional: vi.fn(),
	generateFollowUp: vi.fn(),
	generateReview: vi.fn(),
	leaveReviewUnadopted: vi.fn(),
	questionnaireBelongs: vi.fn(),
	recommendRouting: vi.fn(),
	saveAnswers: vi.fn(),
	archiveQueue: vi.fn(),
	createQueue: vi.fn(),
	patchQueue: vi.fn(),
	recoverQueue: vi.fn(),
	requeueQueue: vi.fn(),
	readRunOutcome: vi.fn(),
	stopRun: vi.fn(),
	submitRunReview: vi.fn(),
	archiveTask: vi.fn(),
	completeTask: vi.fn(),
	restoreTask: vi.fn(),
	sendMessage: vi.fn(),
	updateTask: vi.fn(),
	implementationStart: vi.fn(),
	todoResume: vi.fn(),
}));

vi.mock("../api/modules/backgroundProcess", () => ({
	backgroundProcessBelongsToTask: mocks.backgroundBelongs,
	stopTaskBackgroundProcess: mocks.stopBackground,
}));
vi.mock("../api/modules/blueprint", () => ({
	generateBlueprintArtifact: mocks.generateBlueprint,
}));
vi.mock("../api/modules/commandDelivery", () => ({
	executeIdempotentTaskOperatorCommand: mocks.executeIdempotent,
}));
vi.mock("../api/modules/dataModel", () => ({
	generateDataModelArtifact: mocks.generateDataModel,
}));
vi.mock("../api/modules/gitCloseout", () => ({
	commitRunGitCloseout: mocks.commitCloseout,
	deferTaskRunMerge: mocks.deferMerge,
	executeTaskRunMerge: mocks.executeMerge,
	overrideTaskRunMergeTarget: mocks.overrideMergeTarget,
	previewTaskRunMerge: mocks.previewMerge,
	pushRunGitCloseout: mocks.pushCloseout,
	requestTaskRunRework: mocks.requestRework,
}));
vi.mock("../api/modules/planMode", () => ({
	updatePlanModeRoutingForDelegatedUser: mocks.updateRoutingDelegated,
	updatePlanModeRoutingForUser: mocks.updateRoutingUser,
}));
vi.mock("../api/modules/planViews", () => ({
	generatePlanViewArtifact: mocks.generatePlanView,
}));
vi.mock("../api/modules/questionnaire", () => ({
	acceptDesignQuestionnaireReview: mocks.acceptReview,
	createDesignQuestionnaire: mocks.createQuestionnaire,
	generateAdditionalDesignQuestionnaireQuestions: mocks.generateAdditional,
	generateDesignQuestionnaireFollowUp: mocks.generateFollowUp,
	generateDesignQuestionnaireReview: mocks.generateReview,
	leaveDesignQuestionnaireReviewUnadopted: mocks.leaveReviewUnadopted,
	questionnaireSessionBelongsToTask: mocks.questionnaireBelongs,
	recommendQuestionnaireArtifactRouting: mocks.recommendRouting,
	saveDesignQuestionnaireAnswers: mocks.saveAnswers,
}));
vi.mock("../api/modules/queue", () => ({
	archiveImplementationQueueEntry: mocks.archiveQueue,
	createImplementationQueueEntry: mocks.createQueue,
	patchImplementationQueueEntry: mocks.patchQueue,
	recoverImplementationQueueEntry: mocks.recoverQueue,
	requeueImplementationQueueEntry: mocks.requeueQueue,
}));
vi.mock("../api/modules/run", () => ({
	readRunOperatorOutcome: mocks.readRunOutcome,
	stopTaskRun: mocks.stopRun,
	submitRunReviewCommand: mocks.submitRunReview,
}));
vi.mock("../api/modules/specification", () => ({
	generateFeaturePlanArtifact: mocks.generateFeaturePlan,
}));
vi.mock("../api/modules/task", () => ({
	archiveTaskCommand: mocks.archiveTask,
	completeTaskFromRunCommand: mocks.completeTask,
	restoreTaskArchiveCommand: mocks.restoreTask,
	sendTaskOperatorMessage: mocks.sendMessage,
	updateTaskCommand: mocks.updateTask,
}));
vi.mock(
	"../api/modules/taskOperator/policies/task-operator-action.registry",
	() => ({
		getTaskOperatorActionDefinition: mocks.getActionDefinition,
	}),
);
vi.mock(
	"../api/modules/taskOperator/policies/task-operator-active-run-policy",
	() => ({
		assertTaskOperatorActiveRunResource: mocks.assertActiveRun,
	}),
);
vi.mock(
	"../api/modules/taskOperator/policies/task-operator-authorization",
	() => ({
		permissionDenied: (message: string) =>
			Object.assign(new Error(message), {
				status: 403,
				code: "TASK_OPERATOR_PERMISSION_DENIED",
			}),
		resolveTaskOperatorPrincipalCapabilities: mocks.resolveCapabilities,
	}),
);
vi.mock(
	"../api/modules/taskOperator/policies/task-operator-json-schema",
	() => ({
		validateTaskOperatorJsonSchema: mocks.validateJsonSchema,
	}),
);
vi.mock("../api/modules/taskOperator/application/task-operator.query", () => ({
	readTaskOperatorProjection: mocks.readProjection,
}));
vi.mock(
	"../api/modules/taskOperator/application/task-operator-command-result",
	() => ({
		describeTaskOperatorCommandResult: mocks.describeResult,
	}),
);
vi.mock(
	"../api/modules/taskOperator/application/task-operator-implementation-start",
	() => ({ executeTaskOperatorImplementationStart: mocks.implementationStart }),
);
vi.mock(
	"../api/modules/taskOperator/application/task-operator-todo-resume",
	() => ({
		executeTaskOperatorTodoResume: mocks.todoResume,
	}),
);

const { executeTaskOperatorCommand } = await import(
	"../api/modules/taskOperator/application/task-operator.command"
);

const taskId = "task-coverage";
const entryId = "entry-coverage";
const runId = "run-coverage";
const sessionId = "questionnaire-coverage";
const expectedRevision = 7;
const routingArguments = {
	expectedRevision: 0,
	idempotencyKey: "00000000-0000-4000-8000-000000000001",
	changes: [{ view: "blueprint", decision: "include", reason: "needed" }],
};
const actionCases = [
	["task.update", { fields: { title: "Updated" } }, "updateTask"],
	["task.archive", { discardPendingCloseouts: true }, "archiveTask"],
	["task.archive.restore", {}, "restoreTask"],
	["task.message.send", { content: "Continue" }, "sendMessage"],
	[
		"questionnaire.create",
		{ prompt: "Questions", sourceBlueprintMessageId: "source" },
		"createQuestionnaire",
	],
	[
		"questionnaire.submit",
		{ questionnaireSessionId: sessionId, answers: [] },
		"saveAnswers",
	],
	[
		"questionnaire.follow_up.generate",
		{ questionnaireSessionId: sessionId },
		"generateFollowUp",
	],
	[
		"questionnaire.additional.generate",
		{ source: "user_requested", reason: "details" },
		"generateAdditional",
	],
	[
		"questionnaire.review.generate",
		{ questionnaireSessionId: sessionId },
		"generateReview",
	],
	[
		"questionnaire.review.accept",
		{ questionnaireSessionId: sessionId },
		"acceptReview",
	],
	[
		"questionnaire.review.leave_unadopted",
		{ questionnaireSessionId: sessionId },
		"leaveReviewUnadopted",
	],
	[
		"plan.artifact.feature_plan.generate",
		{
			prompt: "Feature",
			questionnaireSessionId: sessionId,
			sourceSelection: {},
		},
		"generateFeaturePlan",
	],
	[
		"plan.artifact.blueprint.generate",
		{ prompt: "Blueprint", sourceSelection: {} },
		"generateBlueprint",
	],
	[
		"plan.artifact.data_model.generate",
		{ prompt: "Data", sourceSelection: {} },
		"generateDataModel",
	],
	[
		"plan.artifact.view.generate",
		{ view: "user_flow", prompt: "View", sourceSelection: {} },
		"generatePlanView",
	],
	["plan.routing.update", routingArguments, "updateRoutingUser"],
	["task.queue.enqueue", {}, "createQueue"],
	[
		"task.queue.update",
		{ entryId, action: "resume", priority: 2, queuePosition: 0 },
		"patchQueue",
	],
	["task.queue.cancel", { entryId }, "patchQueue"],
	["task.queue.requeue", { entryId, note: "retry" }, "requeueQueue"],
	[
		"task.queue.recover",
		{ entryId, action: "retry", note: "recover" },
		"recoverQueue",
	],
	["task.queue.archive", { entryId }, "archiveQueue"],
	["run.implementation.start", { request: "Implement" }, "implementationStart"],
	[
		"run.todo.resume",
		{ runId, todoId: "todo", expectedTodoRevision: 0, userContext: "Resume" },
		"todoResume",
	],
	["run.stop", { runId }, "stopRun"],
	["task.complete", { sourceRunId: runId }, "completeTask"],
	["background_process.stop", { processId: "process" }, "stopBackground"],
	[
		"run.review.submit",
		{ runId, action: "complete", note: "approved" },
		"submitRunReview",
	],
	["git.commit", { sourceRunId: runId }, "commitCloseout"],
	["git.push", { sourceRunId: runId }, "pushCloseout"],
	["git.merge.preview", { runId, expectedVersion: 0 }, "previewMerge"],
	["git.merge.defer", { runId, expectedVersion: 1 }, "deferMerge"],
	["git.merge.rework", { runId, expectedVersion: 2 }, "requestRework"],
	[
		"git.merge.target.update",
		{ runId, targetBranch: "main", expectedVersion: 3 },
		"overrideMergeTarget",
	],
	["git.merge.execute", { runId, expectedVersion: 4 }, "executeMerge"],
] as const;
const allActionIds = actionCases.map(([actionId]) => actionId);

function input(
	actionId: string,
	args: Record<string, unknown> = {},
	overrides: Record<string, unknown> = {},
) {
	return {
		taskId,
		actionId,
		expectedTaskRevision: expectedRevision,
		arguments: args,
		context: {
			principal: {
				kind: "human",
				actorId: "local-user",
				authorizationRef: "local-session",
			},
			requestId: `request-${actionId}`,
			idempotencyKey: `delivery-${actionId}`,
		},
		...overrides,
	} as never;
}

beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.getActionDefinition.mockImplementation((actionId: string) =>
		actionId === "unknown.action"
			? null
			: { actionId, capability: "plan", inputSchema: { type: "object" } },
	);
	mocks.resolveCapabilities.mockResolvedValue(["plan"]);
	mocks.validateJsonSchema.mockReturnValue(null);
	mocks.describeResult.mockReturnValue({ summary: "done" });
	mocks.executeIdempotent.mockImplementation(
		async (delivery: {
			execute: () => Promise<unknown>;
			describeResult: (result: unknown) => unknown;
		}) => {
			const data = await delivery.execute();
			delivery.describeResult(data);
			return { receipt: { status: "completed" }, data };
		},
	);
	mocks.readProjection.mockResolvedValue({
		task: { revision: expectedRevision, status: "ready" },
		activeRun: { id: runId },
		queue: { id: entryId },
		commandCatalog: {
			availableIds: [...allActionIds, "known.but.unsupported"],
		},
	});
	mocks.backgroundBelongs.mockResolvedValue(true);
	mocks.questionnaireBelongs.mockResolvedValue(true);
	mocks.readRunOutcome.mockResolvedValue({ status: "succeeded" });
	for (const name of [
		"stopBackground",
		"generateBlueprint",
		"generateDataModel",
		"generateFeaturePlan",
		"generatePlanView",
		"commitCloseout",
		"deferMerge",
		"executeMerge",
		"overrideMergeTarget",
		"previewMerge",
		"pushCloseout",
		"requestRework",
		"updateRoutingDelegated",
		"updateRoutingUser",
		"acceptReview",
		"createQuestionnaire",
		"generateAdditional",
		"generateFollowUp",
		"generateReview",
		"leaveReviewUnadopted",
		"recommendRouting",
		"saveAnswers",
		"archiveQueue",
		"createQueue",
		"patchQueue",
		"recoverQueue",
		"requeueQueue",
		"stopRun",
		"submitRunReview",
		"archiveTask",
		"completeTask",
		"restoreTask",
		"sendMessage",
		"updateTask",
		"implementationStart",
		"todoResume",
	] as const) {
		mocks[name].mockResolvedValue({ source: name });
	}
});

describe("executeTaskOperatorCommand dispatch coverage", () => {
	it.each(actionCases)("dispatches %s", async (actionId, args, mockName) => {
		const delivered = await executeTaskOperatorCommand(input(actionId, args));
		expect(mocks[mockName]).toHaveBeenCalled();
		expect(delivered).toMatchObject({
			receipt: { status: "completed" },
			data: { source: mockName },
		});
		expect(mocks.describeResult).toHaveBeenCalledWith(actionId, delivered.data);
	});

	it("propagates runtime metadata and normalizes artifact boundaries", async () => {
		const signal = new AbortController().signal;
		const runtime = {
			signal,
			structuredLlmRole: "planner",
			providerExecutionPolicy: { provider: "test" },
			usageTrace: { usage: true },
			artifactTrace: { artifact: true },
			messageTrace: { message: true },
			messageMetadata: { source: "custom" },
		};
		await executeTaskOperatorCommand(
			input("task.message.send", { content: "hello" }, { runtime }),
		);
		expect(mocks.sendMessage).toHaveBeenCalledWith(
			taskId,
			"hello",
			runtime.messageMetadata,
			runtime.messageTrace,
		);
		await executeTaskOperatorCommand(
			input(
				"plan.artifact.feature_plan.generate",
				{ prompt: "plan", questionnaireSessionId: "", sourceSelection: null },
				{ runtime },
			),
		);
		expect(mocks.generateFeaturePlan).toHaveBeenCalledWith(
			taskId,
			expect.objectContaining({
				prompt: "plan",
				questionnaireSessionId: null,
				sourceSelection: {},
				role: "planner",
				signal,
			}),
		);
	});

	it("uses delegated routing for delegated principals", async () => {
		const delegatedAuthorization = { authorize: vi.fn() };
		await executeTaskOperatorCommand(
			input("plan.routing.update", routingArguments, {
				context: {
					principal: {
						kind: "delegated_user",
						actorId: "pilot",
						authorizationRef: "delegated",
						subjectUserId: "local-user",
						delegationRef: {},
					},
					requestId: "delegated-request",
					idempotencyKey: "delegated-delivery",
				},
				runtime: { delegatedAuthorization },
			}),
		);
		expect(mocks.resolveCapabilities).toHaveBeenCalledWith(
			expect.objectContaining({ delegatedAuthorization }),
		);
		expect(mocks.updateRoutingDelegated).toHaveBeenCalledWith(
			taskId,
			routingArguments,
		);
		expect(mocks.updateRoutingUser).not.toHaveBeenCalled();
	});

	it("normalizes optional and union inputs at boundaries", async () => {
		await executeTaskOperatorCommand(
			input("task.queue.update", {
				entryId,
				action: false,
				priority: "high",
				queuePosition: null,
			}),
		);
		expect(mocks.patchQueue).toHaveBeenCalledWith(entryId, {
			action: undefined,
			priority: undefined,
			queuePosition: null,
		});
		await executeTaskOperatorCommand(
			input("task.queue.update", { entryId, queuePosition: "first" }),
		);
		expect(mocks.patchQueue).toHaveBeenLastCalledWith(entryId, {
			action: undefined,
			priority: undefined,
			queuePosition: undefined,
		});
		await executeTaskOperatorCommand(input("task.queue.requeue", { entryId }));
		expect(mocks.requeueQueue).toHaveBeenCalledWith(entryId, {
			note: undefined,
		});
		await executeTaskOperatorCommand(
			input("questionnaire.create", { prompt: "create" }),
		);
		expect(mocks.createQuestionnaire).toHaveBeenCalledWith(
			taskId,
			null,
			"create",
			expect.any(Object),
		);
		await executeTaskOperatorCommand(
			input("questionnaire.additional.generate", {
				source: "user_requested",
				reason: 3,
			}),
		);
		expect(mocks.generateAdditional).toHaveBeenCalledWith(
			taskId,
			expect.objectContaining({ reason: undefined }),
		);
	});
});

describe("executeTaskOperatorCommand validation and failure coverage", () => {
	it("rejects unknown actions before authorization", async () => {
		await expect(
			executeTaskOperatorCommand(input("unknown.action")),
		).rejects.toMatchObject({
			statusCode: 422,
			code: "TASK_OPERATOR_ACTION_UNKNOWN",
		});
		expect(mocks.resolveCapabilities).not.toHaveBeenCalled();
	});

	it("rejects missing capabilities and invalid canonical arguments", async () => {
		mocks.resolveCapabilities.mockResolvedValue(["review"]);
		await expect(
			executeTaskOperatorCommand(input("task.update", { fields: {} })),
		).rejects.toMatchObject({ code: "TASK_OPERATOR_PERMISSION_DENIED" });
		expect(mocks.executeIdempotent).not.toHaveBeenCalled();

		mocks.resolveCapabilities.mockResolvedValue(["plan"]);
		mocks.validateJsonSchema.mockReturnValue("fields is required");
		await expect(
			executeTaskOperatorCommand(input("task.update")),
		).rejects.toMatchObject({
			statusCode: 422,
			code: "TASK_OPERATOR_SCHEMA_VALIDATION",
		});
	});

	it("validates lazily resolved arguments inside idempotent delivery", async () => {
		const resolveArgumentsForExecution = vi
			.fn()
			.mockResolvedValue({ fields: { title: "resolved" } });
		await executeTaskOperatorCommand(
			input("task.update", { stale: true }, { resolveArgumentsForExecution }),
		);
		expect(mocks.validateJsonSchema).toHaveBeenCalledOnce();
		expect(mocks.updateTask).toHaveBeenCalledWith(
			expect.objectContaining({ fields: { title: "resolved" } }),
		);
		mocks.validateJsonSchema.mockReturnValue("resolved input invalid");
		await expect(
			executeTaskOperatorCommand(
				input("task.update", {}, { resolveArgumentsForExecution }),
			),
		).rejects.toMatchObject({ code: "TASK_OPERATOR_SCHEMA_VALIDATION" });
	});

	it("rejects stale revisions and unavailable commands", async () => {
		mocks.readProjection.mockResolvedValueOnce({
			task: { revision: 8, status: "ready" },
			commandCatalog: { availableIds: ["task.update"] },
		});
		await expect(
			executeTaskOperatorCommand(input("task.update", { fields: {} })),
		).rejects.toMatchObject({
			statusCode: 409,
			code: "TASK_REVISION_CONFLICT",
			details: { currentTaskRevision: 8 },
		});
		mocks.readProjection.mockResolvedValueOnce({
			task: { revision: expectedRevision, status: "ready" },
			commandCatalog: { availableIds: [] },
		});
		await expect(
			executeTaskOperatorCommand(input("task.update", { fields: {} })),
		).rejects.toMatchObject({ code: "TASK_OPERATOR_COMMAND_UNAVAILABLE" });
	});

	it.each([
		"completed",
		"cancelled",
		"failed",
		"timed_out",
	])("keeps questionnaire submission read-only for %s tasks", async (status) => {
		mocks.readProjection.mockResolvedValue({
			task: { revision: expectedRevision, status },
			commandCatalog: { availableIds: ["questionnaire.submit"] },
		});
		await expect(
			executeTaskOperatorCommand(
				input("questionnaire.submit", {
					questionnaireSessionId: sessionId,
					answers: [],
				}),
			),
		).rejects.toMatchObject({ code: "PLAN_MODE_READ_ONLY" });
	});

	it.each([
		["git.commit", { sourceRunId: runId }, "run"],
		["task.queue.cancel", { entryId }, "queue"],
		[
			"questionnaire.review.accept",
			{ questionnaireSessionId: sessionId },
			"questionnaire",
		],
		["background_process.stop", { processId: "process" }, "background"],
	] as const)("rejects foreign resource for %s", async (actionId, args, resource) => {
		if (resource === "run") mocks.readRunOutcome.mockResolvedValue(null);
		if (resource === "queue") {
			mocks.readProjection.mockResolvedValue({
				task: { revision: expectedRevision, status: "ready" },
				queue: { id: "other-entry" },
				commandCatalog: { availableIds: [actionId] },
			});
		}
		if (resource === "questionnaire")
			mocks.questionnaireBelongs.mockResolvedValue(false);
		if (resource === "background")
			mocks.backgroundBelongs.mockResolvedValue(false);
		await expect(
			executeTaskOperatorCommand(input(actionId, args)),
		).rejects.toMatchObject({
			statusCode: 403,
			code: "TASK_RESOURCE_OWNERSHIP_MISMATCH",
		});
	});

	it("rechecks terminal run ownership before completion", async () => {
		mocks.readRunOutcome
			.mockResolvedValueOnce({ status: "succeeded" })
			.mockResolvedValueOnce(null);
		await expect(
			executeTaskOperatorCommand(
				input("task.complete", { sourceRunId: runId }),
			),
		).rejects.toMatchObject({ code: "TASK_RESOURCE_OWNERSHIP_MISMATCH" });
	});

	it.each([
		["task.message.send", { content: "" }],
		[
			"run.todo.resume",
			{ runId, todoId: "", expectedTodoRevision: 0, userContext: "x" },
		],
		[
			"git.merge.target.update",
			{ runId, targetBranch: "", expectedVersion: 0 },
		],
	] as const)("rejects empty required text for %s", async (actionId, args) => {
		await expect(
			executeTaskOperatorCommand(input(actionId, args)),
		).rejects.toMatchObject({
			code: "TASK_OPERATOR_ARGUMENT_REQUIRED",
			message: "A non-empty string is required.",
		});
	});

	it.each([
		-1,
		1.5,
		"1",
		undefined,
	])("rejects invalid integer boundary %#", async (expectedVersion) => {
		await expect(
			executeTaskOperatorCommand(
				input("git.merge.preview", { runId, expectedVersion }),
			),
		).rejects.toMatchObject({
			code: "TASK_OPERATOR_ARGUMENT_REQUIRED",
			message: "A non-negative integer is required.",
		});
	});

	it("rejects a registered but unimplemented action", async () => {
		await expect(
			executeTaskOperatorCommand(input("known.but.unsupported")),
		).rejects.toMatchObject({
			statusCode: 422,
			code: "TASK_OPERATOR_COMMAND_UNSUPPORTED",
		});
	});
});
