import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	planTargetSafeParse: vi.fn(),
	publish: vi.fn(),
	buildPlanModeSettingsSnapshot: vi.fn(),
	readGeneralSettings: vi.fn(),
	resumeInterruptedCodingAgentRun: vi.fn(),
	decideCodingAgentPlanModeGate: vi.fn(),
	buildCodingAgentPlanModeGatePrompt: vi.fn(),
	buildCodingAgentPlanModeGateUserPrompt: vi.fn(),
	findInterruptedCodingAgentRunCandidate: vi.fn(),
	buildCodingAgentIntakeRoutingSnapshotDigest: vi.fn(),
	loadPersistedCodingAgentPlanModeGateResult: vi.fn(),
	getRepository: vi.fn(),
	listTaskMessages: vi.fn(),
	listTaskRunsForTask: vi.fn(),
	createTaskMessage: vi.fn(),
	updateTask: vi.fn(),
	getTask: vi.fn(),
	getTaskRun: vi.fn(),
	startTaskRun: vi.fn(),
	startWorkbenchPlanModeIntake: vi.fn(),
	workbenchRunStartedMessage: vi.fn(),
	enqueueActivityEvent: vi.fn(),
}));

vi.mock("../shared/schemas/plan-mode-artifact.schema", () => ({
	planModeRegenerationTargetSchema: { safeParse: mocks.planTargetSafeParse },
}));

vi.mock("../api/services/realtime/nightworkers-ws", () => ({
	nightWorkersRealtimeBroker: { publish: mocks.publish },
}));

vi.mock("../api/modules/nightworkers/nightworkers.activity.repository", () => ({
	enqueueActivityEvent: mocks.enqueueActivityEvent,
}));

vi.mock("../api/services/settings/general-settings", () => ({
	buildPlanModeSettingsSnapshot: mocks.buildPlanModeSettingsSnapshot,
	readGeneralSettings: mocks.readGeneralSettings,
}));

vi.mock("../api/modules/agentsShare", () => ({
	resumeInterruptedCodingAgentRun: mocks.resumeInterruptedCodingAgentRun,
}));

vi.mock("../api/modules/codingAgent", () => ({
	decideCodingAgentPlanModeGate: mocks.decideCodingAgentPlanModeGate,
	buildCodingAgentPlanModeGatePrompt: mocks.buildCodingAgentPlanModeGatePrompt,
	buildCodingAgentPlanModeGateUserPrompt:
		mocks.buildCodingAgentPlanModeGateUserPrompt,
	findInterruptedCodingAgentRunCandidate:
		mocks.findInterruptedCodingAgentRunCandidate,
	buildCodingAgentIntakeRoutingSnapshotDigest:
		mocks.buildCodingAgentIntakeRoutingSnapshotDigest,
	loadPersistedCodingAgentPlanModeGateResult:
		mocks.loadPersistedCodingAgentPlanModeGateResult,
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getRepository: mocks.getRepository,
	listTaskMessages: mocks.listTaskMessages,
	listTaskRunsForTask: mocks.listTaskRunsForTask,
	createTaskMessage: mocks.createTaskMessage,
	updateTask: mocks.updateTask,
	getTask: mocks.getTask,
	getTaskRun: mocks.getTaskRun,
}));

vi.mock(
	"../api/modules/nightworkers/nightworkers.run-orchestration.service",
	() => ({ startTaskRun: mocks.startTaskRun }),
);

vi.mock(
	"../api/modules/nightworkers/nightworkers.workbench-message.service",
	() => ({
		appendAssistantTaskMessage: vi.fn(),
		appendTaskMessage: vi.fn(),
		appendWorkbenchMessage: vi.fn(),
		createPlanningArtifactMessageIfNeeded: vi.fn(),
		resumeWorkbenchIntakeMessage: vi.fn(),
	}),
);

vi.mock(
	"../api/modules/nightworkers/nightworkers.workbench-plan-intake.service",
	() => ({
		ensureDesignQuestionnaireReadyMessage: vi.fn(),
		startWorkbenchPlanModeIntake: mocks.startWorkbenchPlanModeIntake,
	}),
);

vi.mock(
	"../api/modules/nightworkers/nightworkers-workbench-intake-support",
	() => ({ workbenchRunStartedMessage: mocks.workbenchRunStartedMessage }),
);

import {
	buildWorkbenchPlanModeGatePrompt,
	buildWorkbenchPlanModeGateUserPrompt,
	createWorkbenchLlmDebugEventEmitter,
	decideWorkbenchPlanModeGate,
	handleWorkbenchIntakeMessage,
	isPlanModeArtifactRegenerationContext,
	prepareWorkbenchIntakeTask,
	toRecord,
} from "../api/modules/nightworkers/nightworkers.workbench.service";

const task = {
	id: "task-1",
	repositoryId: "repository-1",
	title: "Existing Task",
	objective: "Existing objective",
	acceptanceCriteria: "Existing criteria",
	status: "ready",
	revision: 4,
};

const codingGate = {
	shouldStartPlanMode: false,
	action: "coding_agent",
	runDisposition: "start_new_run",
	runtimeThreadHandoff: { threadId: "thread-1" },
};

const planGate = {
	shouldStartPlanMode: true,
	action: "plan_mode",
	runDisposition: "start_new_run",
	runtimeThreadHandoff: null,
};

const resumeCandidate = {
	runId: "interrupted-run",
	interruptionRevision: 2,
	todoId: "todo-1",
	todoRevision: 3,
};

beforeEach(() => {
	vi.resetAllMocks();
	mocks.planTargetSafeParse.mockReturnValue({ success: true });
	mocks.readGeneralSettings.mockReturnValue({ planMode: true });
	mocks.buildPlanModeSettingsSnapshot.mockReturnValue({ enabled: true });
	mocks.getRepository.mockResolvedValue({ localPath: "/repo/root" });
	mocks.listTaskMessages.mockResolvedValue([]);
	mocks.listTaskRunsForTask.mockResolvedValue([]);
	mocks.findInterruptedCodingAgentRunCandidate.mockResolvedValue(null);
	mocks.buildCodingAgentIntakeRoutingSnapshotDigest.mockReturnValue(
		"routing-digest",
	);
	mocks.loadPersistedCodingAgentPlanModeGateResult.mockResolvedValue(null);
	mocks.decideCodingAgentPlanModeGate.mockResolvedValue(codingGate);
	mocks.updateTask.mockResolvedValue({ ...task, title: "Updated Task" });
	mocks.getTask.mockResolvedValue(task);
	mocks.getTaskRun.mockResolvedValue({ id: "interrupted-run" });
	mocks.createTaskMessage.mockResolvedValue({});
	mocks.startTaskRun.mockResolvedValue({ id: "new-run" });
	mocks.startWorkbenchPlanModeIntake.mockResolvedValue({});
	mocks.resumeInterruptedCodingAgentRun.mockResolvedValue({
		runId: "interrupted-run",
	});
	mocks.workbenchRunStartedMessage.mockReturnValue("Run started");
});

describe("nightworkers workbench service extra coverage", () => {
	it("delegates plan gate helper construction without rewriting inputs", async () => {
		const gateInput = { projectRoot: "/repo", prompt: "prompt" };
		mocks.decideCodingAgentPlanModeGate.mockResolvedValueOnce({
			decided: true,
		});
		await expect(
			decideWorkbenchPlanModeGate(gateInput as never),
		).resolves.toEqual({
			decided: true,
		});
		expect(mocks.decideCodingAgentPlanModeGate).toHaveBeenCalledWith(gateInput);

		mocks.buildCodingAgentPlanModeGatePrompt.mockReturnValueOnce(
			"system prompt",
		);
		expect(buildWorkbenchPlanModeGatePrompt("/repo")).toBe("system prompt");
		mocks.buildCodingAgentPlanModeGateUserPrompt.mockReturnValueOnce(
			"user prompt",
		);
		const userInput = { prompt: "hello" };
		expect(buildWorkbenchPlanModeGateUserPrompt(userInput as never)).toBe(
			"user prompt",
		);
		expect(mocks.buildCodingAgentPlanModeGateUserPrompt).toHaveBeenCalledWith(
			userInput,
		);
	});

	it("recognizes records and only valid Plan Mode regeneration contexts", () => {
		expect(toRecord(null)).toBeNull();
		expect(toRecord("text")).toBeNull();
		expect(toRecord([])).toBeNull();
		expect(toRecord({ value: true })).toEqual({ value: true });

		expect(isPlanModeArtifactRegenerationContext(null)).toBe(false);
		expect(
			isPlanModeArtifactRegenerationContext({
				kind: "other",
				metadata: {
					instructionMode: "regenerate_artifact",
					planModeTarget: "data_model",
				},
			} as never),
		).toBe(false);
		expect(mocks.planTargetSafeParse).not.toHaveBeenCalled();
		expect(
			isPlanModeArtifactRegenerationContext({
				kind: "plan_mode_workspace",
				metadata: { instructionMode: "other" },
			} as never),
		).toBe(false);
		mocks.planTargetSafeParse.mockReturnValueOnce({ success: false });
		expect(
			isPlanModeArtifactRegenerationContext({
				kind: "plan_mode_workspace",
				metadata: {
					instructionMode: "regenerate_artifact",
					planModeTarget: "invalid",
				},
			} as never),
		).toBe(false);
		expect(
			isPlanModeArtifactRegenerationContext({
				kind: "plan_mode_workspace",
				metadata: {
					instructionMode: "regenerate_artifact",
					planModeTarget: "data_model",
				},
			} as never),
		).toBe(true);
	});

	it("emits only non-empty model deltas using data text or message fallback", async () => {
		const emit = createWorkbenchLlmDebugEventEmitter(task.id);
		await emit({ type: "model.request", message: "ignored" } as never);
		await emit({ type: "model.response_delta", message: "" } as never);
		await emit({
			type: "model.response_delta",
			message: "fallback text",
			data: { text: 123 },
		} as never);
		await emit({
			type: "model.response_delta",
			message: "ignored fallback",
			data: { text: "delta text" },
		} as never);
		expect(mocks.publish).toHaveBeenCalledTimes(2);
		expect(mocks.publish).toHaveBeenNthCalledWith(
			1,
			task.id,
			expect.objectContaining({
				type: "task_llm_delta",
				payload: expect.objectContaining({ text: "fallback text" }),
			}),
		);
		expect(mocks.publish).toHaveBeenNthCalledWith(
			2,
			task.id,
			expect.objectContaining({
				payload: expect.objectContaining({ text: "delta text" }),
			}),
		);
	});

	it("queues non-stream lifecycle activity without blocking the provider request", async () => {
		const emit = createWorkbenchLlmDebugEventEmitter(task.id);
		await emit({
			type: "model.request_started",
			severity: "info",
			message: "request started",
			data: {
				requestId: "request-1",
				role: "evaluation",
			},
		});

		expect(mocks.enqueueActivityEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: task.id,
				kind: "llm.request",
				status: "started",
				payloadJson: expect.objectContaining({
					eventType: "model.request_started",
					requestId: "request-1",
				}),
			}),
		);
	});

	it("renders full artifact context and uses the decided non-run update path", async () => {
		const artifactContext = {
			title: "Todo Blueprint",
			kind: "app_blueprint",
			summary: "Blueprint summary",
			source: {
				type: "message",
				messageId: "message-1",
				artifactId: "artifact-1",
			},
			metadata: {
				intent: "app_blueprint",
				artifactType: "blueprint",
				appBlueprintName: "Todo App",
				initialTab: "preview",
				instructionMode: "edit",
				planModeTarget: "blueprint",
				screenNames: ["List", "Detail"],
				sectionNames: ["Header"],
				tableNames: ["todos"],
			},
		};
		await handleWorkbenchIntakeMessage(task.id, task as never, "change this", {
			failureMode: "throw",
			intent: "draft",
			artifactContext: artifactContext as never,
			llmRouteOverride: { model: "model-1" } as never,
		});
		const decisionInput =
			mocks.decideCodingAgentPlanModeGate.mock.calls[0]?.[0];
		expect(decisionInput).toMatchObject({
			projectRoot: "/repo/root",
			task,
			routeOverride: { model: "model-1" },
			routingSnapshotDigest: "routing-digest",
		});
		expect(decisionInput.prompt).toContain("Artifact: Todo Blueprint");
		expect(decisionInput.prompt).toContain(
			"Source: sourceType=message, messageId=message-1, artifactId=artifact-1",
		);
		expect(decisionInput.prompt).toContain("Screens: List, Detail");
		expect(decisionInput.prompt).toContain("Tables: todos");
		expect(mocks.updateTask).toHaveBeenCalledWith(task.id, {
			title: task.title,
			objective: task.objective,
			acceptanceCriteria: task.acceptanceCriteria,
			status: task.status,
		});
		expect(mocks.startTaskRun).not.toHaveBeenCalled();
	});

	it("uses persisted gate results and process cwd fallback", async () => {
		mocks.getRepository.mockResolvedValueOnce(null);
		mocks.loadPersistedCodingAgentPlanModeGateResult.mockResolvedValueOnce({
			...codingGate,
			action: "noop",
		});
		await handleWorkbenchIntakeMessage(task.id, task as never, "draft", {
			failureMode: "throw",
			intent: "draft",
		});
		expect(mocks.decideCodingAgentPlanModeGate).not.toHaveBeenCalled();
		expect(mocks.updateTask).toHaveBeenCalled();
	});

	it("blocks queued Plan Mode and Coding Agent Run starts with distinct messages", async () => {
		const queuedTask = { ...task, status: "queued" };
		mocks.decideCodingAgentPlanModeGate.mockResolvedValueOnce(planGate);
		await expect(
			handleWorkbenchIntakeMessage(task.id, queuedTask as never, "plan", {
				failureMode: "throw",
				intent: "draft",
			}),
		).resolves.toMatchObject({ task: queuedTask, run: null });
		expect(mocks.createTaskMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({
				content: expect.stringContaining("Plan Mode Run"),
				payloadJson: expect.objectContaining({
					intent: "plan_mode_run_blocked",
				}),
			}),
		);

		mocks.decideCodingAgentPlanModeGate.mockResolvedValueOnce(codingGate);
		await handleWorkbenchIntakeMessage(task.id, queuedTask as never, "code", {
			failureMode: "throw",
			intent: "intake",
		});
		expect(mocks.createTaskMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({
				content: expect.stringContaining("Coding Agent Run"),
				payloadJson: expect.objectContaining({
					intent: "coding_agent_run_blocked",
				}),
			}),
		);
		expect(mocks.startTaskRun).not.toHaveBeenCalled();
	});

	it("starts Plan Mode with title and objective fallbacks", async () => {
		const newTask = {
			...task,
			title: "New Session",
			objective: "",
			acceptanceCriteria: "",
		};
		mocks.decideCodingAgentPlanModeGate.mockResolvedValueOnce({
			...planGate,
			shouldStartPlanMode: false,
		});
		mocks.getTask.mockResolvedValueOnce(null);
		const result = await handleWorkbenchIntakeMessage(
			task.id,
			newTask as never,
			"  Plan   a new feature with a deliberately long prompt that exceeds sixty characters total  ",
			{
				failureMode: "throw",
				intent: "draft",
			},
		);
		expect(mocks.updateTask).toHaveBeenCalledWith(
			task.id,
			expect.objectContaining({
				title: " Plan a new feature with a deliberately long prompt that exc",
				objective: expect.stringContaining("Plan   a new feature"),
				acceptanceCriteria: expect.stringContaining("Plan   a new feature"),
				status: "ready",
			}),
		);
		expect(mocks.startWorkbenchPlanModeIntake).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: expect.stringContaining("Plan   a new feature"),
				planModeSettingsSnapshot: { enabled: true },
				routeOverride: null,
			}),
		);
		expect(result.task).toEqual({ ...task, title: "Updated Task" });
	});

	it("resumes an interrupted Run and records its structural revision", async () => {
		mocks.findInterruptedCodingAgentRunCandidate.mockResolvedValueOnce(
			resumeCandidate,
		);
		mocks.decideCodingAgentPlanModeGate.mockResolvedValueOnce({
			...codingGate,
			runDisposition: "resume_existing_run",
		});
		mocks.getTask.mockResolvedValueOnce(null);
		const result = await handleWorkbenchIntakeMessage(
			task.id,
			task as never,
			"resume with context",
			{ failureMode: "throw" },
		);
		expect(mocks.resumeInterruptedCodingAgentRun).toHaveBeenCalledWith({
			runId: resumeCandidate.runId,
			expectedInterruptionRevision: 2,
			todoId: "todo-1",
			expectedTodoRevision: 3,
			routingSnapshotDigest: "routing-digest",
			userContext: "resume with context",
			requestProvenance: {
				requestedBy: { kind: "human", actorId: "workbench" },
				orchestrationRef: null,
			},
		});
		expect(mocks.createTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "interrupted-run",
				payloadJson: expect.objectContaining({
					intent: "run_resumed",
					interruptionRevision: 2,
				}),
			}),
		);
		expect(result.task).toBe(task);
	});

	it("rejects invalid resume decisions and disappearing resumed Runs", async () => {
		mocks.decideCodingAgentPlanModeGate.mockResolvedValueOnce({
			...codingGate,
			runDisposition: "resume_existing_run",
		});
		await expect(
			handleWorkbenchIntakeMessage(task.id, task as never, "resume", {
				failureMode: "throw",
			}),
		).rejects.toMatchObject({ code: "RUN_RESUME_CANDIDATE_REQUIRED" });

		mocks.findInterruptedCodingAgentRunCandidate.mockResolvedValueOnce(
			resumeCandidate,
		);
		mocks.decideCodingAgentPlanModeGate.mockResolvedValueOnce({
			...codingGate,
			runDisposition: "resume_existing_run",
		});
		mocks.getTaskRun.mockResolvedValueOnce(null);
		await expect(
			handleWorkbenchIntakeMessage(task.id, task as never, "resume", {
				failureMode: "throw",
			}),
		).rejects.toMatchObject({ code: "LLM_RESPONSE_REQUIRED", statusCode: 502 });

		mocks.findInterruptedCodingAgentRunCandidate.mockResolvedValueOnce(
			resumeCandidate,
		);
		mocks.decideCodingAgentPlanModeGate.mockResolvedValueOnce(codingGate);
		await expect(
			handleWorkbenchIntakeMessage(task.id, task as never, "new", {
				failureMode: "throw",
			}),
		).rejects.toMatchObject({
			code: "INTERRUPTED_RUN_REQUIRES_EXPLICIT_RESOLUTION",
		});
	});

	it("starts a new implementation Run with handoff and runnable fallbacks", async () => {
		const newTask = {
			...task,
			title: "New Session",
			objective: "",
			acceptanceCriteria: "",
		};
		mocks.getTask.mockResolvedValueOnce(null);
		const result = await handleWorkbenchIntakeMessage(
			task.id,
			newTask as never,
			"Implement this feature",
			{ failureMode: "throw", llmRouteOverride: null },
		);
		expect(mocks.updateTask).toHaveBeenCalledWith(task.id, {
			title: "Implement this feature",
			objective: "Implement this feature",
			acceptanceCriteria: "Implement this feature",
		});
		expect(mocks.startTaskRun).toHaveBeenCalledWith(task.id, {
			executionModeSource: "workbench_intake",
			planModeRequested: false,
			intakeRuntimeThreadHandoff: { threadId: "thread-1" },
			routeOverride: null,
		});
		expect(mocks.workbenchRunStartedMessage).toHaveBeenCalledWith(
			"implementation",
		);
		expect(result.task).toEqual({ ...task, title: "Updated Task" });
	});

	it("records primitive failures or wraps ordinary Errors while preserving AppErrors", async () => {
		mocks.decideCodingAgentPlanModeGate.mockRejectedValueOnce(
			"provider offline",
		);
		mocks.getTask.mockResolvedValueOnce(null);
		await expect(
			handleWorkbenchIntakeMessage(task.id, task as never, "record", {
				failureMode: "record",
			}),
		).resolves.toMatchObject({ task, run: null });
		expect(mocks.createTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				content: "LLM intake failed: provider offline",
				payloadJson: expect.objectContaining({ intent: "intake_failed" }),
			}),
		);

		mocks.decideCodingAgentPlanModeGate.mockRejectedValueOnce(
			new Error("provider failed"),
		);
		await expect(
			handleWorkbenchIntakeMessage(task.id, task as never, "throw", {
				failureMode: "throw",
			}),
		).rejects.toMatchObject({
			statusCode: 502,
			code: "LLM_RESPONSE_REQUIRED",
			message: expect.stringContaining("provider failed"),
			details: { task },
		});
	});

	it("prepares intake titles and objective while preserving existing values", async () => {
		const newTask = { ...task, title: "New Session", objective: "" };
		await prepareWorkbenchIntakeTask(
			task.id,
			newTask as never,
			"  A   new task prompt  ",
		);
		expect(mocks.updateTask).toHaveBeenCalledWith(task.id, {
			title: " A new task prompt ",
			objective: "  A   new task prompt  ",
		});
		await prepareWorkbenchIntakeTask(task.id, task as never, "ignored prompt");
		expect(mocks.updateTask).toHaveBeenLastCalledWith(task.id, {
			title: task.title,
			objective: task.objective,
		});
	});
});
