import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	parseRegenerationTarget: vi.fn(),
	shouldWaitForWorkbenchIntakeInTests: vi.fn(),
	normalizeStructuredLlmModelTarget: vi.fn(),
	generateDataModelArtifact: vi.fn(),
	startInteractiveReviewPrompt: vi.fn(),
	createPlanArtifactSourceSelection: vi.fn(),
	executePlanModeArtifactCorrection: vi.fn(),
	buildSpecificationVerificationSidecar: vi.fn(),
	publishTaskMessageCreated: vi.fn(),
	assertRunnableWorkbenchTask: vi.fn(),
	queueTask: vi.fn(),
	getTask: vi.fn(),
	listTaskMessages: vi.fn(),
	createTaskMessage: vi.fn(),
	updateTask: vi.fn(),
	getTaskRun: vi.fn(),
	updateTaskMessageMetadata: vi.fn(),
	startTaskRun: vi.fn(),
	createVerificationDocumentFromSpec: vi.fn(),
	handleWorkbenchIntakeMessage: vi.fn(),
	isPlanModeArtifactRegenerationContext: vi.fn(),
	prepareWorkbenchIntakeTask: vi.fn(),
	persistPromptImageAttachments: vi.fn(),
	deletePromptImageAttachmentFiles: vi.fn(),
}));

vi.mock("../shared/schemas/plan-mode-artifact.schema", () => ({
	planModeRegenerationTargetSchema: { parse: mocks.parseRegenerationTarget },
}));

vi.mock("../api/services/runtime-env", () => ({
	shouldWaitForWorkbenchIntakeInTests:
		mocks.shouldWaitForWorkbenchIntakeInTests,
}));

vi.mock("../api/services/structured-llm/selection", () => ({
	normalizeStructuredLlmModelTarget: mocks.normalizeStructuredLlmModelTarget,
}));

vi.mock("../api/modules/dataModel/dataModel-generation.service", () => ({
	generateDataModelArtifact: mocks.generateDataModelArtifact,
}));

vi.mock("../api/modules/review/review-prompt-session.service", () => ({
	startInteractiveReviewPrompt: mocks.startInteractiveReviewPrompt,
}));

vi.mock("../api/modules/specification/plan-artifact-source-selection", () => ({
	createPlanArtifactSourceSelection: mocks.createPlanArtifactSourceSelection,
}));

vi.mock(
	"../api/modules/specification/plan-mode-artifact-correction.service",
	() => ({
		executePlanModeArtifactCorrection: mocks.executePlanModeArtifactCorrection,
	}),
);

vi.mock(
	"../api/modules/specification/specification-verification-sidecar",
	() => ({
		buildSpecificationVerificationSidecar:
			mocks.buildSpecificationVerificationSidecar,
	}),
);

vi.mock("../api/modules/task/events/task-message-events", () => ({
	publishTaskMessageCreated: mocks.publishTaskMessageCreated,
}));

vi.mock(
	"../api/modules/nightworkers/nightworkers.planning-helpers.service",
	() => ({
		assertRunnableWorkbenchTask: mocks.assertRunnableWorkbenchTask,
	}),
);

vi.mock(
	"../api/modules/nightworkers/nightworkers.queue-management.service",
	() => ({ queueTask: mocks.queueTask }),
);

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getTask: mocks.getTask,
	listTaskMessages: mocks.listTaskMessages,
	createTaskMessage: mocks.createTaskMessage,
	updateTask: mocks.updateTask,
	getTaskRun: mocks.getTaskRun,
	updateTaskMessageMetadata: mocks.updateTaskMessageMetadata,
}));

vi.mock(
	"../api/modules/nightworkers/nightworkers.run-orchestration.service",
	() => ({ startTaskRun: mocks.startTaskRun }),
);

vi.mock(
	"../api/modules/nightworkers/nightworkers.verification.service",
	() => ({
		createVerificationDocumentFromSpec:
			mocks.createVerificationDocumentFromSpec,
	}),
);

vi.mock("../api/modules/nightworkers/nightworkers.workbench.service", () => ({
	handleWorkbenchIntakeMessage: mocks.handleWorkbenchIntakeMessage,
	isPlanModeArtifactRegenerationContext:
		mocks.isPlanModeArtifactRegenerationContext,
	prepareWorkbenchIntakeTask: mocks.prepareWorkbenchIntakeTask,
}));

vi.mock("../api/modules/nightworkers/prompt-image-attachments", () => ({
	persistPromptImageAttachments: mocks.persistPromptImageAttachments,
	deletePromptImageAttachmentFiles: mocks.deletePromptImageAttachmentFiles,
}));

import {
	appendAssistantTaskMessage,
	appendTaskMessage,
	appendWorkbenchMessage,
	createPlanningArtifactMessageIfNeeded,
	resumeWorkbenchIntakeMessage,
} from "../api/modules/nightworkers/nightworkers.workbench-message.service";

const task = {
	id: "task-1",
	repositoryId: "repository-1",
	title: "Existing Task",
	objective: "Existing objective",
	status: "ready",
};

const userMessage = {
	id: "message-user",
	role: "user",
	content: "hello",
	messageType: "text",
	metadataJson: {},
};

const planningStartedMessage = {
	id: "run-started",
	role: "system",
	messageType: "text",
	metadataJson: {
		intent: "run_started",
		source: "workbench",
		routingHypothesis: "planning",
		intakeJobSelection: { jobType: "planning" },
	},
};

beforeEach(() => {
	vi.resetAllMocks();
	mocks.shouldWaitForWorkbenchIntakeInTests.mockReturnValue(false);
	mocks.normalizeStructuredLlmModelTarget.mockReturnValue(null);
	mocks.getTask.mockResolvedValue(task);
	mocks.listTaskMessages.mockResolvedValue([]);
	mocks.createTaskMessage.mockResolvedValue(userMessage);
	mocks.updateTask.mockResolvedValue(task);
	mocks.getTaskRun.mockResolvedValue(null);
	mocks.updateTaskMessageMetadata.mockResolvedValue({});
	mocks.startTaskRun.mockResolvedValue({ id: "run-1" });
	mocks.createVerificationDocumentFromSpec.mockResolvedValue({
		id: "verification-document-1",
	});
	mocks.buildSpecificationVerificationSidecar.mockReturnValue({
		document: { specPath: "spec/implementation-plan.md", checks: [] },
	});
	mocks.persistPromptImageAttachments.mockResolvedValue([]);
	mocks.deletePromptImageAttachmentFiles.mockResolvedValue(undefined);
	mocks.handleWorkbenchIntakeMessage.mockResolvedValue({ handled: true });
	mocks.prepareWorkbenchIntakeTask.mockResolvedValue({
		...task,
		status: "draft",
	});
	mocks.queueTask.mockResolvedValue({ ...task, status: "queued" });
	mocks.generateDataModelArtifact.mockResolvedValue({});
	mocks.startInteractiveReviewPrompt.mockResolvedValue({ id: "review-run" });
	mocks.parseRegenerationTarget.mockReturnValue({
		artifactKind: "feature_plan",
		artifactId: "feature-1",
	});
	mocks.createPlanArtifactSourceSelection.mockReturnValue({
		policy: "explicit_request",
	});
	mocks.executePlanModeArtifactCorrection.mockResolvedValue({
		workspace: { id: "workspace-1" },
	});
});

describe("nightworkers workbench message service extra coverage", () => {
	it("skips non-planning and duplicate planning artifacts", async () => {
		mocks.listTaskMessages.mockResolvedValueOnce([]);
		mocks.getTaskRun.mockResolvedValueOnce(null);
		await createPlanningArtifactMessageIfNeeded({
			taskId: task.id,
			runId: "implementation-run",
			finalReport: "report",
		});
		expect(mocks.createTaskMessage).not.toHaveBeenCalled();

		mocks.listTaskMessages.mockResolvedValueOnce([
			planningStartedMessage,
			{
				id: "existing-plan",
				role: "assistant",
				messageType: "markdown_document",
				metadataJson: {
					intent: "implementation_plan",
					sourceRunId: "planning-run",
				},
			},
		]);
		await createPlanningArtifactMessageIfNeeded({
			taskId: task.id,
			runId: "planning-run",
			finalReport: "report",
		});
		expect(mocks.createTaskMessage).not.toHaveBeenCalled();
	});

	it("accepts planning context fallbacks and stops when plan creation returns null", async () => {
		mocks.listTaskMessages.mockResolvedValueOnce([
			{ ...planningStartedMessage, metadataJson: null },
		]);
		mocks.getTaskRun.mockResolvedValueOnce({
			contextSnapshot: { executionMode: "planning" },
		});
		mocks.createTaskMessage.mockResolvedValueOnce(null);
		await createPlanningArtifactMessageIfNeeded({
			taskId: task.id,
			runId: "planning-context-run",
			finalReport: "report",
		});

		mocks.listTaskMessages.mockResolvedValueOnce([]);
		mocks.getTaskRun.mockResolvedValueOnce({
			contextSnapshot: { planModeRequested: true },
		});
		mocks.createTaskMessage.mockResolvedValueOnce(null);
		await createPlanningArtifactMessageIfNeeded({
			taskId: task.id,
			runId: "requested-run",
			finalReport: "report",
		});
		expect(mocks.createTaskMessage).toHaveBeenCalledTimes(2);
	});

	it("throws when verification loses its Task after publishing the plan", async () => {
		mocks.listTaskMessages.mockResolvedValueOnce([planningStartedMessage]);
		mocks.createTaskMessage.mockResolvedValueOnce({
			id: "plan-message",
			metadataJson: {},
		});
		mocks.getTask.mockResolvedValueOnce(null);
		await expect(
			createPlanningArtifactMessageIfNeeded({
				taskId: task.id,
				runId: "planning-run",
				finalReport: "report",
			}),
		).rejects.toMatchObject({ statusCode: 404 });
	});

	it("attaches verification with and without a sidecar message", async () => {
		mocks.listTaskMessages.mockResolvedValueOnce([planningStartedMessage]);
		mocks.createTaskMessage
			.mockResolvedValueOnce({
				id: "plan-no-sidecar",
				metadataJson: { markdownDocumentData: null },
			})
			.mockResolvedValueOnce(null);
		await createPlanningArtifactMessageIfNeeded({
			taskId: task.id,
			runId: "run-no-sidecar",
			finalReport: "plan one",
		});
		expect(mocks.createVerificationDocumentFromSpec).toHaveBeenCalledWith(
			expect.objectContaining({ verificationArtifactId: null }),
		);
		expect(mocks.updateTaskMessageMetadata).toHaveBeenCalledTimes(1);

		mocks.listTaskMessages.mockResolvedValueOnce([planningStartedMessage]);
		mocks.createTaskMessage
			.mockResolvedValueOnce({
				id: "plan-with-sidecar",
				metadataJson: { markdownDocumentData: { title: "Plan" } },
			})
			.mockResolvedValueOnce({
				id: "sidecar-message",
				metadataJson: ["invalid"],
			});
		await createPlanningArtifactMessageIfNeeded({
			taskId: task.id,
			runId: "run-with-sidecar",
			finalReport: "plan two",
		});
		expect(mocks.updateTaskMessageMetadata).toHaveBeenCalledWith(
			"sidecar-message",
			expect.objectContaining({
				verificationArtifactId: "verification-json-sidecar-message",
			}),
		);
		expect(mocks.buildSpecificationVerificationSidecar).toHaveBeenCalledWith(
			expect.objectContaining({
				workspace: expect.objectContaining({
					taskId: task.id,
					repositoryId: task.repositoryId,
					implementationReferences: [
						expect.objectContaining({
							id: "implementation-plan-plan-with-sidecar",
						}),
					],
				}),
			}),
		);
	});

	it("validates and publishes user messages with first-message title behavior", async () => {
		mocks.getTask.mockResolvedValueOnce(null);
		await expect(appendTaskMessage("missing", "hello")).rejects.toMatchObject({
			statusCode: 404,
		});

		await expect(appendTaskMessage(task.id, "   ")).rejects.toMatchObject({
			statusCode: 400,
			code: "EMPTY_PROMPT",
		});

		const newTask = { ...task, title: "New Session" };
		const renamedTask = {
			...newTask,
			title: "A very long first prompt for automatic",
		};
		mocks.getTask
			.mockResolvedValueOnce(newTask)
			.mockResolvedValueOnce(renamedTask);
		mocks.listTaskMessages.mockResolvedValueOnce([]);
		mocks.createTaskMessage.mockResolvedValueOnce(userMessage);
		mocks.updateTask.mockResolvedValueOnce(renamedTask);
		await expect(
			appendTaskMessage(
				task.id,
				"  A very long first prompt for automatic title generation beyond forty characters  ",
				{ source: "test" },
			),
		).resolves.toBe(renamedTask);
		expect(mocks.updateTask).toHaveBeenCalledWith(task.id, {
			title: "A very long first prompt for automatic t",
		});
		expect(mocks.publishTaskMessageCreated).toHaveBeenCalledWith(userMessage);

		mocks.getTask.mockResolvedValueOnce(newTask).mockResolvedValueOnce(newTask);
		mocks.listTaskMessages.mockResolvedValueOnce([userMessage]);
		mocks.createTaskMessage.mockResolvedValueOnce(null);
		await appendTaskMessage(task.id, "another prompt");
		expect(mocks.publishTaskMessageCreated).toHaveBeenCalledTimes(1);

		mocks.getTask.mockResolvedValueOnce(task).mockResolvedValueOnce(null);
		mocks.listTaskMessages.mockResolvedValueOnce([]);
		mocks.createTaskMessage.mockResolvedValueOnce(userMessage);
		await expect(appendTaskMessage(task.id, "lost task")).rejects.toMatchObject(
			{
				statusCode: 404,
			},
		);
	});

	it("validates assistant messages and preserves optional trace metadata", async () => {
		mocks.getTask.mockResolvedValueOnce(null);
		await expect(
			appendAssistantTaskMessage("missing", "hello"),
		).rejects.toMatchObject({ statusCode: 404 });
		await expect(
			appendAssistantTaskMessage(task.id, "  "),
		).rejects.toMatchObject({
			statusCode: 400,
			code: "EMPTY_ASSISTANT_MESSAGE",
		});

		mocks.createTaskMessage
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ ...userMessage, role: "assistant" });
		await expect(
			appendAssistantTaskMessage(task.id, " first "),
		).resolves.toBeNull();
		const trace = {
			traceOwner: "mission_pilot",
			traceChannel: "pilot_thought",
		} as const;
		await appendAssistantTaskMessage(
			task.id,
			" second ",
			{ source: "pilot" },
			trace,
		);
		expect(mocks.createTaskMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({ content: "second", trace }),
		);
		expect(mocks.publishTaskMessageCreated).toHaveBeenCalledTimes(1);
	});

	it("validates workbench requests and removes persisted images after append failure", async () => {
		mocks.getTask.mockResolvedValueOnce(null);
		await expect(
			appendWorkbenchMessage("missing", { prompt: "hello" }),
		).rejects.toMatchObject({ statusCode: 404 });
		await expect(
			appendWorkbenchMessage(task.id, { prompt: "  " }),
		).rejects.toMatchObject({ code: "EMPTY_PROMPT" });

		const attachments = [{ id: "image-1", path: "/tmp/image-1" }];
		mocks.persistPromptImageAttachments.mockResolvedValueOnce(attachments);
		mocks.listTaskMessages.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
		mocks.createTaskMessage.mockRejectedValueOnce(
			new Error("repository failed"),
		);
		await expect(
			appendWorkbenchMessage(task.id, {
				prompt: "image prompt",
				images: [{ dataUrl: "data:image/png;base64,AA==" }],
			}),
		).rejects.toThrow("repository failed");
		expect(mocks.deletePromptImageAttachmentFiles).toHaveBeenCalledWith(
			attachments,
		);
	});

	it("deduplicates command delivery and rejects conflicting content", async () => {
		const commandContext = {
			requestId: "request-1",
			idempotencyKey: "idempotency-1",
			actor: { kind: "delegated_user" as const, actorId: "pilot-1" },
		};
		const delivered = {
			...userMessage,
			content: "same prompt",
			metadataJson: {
				commandProvenance: { idempotencyKey: "idempotency-1" },
			},
		};
		mocks.listTaskMessages.mockResolvedValue([delivered]);
		mocks.shouldWaitForWorkbenchIntakeInTests.mockReturnValue(true);
		await appendWorkbenchMessage(task.id, {
			prompt: "same prompt",
			commandContext,
		});
		expect(mocks.createTaskMessage).not.toHaveBeenCalled();
		expect(mocks.handleWorkbenchIntakeMessage).toHaveBeenCalled();

		mocks.listTaskMessages.mockResolvedValueOnce([
			{ ...delivered, metadataJson: null },
			{ ...delivered, metadataJson: ["invalid"] },
			{
				...delivered,
				metadataJson: { commandProvenance: ["invalid"] },
			},
			delivered,
		]);
		await expect(
			appendWorkbenchMessage(task.id, {
				prompt: "different prompt",
				commandContext,
			}),
		).rejects.toMatchObject({
			statusCode: 409,
			code: "TASK_MESSAGE_REQUEST_CONFLICT",
		});
	});

	it("runs a Task with provider, artifact, command, and image metadata", async () => {
		const routeOverride = {
			providerEndpointId: "provider-1",
			model: "model-1",
		};
		mocks.normalizeStructuredLlmModelTarget.mockReturnValueOnce(routeOverride);
		mocks.persistPromptImageAttachments.mockResolvedValueOnce([
			{ id: "image-1" },
		]);
		mocks.listTaskMessages
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([userMessage]);
		await expect(
			appendWorkbenchMessage(task.id, {
				prompt: "run now",
				intent: "run_task",
				artifactContext: { source: { runId: "source-run" } } as never,
				providerEndpointId: "provider-1",
				model: "model-1",
				thinkingDepth: "high",
				images: [{ dataUrl: "data:image/png;base64,AA==" }],
				source: "mission_pilot",
				commandContext: {
					requestId: "request-1",
					idempotencyKey: "key-1",
					actor: { kind: "human", actorId: "human-1" },
				},
			}),
		).resolves.toMatchObject({ run: { id: "run-1" } });
		expect(mocks.assertRunnableWorkbenchTask).toHaveBeenCalledWith(task, []);
		expect(mocks.startTaskRun).toHaveBeenCalledWith(task.id, {
			executionMode: "implementation",
			executionModeSource: "workbench_run_task",
			routeOverride,
		});
		expect(mocks.createTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				payloadJson: expect.objectContaining({
					intent: "artifact_context_instruction",
					source: "mission_pilot",
					llmSelection: {
						model: "model-1",
						providerEndpointId: "provider-1",
						thinkingDepth: "high",
					},
					imageAttachments: [{ id: "image-1" }],
					commandProvenance: {
						requestId: "request-1",
						idempotencyKey: "key-1",
					},
				}),
			}),
		);
	});

	it("starts an explicit Plan Task on the Plan role contract", async () => {
		const routeOverride = {
			providerEndpointId: "plan-provider",
			model: "plan-model",
		};
		mocks.normalizeStructuredLlmModelTarget.mockReturnValueOnce(routeOverride);
		mocks.listTaskMessages
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([userMessage]);

		await expect(
			appendWorkbenchMessage(task.id, {
				prompt: "plan this task",
				intent: "plan_task",
				providerEndpointId: "plan-provider",
				model: "plan-model",
			}),
		).resolves.toMatchObject({ run: { id: "run-1" } });
		expect(mocks.startTaskRun).toHaveBeenCalledWith(task.id, {
			executionMode: "implementation",
			executionModeSource: "workbench_plan_task",
			planModeRequested: true,
			routeOverride,
		});
	});

	it("generates design data with objective and status fallbacks", async () => {
		const draft = { ...task, objective: "", status: "draft" };
		mocks.getTask.mockResolvedValue(draft);
		mocks.updateTask.mockResolvedValueOnce({ ...draft, status: "ready" });
		await appendWorkbenchMessage(task.id, {
			prompt: "design data",
			intent: "design_blueprint_data",
			model: "model-only",
		});
		expect(mocks.normalizeStructuredLlmModelTarget).toHaveBeenCalledWith({
			model: "model-only",
			providerEndpointId: null,
			thinkingDepth: null,
		});
		expect(mocks.updateTask).toHaveBeenCalledWith(task.id, {
			objective: "design data",
			status: "ready",
		});

		mocks.getTask.mockResolvedValue(task);
		await appendWorkbenchMessage(task.id, {
			prompt: "keep fields",
			intent: "design_blueprint_data",
		});
		expect(mocks.updateTask).toHaveBeenLastCalledWith(task.id, {
			objective: task.objective,
			status: task.status,
		});
	});

	it("validates and executes plan artifact regeneration with optional sources", async () => {
		const artifactContext = {
			source: {},
			metadata: {
				planModeTarget: { requested: true },
				planModeFocus: "focus",
			},
		} as never;
		mocks.isPlanModeArtifactRegenerationContext.mockReturnValue(true);
		mocks.parseRegenerationTarget.mockImplementationOnce(() => {
			throw new Error("invalid regeneration target");
		});
		await expect(
			appendWorkbenchMessage(task.id, {
				prompt: "regenerate",
				artifactContext,
			}),
		).rejects.toThrow("invalid regeneration target");

		mocks.listTaskMessages.mockResolvedValue([]);
		mocks.getTask
			.mockResolvedValueOnce(task)
			.mockResolvedValueOnce(task)
			.mockResolvedValueOnce(task)
			.mockResolvedValueOnce(null);
		await expect(
			appendWorkbenchMessage(task.id, {
				prompt: "regenerate again",
				artifactContext,
				providerEndpointId: "provider-only",
			}),
		).resolves.toMatchObject({
			task,
			workspace: { id: "workspace-1" },
		});
		expect(mocks.createPlanArtifactSourceSelection).toHaveBeenCalledWith({
			policy: "explicit_request",
			previousTargetMessageId: null,
			featurePlanMessageId: null,
			blueprintMessageId: null,
			dataModelMessageId: null,
		});
		expect(mocks.executePlanModeArtifactCorrection).toHaveBeenCalledWith(
			expect.objectContaining({ questionnaireSessionId: null }),
		);
	});

	it("starts review prompts and queues both queue intents", async () => {
		mocks.getTask.mockResolvedValue(task);
		await expect(
			appendWorkbenchMessage(task.id, {
				prompt: "review",
				intent: "review_prompt",
				artifactContext: { source: { runId: "reviewed-run" } } as never,
				thinkingDepth: "low",
			}),
		).resolves.toMatchObject({ run: { id: "review-run" } });
		expect(mocks.startInteractiveReviewPrompt).toHaveBeenCalledWith(
			expect.objectContaining({ reviewedRunId: "reviewed-run" }),
		);

		await appendWorkbenchMessage(task.id, {
			prompt: "follow up",
			intent: "review_followup",
		});
		expect(mocks.startInteractiveReviewPrompt).toHaveBeenLastCalledWith(
			expect.objectContaining({ reviewedRunId: null }),
		);

		await expect(
			appendWorkbenchMessage(task.id, { prompt: "queue", intent: "queue" }),
		).resolves.toMatchObject({ task: { status: "queued" }, run: null });
		await appendWorkbenchMessage(task.id, {
			prompt: "create",
			intent: "create_task",
		});
		expect(mocks.queueTask).toHaveBeenCalledTimes(2);
	});

	it("chooses synchronous and background intake using explicit and test defaults", async () => {
		mocks.handleWorkbenchIntakeMessage.mockResolvedValueOnce({ mode: "sync" });
		await expect(
			appendWorkbenchMessage(task.id, {
				prompt: "sync",
				intent: "draft",
				waitForIntake: true,
			}),
		).resolves.toEqual({ mode: "sync" });

		mocks.shouldWaitForWorkbenchIntakeInTests.mockReturnValueOnce(true);
		mocks.handleWorkbenchIntakeMessage.mockResolvedValueOnce({
			mode: "default-sync",
		});
		await expect(
			appendWorkbenchMessage(task.id, { prompt: "default sync" }),
		).resolves.toEqual({ mode: "default-sync" });

		await expect(
			appendWorkbenchMessage(task.id, {
				prompt: "background",
				intent: "feature_plan",
				waitForIntake: false,
			}),
		).resolves.toMatchObject({ task: { status: "draft" }, run: null });
		expect(mocks.handleWorkbenchIntakeMessage).toHaveBeenLastCalledWith(
			task.id,
			task,
			"background",
			expect.objectContaining({
				failureMode: "record",
				intent: "feature_plan",
			}),
		);
	});

	it("resumes intake in synchronous and background modes with validation", async () => {
		mocks.getTask.mockResolvedValueOnce(null);
		await expect(
			resumeWorkbenchIntakeMessage("missing", "prompt"),
		).rejects.toMatchObject({ statusCode: 404 });

		mocks.handleWorkbenchIntakeMessage.mockResolvedValueOnce({ resumed: true });
		await expect(
			resumeWorkbenchIntakeMessage(task.id, "sync", { waitForIntake: true }),
		).resolves.toEqual({ resumed: true });

		mocks.shouldWaitForWorkbenchIntakeInTests.mockReturnValueOnce(true);
		mocks.handleWorkbenchIntakeMessage.mockResolvedValueOnce({
			defaulted: true,
		});
		await expect(
			resumeWorkbenchIntakeMessage(task.id, "default sync"),
		).resolves.toEqual({ defaulted: true });

		await expect(
			resumeWorkbenchIntakeMessage(task.id, "background", {
				waitForIntake: false,
			}),
		).resolves.toMatchObject({ task: { status: "draft" }, run: null });
		expect(mocks.handleWorkbenchIntakeMessage).toHaveBeenLastCalledWith(
			task.id,
			task,
			"background",
			{
				failureMode: "record",
				intent: "intake",
				artifactContext: null,
				llmRouteOverride: null,
			},
		);
	});
});
