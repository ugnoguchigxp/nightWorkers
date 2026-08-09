import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { launchRuntimeExecution } from "../api/modules/nightworkers/run-orchestration/runtime-execution";

const mocks = vi.hoisted(() => {
	const runtimeStart = vi.fn();
	const runE2e = vi.fn();
	const release = vi.fn(async () => undefined);
	const leaseHeartbeat = vi.fn(async () => undefined);
	const updateTaskStatus = vi.fn(async () => undefined);
	const listTodos = vi.fn();
	const refreshQueueLease = vi.fn(async () => undefined);
	const heartbeatRun = vi.fn(async () => undefined);
	const getTaskRun = vi.fn();
	const createRunEvent = vi.fn(async () => undefined);
	const updateRunWithoutPublish = vi.fn();
	const updateRun = vi.fn();
	const createTaskMessage = vi.fn(async () => ({ id: "message-1" }));
	const publishRunUpdate = vi.fn(async () => undefined);
	const handleFailure = vi.fn(async () => undefined);
	const completeQueue = vi.fn(async () => undefined);
	const continueQueue = vi.fn(() => false);
	const runQueue = vi.fn(async () => undefined);
	const refreshConversation = vi.fn(async () => undefined);
	const updateCommitEvidence = vi.fn(async () => undefined);
	const createBoundaryAudit = vi.fn(async () => null);
	const createPlanningMessage = vi.fn(async () => undefined);
	const recordPreserved = vi.fn(async () => undefined);
	const projectParent = vi.fn(async () => ({
		handled: false,
		status: "ready",
	}));
	const publishTerminal = vi.fn(async () => ({
		failures: [],
		listenerCount: 1,
	}));
	const continueAfter = vi.fn(async () => []);
	const loggerError = vi.fn();
	const assertTransition = vi.fn();
	const normalizeWarnings = vi.fn((warnings) => warnings ?? []);
	const summarizeWarnings = vi.fn((warnings) => ({ count: warnings.length }));
	const mergeSnapshot = vi.fn((snapshot, warnings, metadata) => ({
		...(snapshot && typeof snapshot === "object" ? snapshot : {}),
		warnings,
		metadata,
	}));
	const outcome = vi.fn((result) => ({
		status: result.terminalState,
		summary: `Outcome ${result.terminalState}`,
	}));
	const resolveOutcomeGuard = vi.fn((input) => ({
		status: input.todoFinalizationBlocked ? "blocked" : input.outcomeStatus,
		externallyHeldStatus: null,
		summary: input.todoFinalizationBlocked ? "Open Todos remain" : null,
	}));
	const terminal = vi.fn((status) =>
		[
			"blocked",
			"cancelled",
			"completed",
			"failed",
			"needs_human",
			"needs_review",
			"timed_out",
		].includes(status),
	);
	const resolveCancelStatus = vi.fn(() => "cancelled");
	const incompleteTodos = vi.fn((todos) =>
		todos.filter((todo) =>
			["pending", "running", "needs_human"].includes(todo.status),
		),
	);
	const toTodo = vi.fn((todo) => ({
		id: todo.id,
		seq: todo.seq,
		title: todo.title,
	}));
	const prepareCodex = vi.fn(async (input) => ({
		...input.contextSnapshot,
		prepared: true,
	}));
	const interactive = vi.fn((snapshot) => snapshot.interactiveReview === true);
	const fixtureToolTurns = vi.fn(() => false);
	const interruption = vi.fn(() => null);
	const planModeRequested = vi.fn(() => false);
	const projectTaskStatus = vi.fn(() => "ready");
	const systemContext = vi.fn(() => ({ role: "coding-agent" }));
	const taskGoal = vi.fn(() => ({ objective: "Implement" }));
	const openTodoWarning = vi.fn(() => ({
		code: "codex_open_todos_before_completion",
	}));
	const pauseSnapshot = vi.fn(() => null);
	const ledgerSink = { emit: vi.fn() };

	return {
		runtimeStart,
		runE2e,
		release,
		leaseHeartbeat,
		updateTaskStatus,
		listTodos,
		refreshQueueLease,
		heartbeatRun,
		getTaskRun,
		createRunEvent,
		updateRunWithoutPublish,
		updateRun,
		createTaskMessage,
		publishRunUpdate,
		handleFailure,
		completeQueue,
		continueQueue,
		runQueue,
		refreshConversation,
		updateCommitEvidence,
		createBoundaryAudit,
		createPlanningMessage,
		recordPreserved,
		projectParent,
		publishTerminal,
		continueAfter,
		loggerError,
		assertTransition,
		normalizeWarnings,
		summarizeWarnings,
		mergeSnapshot,
		outcome,
		resolveOutcomeGuard,
		terminal,
		resolveCancelStatus,
		incompleteTodos,
		toTodo,
		prepareCodex,
		interactive,
		fixtureToolTurns,
		interruption,
		planModeRequested,
		projectTaskStatus,
		systemContext,
		taskGoal,
		openTodoWarning,
		pauseSnapshot,
		ledgerSink,
	};
});

vi.mock("../api/lib/logger", () => ({
	logger: { error: mocks.loggerError },
}));
vi.mock("../api/services/structured-llm/fixture-tool-provider", () => ({
	hasFixtureProviderToolTurns: mocks.fixtureToolTurns,
}));
vi.mock("../api/modules/agentsShare", () => ({
	continueAfterTaskRun: mocks.continueAfter,
	projectTaskRunParentStatus: mocks.projectParent,
	publishTaskRunTerminal: mocks.publishTerminal,
}));
vi.mock("../api/modules/codingAgent", () => ({
	buildCodingAgentTaskGoal: mocks.taskGoal,
	buildOpenTodoRuntimeContractWarning: mocks.openTodoWarning,
	createLedgerSink: vi.fn(() => mocks.ledgerSink),
	mergeRuntimeContractSnapshot: mocks.mergeSnapshot,
	normalizeRuntimeContractWarnings: mocks.normalizeWarnings,
	outcomeFromRuntimeResult: mocks.outcome,
	prepareCodexRepositoryRuntimeContext: mocks.prepareCodex,
	projectCodingAgentTaskStatusAfterRun: mocks.projectTaskStatus,
	readCodingAgentPlanModeRequested: mocks.planModeRequested,
	readProcessInterruptionSnapshot: mocks.interruption,
	runE2eFixtureRuntime: mocks.runE2e,
	summarizeRuntimeContractWarnings: mocks.summarizeWarnings,
}));
vi.mock("../api/modules/review/review-runtime-profile", () => ({
	isInteractiveReviewRuntimeSnapshot: mocks.interactive,
}));
vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	updateTaskStatus: mocks.updateTaskStatus,
	listTaskRunTodosForRun: mocks.listTodos,
	refreshImplementationQueueLeaseForRun: mocks.refreshQueueLease,
	heartbeatActiveTaskRun: mocks.heartbeatRun,
	getTaskRun: mocks.getTaskRun,
	createRunEvent: mocks.createRunEvent,
	updateTaskRunIfStatusWithoutPublish: mocks.updateRunWithoutPublish,
	updateTaskRunIfStatus: mocks.updateRun,
	createTaskMessage: mocks.createTaskMessage,
	publishTaskRunUpdate: mocks.publishRunUpdate,
}));
vi.mock("../api/modules/nightworkers/nightworkers.workbench.service", () => ({
	createPlanningArtifactMessageIfNeeded: mocks.createPlanningMessage,
}));
vi.mock("../api/modules/nightworkers/run-orchestration/git-ownership", () => ({
	updateCommitOwnershipEvidence: mocks.updateCommitEvidence,
}));
vi.mock("../api/modules/nightworkers/run-orchestration/queues", () => ({
	completeImplementationQueueEntryForRun: mocks.completeQueue,
	IMPLEMENTATION_QUEUE_LEASE_TTL_MS: 60_000,
	runSessionQueueForRepository: mocks.runQueue,
	shouldContinueSessionQueue: mocks.continueQueue,
}));
vi.mock(
	"../api/modules/nightworkers/run-orchestration/run-system-context",
	() => ({
		buildRunCodingAgentSystemContext: mocks.systemContext,
	}),
);
vi.mock(
	"../api/modules/nightworkers/run-orchestration/runtime-conversation-closeout",
	() => ({
		refreshConversationContextForRuntimeLane: mocks.refreshConversation,
	}),
);
vi.mock(
	"../api/modules/nightworkers/run-orchestration/runtime-execution-failure",
	() => ({ handleRuntimeExecutionFailure: mocks.handleFailure }),
);
vi.mock(
	"../api/modules/nightworkers/run-orchestration/runtime-execution-lease",
	() => ({
		acquireRuntimeExecutionLease: vi.fn(async () => ({
			heartbeat: mocks.leaseHeartbeat,
			release: mocks.release,
		})),
	}),
);
vi.mock(
	"../api/modules/nightworkers/run-orchestration/runtime-heartbeat",
	() => ({
		ACTIVE_RUN_HEARTBEAT_INTERVAL_MS: 60_000,
	}),
);
vi.mock(
	"../api/modules/nightworkers/run-orchestration/runtime-ontology-closeout",
	() => ({ createRuntimeOntologyBoundaryAudit: mocks.createBoundaryAudit }),
);
vi.mock(
	"../api/modules/nightworkers/run-orchestration/runtime-outcome-guard",
	() => ({
		buildRuntimePauseSnapshot: mocks.pauseSnapshot,
		isRuntimeTerminalStatus: mocks.terminal,
		recordPreservedNeedsHumanOutcome: mocks.recordPreserved,
		resolveRuntimeOutcomeGuard: mocks.resolveOutcomeGuard,
	}),
);
vi.mock("../api/modules/nightworkers/run-orchestration/status", () => ({
	assertRunStatusTransition: mocks.assertTransition,
	resolveGuardedRunOutcomeStatus: mocks.resolveCancelStatus,
	runStatusTransitionTable: {
		running: ["finalizing"],
		finalizing: ["completed", "blocked", "failed", "needs_human", "timed_out"],
		needs_human: [],
	},
}));
vi.mock("../api/modules/nightworkers/run-orchestration/todo-closeout", () => ({
	listIncompleteTodos: mocks.incompleteTodos,
	toAgentRuntimeTodoContext: mocks.toTodo,
}));

const originalE2e = process.env.NIGHTWORKERS_E2E;
const originalE2eFixture = process.env.NIGHTWORKERS_E2E_RUNTIME_FIXTURE;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.publishTerminal.mockReset();
	mocks.createRunEvent.mockReset();
	delete process.env.NIGHTWORKERS_E2E;
	delete process.env.NIGHTWORKERS_E2E_RUNTIME_FIXTURE;
	mocks.runtimeStart.mockResolvedValue(runtimeResult());
	mocks.runE2e.mockResolvedValue(runtimeResult());
	mocks.listTodos.mockResolvedValue([]);
	mocks.getTaskRun.mockResolvedValue({
		id: "run-1",
		status: "running",
		contextSnapshot: { executionMode: "implementation", latest: true },
	});
	mocks.updateRun.mockResolvedValue({ id: "run-1", status: "finalizing" });
	mocks.updateRunWithoutPublish.mockResolvedValue({
		id: "run-1",
		status: "completed",
	});
	mocks.createRunEvent.mockResolvedValue(undefined);
	mocks.handleFailure.mockResolvedValue(undefined);
	mocks.completeQueue.mockResolvedValue(undefined);
	mocks.continueQueue.mockReturnValue(false);
	mocks.refreshConversation.mockResolvedValue(undefined);
	mocks.createBoundaryAudit.mockResolvedValue(null);
	mocks.projectParent.mockResolvedValue({ handled: false, status: "ready" });
	mocks.publishTerminal.mockResolvedValue({ failures: [], listenerCount: 1 });
	mocks.continueAfter.mockResolvedValue([]);
	mocks.resolveCancelStatus.mockReturnValue("cancelled");
	mocks.resolveOutcomeGuard.mockImplementation((input) => ({
		status: input.todoFinalizationBlocked ? "blocked" : input.outcomeStatus,
		externallyHeldStatus: null,
		summary: input.todoFinalizationBlocked ? "Open Todos remain" : null,
	}));
	mocks.terminal.mockImplementation((status) =>
		[
			"blocked",
			"cancelled",
			"completed",
			"failed",
			"needs_human",
			"needs_review",
			"timed_out",
		].includes(status),
	);
	mocks.outcome.mockImplementation((result) => ({
		status: result.terminalState,
		summary: `Outcome ${result.terminalState}`,
	}));
	mocks.normalizeWarnings.mockImplementation((warnings) => warnings ?? []);
	mocks.summarizeWarnings.mockImplementation((warnings) => ({
		count: warnings.length,
	}));
	mocks.incompleteTodos.mockImplementation((todos) =>
		todos.filter((todo) =>
			["pending", "running", "needs_human"].includes(todo.status),
		),
	);
	mocks.interactive.mockImplementation(
		(snapshot) => snapshot.interactiveReview === true,
	);
	mocks.fixtureToolTurns.mockReturnValue(false);
	mocks.interruption.mockReturnValue(null);
	mocks.projectTaskStatus.mockReturnValue("ready");
	mocks.pauseSnapshot.mockReturnValue(null);
});

afterEach(() => {
	if (originalE2e === undefined) delete process.env.NIGHTWORKERS_E2E;
	else process.env.NIGHTWORKERS_E2E = originalE2e;
	if (originalE2eFixture === undefined) {
		delete process.env.NIGHTWORKERS_E2E_RUNTIME_FIXTURE;
	} else {
		process.env.NIGHTWORKERS_E2E_RUNTIME_FIXTURE = originalE2eFixture;
	}
});

describe("runtime startup and lane selection", () => {
	it("heartbeats the queue, run, and execution lease while runtime remains active", async () => {
		vi.useFakeTimers();
		let resolveRuntime:
			| ((result: ReturnType<typeof runtimeResult>) => void)
			| undefined;
		mocks.runtimeStart.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveRuntime = resolve;
				}),
		);
		try {
			await launchRuntimeExecution(input() as never);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(mocks.refreshQueueLease.mock.calls.length).toBeGreaterThanOrEqual(
				2,
			);
			expect(mocks.heartbeatRun.mock.calls.length).toBeGreaterThanOrEqual(2);
			expect(mocks.leaseHeartbeat.mock.calls.length).toBeGreaterThanOrEqual(2);
			resolveRuntime?.(runtimeResult());
			await vi.runAllTicks();
		} finally {
			vi.useRealTimers();
		}
		await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledTimes(1));
	});

	it("runs a native adapter with Todo context and default optional values", async () => {
		const todos = [todo("pending", 3), todo("running", 2), todo("running", 1)];
		mocks.listTodos.mockResolvedValueOnce(todos).mockResolvedValueOnce([]);
		await execute(input());
		expect(mocks.runtimeStart).toHaveBeenCalledWith(
			expect.objectContaining({
				timeoutSeconds: 3600,
				safetyPolicy: undefined,
				contextSnapshot: expect.objectContaining({ interactiveReview: false }),
				todoPlan: todos.map((item) => expect.objectContaining({ id: item.id })),
				currentTodo: expect.objectContaining({ seq: 1 }),
				codingAgentSystemContext: { role: "coding-agent" },
			}),
			mocks.ledgerSink,
		);
		expect(mocks.updateTaskStatus).toHaveBeenCalledWith("task-1", "running");
		expect(mocks.refreshQueueLease).toHaveBeenCalled();
		expect(mocks.leaseHeartbeat).toHaveBeenCalled();
		expect(mocks.updateCommitEvidence).toHaveBeenCalled();
		expect(mocks.release).toHaveBeenCalledTimes(1);
	});

	it("prepares Codex repository context and passes explicit runtime options", async () => {
		const launchInput = input({
			lane: "codex-sdk",
			timeoutSeconds: 45,
			safetyPolicy: { allowedPaths: ["src/**"] },
			agentModeSessionId: "session-1",
		});
		await execute(launchInput);
		expect(mocks.prepareCodex).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "run-1",
				repositoryRoot: "/repo",
			}),
		);
		expect(mocks.runtimeStart).toHaveBeenCalledWith(
			expect.objectContaining({
				timeoutSeconds: 45,
				safetyPolicy: { allowedPaths: ["src/**"] },
				agentModeSessionId: "session-1",
				contextSnapshot: expect.objectContaining({ prepared: true }),
			}),
			mocks.ledgerSink,
		);
	});

	it("runs interactive review without implementation-only context or closeout refresh", async () => {
		await execute(input({ lane: "codex-sdk", interactiveReview: true }));
		expect(mocks.prepareCodex).not.toHaveBeenCalled();
		expect(mocks.systemContext).not.toHaveBeenCalled();
		expect(mocks.runtimeStart.mock.calls[0][0]).not.toHaveProperty("todoPlan");
		expect(mocks.runtimeStart.mock.calls[0][0]).not.toHaveProperty(
			"currentTodo",
		);
		expect(mocks.createBoundaryAudit).toHaveBeenCalledWith(
			expect.objectContaining({ skip: true }),
		);
		expect(mocks.refreshConversation).not.toHaveBeenCalled();
	});

	it("uses the E2E fixture runtime when both fixture switches are enabled", async () => {
		process.env.NIGHTWORKERS_E2E = "1";
		process.env.NIGHTWORKERS_E2E_RUNTIME_FIXTURE = "1";
		await execute(input());
		expect(mocks.runE2e).toHaveBeenCalledWith(
			expect.objectContaining({ todoPlan: [] }),
			mocks.ledgerSink,
		);
		expect(mocks.runtimeStart).not.toHaveBeenCalled();
	});

	it("prefers the configured provider runtime when fixture tool turns exist", async () => {
		process.env.NIGHTWORKERS_E2E = "1";
		process.env.NIGHTWORKERS_E2E_RUNTIME_FIXTURE = "1";
		mocks.fixtureToolTurns.mockReturnValueOnce(true);
		await execute(input());
		expect(mocks.runE2e).not.toHaveBeenCalled();
		expect(mocks.runtimeStart).toHaveBeenCalled();
	});
});

describe("interruption and cancellation", () => {
	it("stops finalization for a persisted process interruption", async () => {
		mocks.interruption.mockReturnValueOnce({ reason: "process_restart" });
		await execute(input());
		expect(mocks.createRunEvent).not.toHaveBeenCalled();
		expect(mocks.updateCommitEvidence).not.toHaveBeenCalled();
		expect(mocks.release).toHaveBeenCalled();
	});

	it("cancels from the runtime terminal state and emits the fallback report", async () => {
		mocks.runtimeStart.mockResolvedValueOnce(
			runtimeResult({
				terminalState: "cancelled",
				finalReport: "",
				summary: "",
			}),
		);
		mocks.updateRunWithoutPublish.mockResolvedValueOnce({
			id: "run-1",
			status: "cancelled",
		});
		await execute(input());
		expect(mocks.assertTransition).toHaveBeenCalledWith("running", "cancelled");
		expect(mocks.completeQueue).toHaveBeenCalledWith("run-1", "cancelled");
		expect(mocks.updateTaskStatus).toHaveBeenLastCalledWith("task-1", "ready");
		expect(mocks.createTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				content: "Outcome cancelled",
				payloadJson: expect.objectContaining({
					summary: "Outcome cancelled",
					status: "cancelled",
				}),
			}),
		);
		expect(mocks.refreshConversation).toHaveBeenCalled();
	});

	it("honors an already-cancelled persisted run", async () => {
		mocks.getTaskRun.mockResolvedValueOnce({
			status: "cancelled",
			contextSnapshot: null,
		});
		mocks.updateRunWithoutPublish.mockResolvedValueOnce({
			status: "cancelled",
		});
		await execute(input());
		expect(mocks.assertTransition).toHaveBeenCalledWith(
			"cancelled",
			"cancelled",
		);
	});

	it("stops when guarded cancellation preserves another status", async () => {
		mocks.runtimeStart.mockResolvedValueOnce(
			runtimeResult({ terminalState: "cancelled" }),
		);
		mocks.resolveCancelStatus.mockReturnValueOnce("needs_human");
		await execute(input());
		expect(mocks.updateRunWithoutPublish).not.toHaveBeenCalled();
		expect(mocks.completeQueue).not.toHaveBeenCalled();
	});

	it("stops when cancellation loses its compare-and-swap race", async () => {
		mocks.runtimeStart.mockResolvedValueOnce(
			runtimeResult({ terminalState: "cancelled" }),
		);
		mocks.updateRunWithoutPublish.mockResolvedValueOnce(null);
		await execute(input());
		expect(mocks.completeQueue).not.toHaveBeenCalled();
		expect(mocks.publishRunUpdate).not.toHaveBeenCalled();
	});
});

describe("final outcome transitions", () => {
	it("blocks native completion while Todos remain open", async () => {
		const open = todo("pending", 1);
		mocks.listTodos.mockResolvedValueOnce([]).mockResolvedValueOnce([open]);
		mocks.updateRunWithoutPublish.mockResolvedValueOnce({ status: "blocked" });
		await execute(input());
		expect(mocks.openTodoWarning).toHaveBeenCalledWith([open]);
		expect(mocks.createRunEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "run.outcome_decided",
				severity: "warning",
				data: expect.objectContaining({ nextStatus: "blocked" }),
			}),
		);
		expect(mocks.updateRunWithoutPublish).toHaveBeenCalledWith(
			"run-1",
			"finalizing",
			expect.objectContaining({
				status: "blocked",
				summary: "Open Todos remain",
			}),
		);
	});

	it("allows Codex completion even if its Todo list is still open", async () => {
		mocks.listTodos
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([todo("pending", 1)]);
		await execute(input({ lane: "codex-sdk" }));
		expect(mocks.openTodoWarning).not.toHaveBeenCalled();
		expect(mocks.updateRunWithoutPublish).toHaveBeenCalledWith(
			"run-1",
			"finalizing",
			expect.objectContaining({ status: "completed" }),
		);
	});

	it("preserves an externally held terminal status", async () => {
		mocks.getTaskRun.mockResolvedValueOnce({
			status: "needs_human",
			contextSnapshot: { executionMode: "implementation" },
		});
		mocks.resolveOutcomeGuard.mockReturnValueOnce({
			status: "needs_human",
			externallyHeldStatus: "needs_human",
			summary: "Preserved",
		});
		mocks.updateRunWithoutPublish.mockResolvedValueOnce({
			status: "needs_human",
		});
		await execute(input());
		expect(mocks.recordPreserved).toHaveBeenCalledWith(
			expect.objectContaining({
				previousStatus: "needs_human",
				nextStatus: "needs_human",
			}),
		);
	});

	it("returns when the outcome guard resolves a non-terminal status", async () => {
		mocks.resolveOutcomeGuard.mockReturnValueOnce({
			status: "running",
			externallyHeldStatus: null,
			summary: null,
		});
		await execute(input());
		expect(mocks.createPlanningMessage).not.toHaveBeenCalled();
		expect(mocks.updateRunWithoutPublish).not.toHaveBeenCalled();
	});

	it("captures results without re-entering an already-finalizing run", async () => {
		mocks.getTaskRun.mockResolvedValueOnce({
			status: "finalizing",
			contextSnapshot: { executionMode: "review" },
		});
		await execute(input());
		expect(mocks.updateRun).toHaveBeenCalledWith(
			"run-1",
			"finalizing",
			expect.not.objectContaining({ status: "finalizing" }),
		);
		expect(mocks.updateTaskStatus).not.toHaveBeenCalledWith(
			"task-1",
			"finalizing",
		);
	});

	it("recovers current status when entering finalizing loses a race", async () => {
		mocks.updateRun.mockResolvedValueOnce(null);
		mocks.getTaskRun
			.mockResolvedValueOnce({ status: "running", contextSnapshot: {} })
			.mockResolvedValueOnce({ status: "finalizing" });
		await execute(input());
		expect(mocks.updateRunWithoutPublish).toHaveBeenCalledWith(
			"run-1",
			"finalizing",
			expect.any(Object),
		);
	});

	it("keeps the old status when the finalizing-race reload also disappears", async () => {
		mocks.updateRun.mockResolvedValueOnce(null);
		mocks.getTaskRun
			.mockResolvedValueOnce({ status: "running", contextSnapshot: {} })
			.mockResolvedValueOnce(null);
		await execute(input());
		expect(mocks.updateRunWithoutPublish).toHaveBeenCalledWith(
			"run-1",
			"running",
			expect.any(Object),
		);
	});

	it("captures a status that cannot transition to finalizing", async () => {
		mocks.getTaskRun.mockResolvedValueOnce({
			status: "unknown",
			contextSnapshot: {},
		});
		mocks.resolveOutcomeGuard.mockReturnValueOnce({
			status: "completed",
			externallyHeldStatus: null,
			summary: null,
		});
		await execute(input());
		expect(mocks.updateRun).toHaveBeenCalledWith(
			"run-1",
			"unknown",
			expect.not.objectContaining({ status: "finalizing" }),
		);
	});
});

describe("concurrent finalization and closeout", () => {
	it("preserves a concurrent terminal status without republishing terminal", async () => {
		mocks.updateRunWithoutPublish.mockResolvedValueOnce(null);
		mocks.getTaskRun
			.mockResolvedValueOnce({ status: "running", contextSnapshot: {} })
			.mockResolvedValueOnce({ id: "run-1", status: "needs_human" });
		await execute(input());
		expect(mocks.createRunEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "run.outcome_decided",
				message: expect.stringContaining("concurrently changed"),
			}),
		);
		expect(mocks.publishTerminal).not.toHaveBeenCalled();
		expect(mocks.completeQueue).toHaveBeenCalledWith("run-1", "needs_human");
	});

	it("returns when a concurrent final status is non-terminal", async () => {
		mocks.updateRunWithoutPublish.mockResolvedValueOnce(null);
		mocks.getTaskRun
			.mockResolvedValueOnce({ status: "running", contextSnapshot: {} })
			.mockResolvedValueOnce({ id: "run-1", status: "finalizing" });
		await execute(input());
		expect(mocks.completeQueue).not.toHaveBeenCalled();
	});

	it("reports a disappeared run through the failure handler", async () => {
		mocks.updateRunWithoutPublish.mockResolvedValueOnce(null);
		mocks.getTaskRun
			.mockResolvedValueOnce({ status: "running", contextSnapshot: {} })
			.mockResolvedValueOnce(null);
		await execute(input());
		expect(mocks.handleFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.objectContaining({
					message: "Task run disappeared during runtime finalization.",
				}),
			}),
		);
	});

	it("uses parent projection fallback and skips direct task update when handled", async () => {
		mocks.projectTaskStatus.mockReturnValueOnce(null);
		mocks.projectParent.mockResolvedValueOnce({
			handled: true,
			status: "paused",
		});
		await execute(input());
		expect(mocks.updateTaskStatus).not.toHaveBeenCalledWith("task-1", "paused");
	});

	it("logs terminal listener and closeout subscriber failures and continues queue", async () => {
		mocks.publishTerminal.mockResolvedValueOnce({
			failures: [new Error("listener failed")],
			listenerCount: 2,
		});
		mocks.createRunEvent.mockImplementation(async (event) => {
			if (event.type === "system.warning") {
				throw new Error("warning persist failed");
			}
		});
		mocks.continueAfter.mockResolvedValueOnce([
			new Error("closeout failed"),
			"closeout string failure",
		]);
		mocks.continueQueue.mockReturnValueOnce(true);
		await execute(input());
		expect(mocks.loggerError).toHaveBeenCalledWith(
			expect.objectContaining({ listenerFailureCount: 1 }),
			"Task terminal event subscriber failed after closeout",
		);
		expect(mocks.loggerError).toHaveBeenCalledWith(
			{ error: "closeout failed", runId: "run-1" },
			"Task run closeout subscriber failed after the run was finalized",
		);
		expect(mocks.loggerError).toHaveBeenCalledWith(
			{ error: "closeout string failure", runId: "run-1" },
			"Task run closeout subscriber failed after the run was finalized",
		);
		expect(mocks.runQueue).toHaveBeenCalledWith("repository-1");
	});

	it("persists a terminal-listener warning when possible", async () => {
		mocks.publishTerminal.mockResolvedValueOnce({
			failures: ["failed"],
			listenerCount: 3,
		});
		await execute(input());
		expect(mocks.createRunEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "system.warning",
				data: {
					action: "task_run.terminal_publish",
					listenerCount: 3,
					listenerFailureCount: 1,
				},
			}),
		);
	});
});

describe("runtime exception boundaries", () => {
	it("routes adapter start exceptions to the runtime failure handler", async () => {
		mocks.runtimeStart.mockRejectedValueOnce(new Error("provider timeout"));
		await execute(input());
		expect(mocks.handleFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.objectContaining({ message: "provider timeout" }),
				runtimeLaneResolution: expect.objectContaining({
					lane: "native-api-runner",
				}),
			}),
		);
		expect(mocks.release).toHaveBeenCalled();
	});

	it("routes Codex preparation exceptions to the failure handler", async () => {
		mocks.prepareCodex.mockRejectedValueOnce(
			new Error("repository preflight failed"),
		);
		await execute(input({ lane: "codex-sdk" }));
		expect(mocks.runtimeStart).not.toHaveBeenCalled();
		expect(mocks.handleFailure).toHaveBeenCalled();
	});

	it("routes initial heartbeat exceptions to the failure handler", async () => {
		mocks.heartbeatRun.mockRejectedValueOnce(new Error("heartbeat failed"));
		await execute(input());
		expect(mocks.runtimeStart).not.toHaveBeenCalled();
		expect(mocks.handleFailure).toHaveBeenCalled();
	});

	it.each([
		"failed",
		"timed_out",
		"needs_human",
	])("finalizes provider outcome %s", async (terminalState) => {
		mocks.runtimeStart.mockResolvedValueOnce(runtimeResult({ terminalState }));
		mocks.updateRunWithoutPublish.mockResolvedValueOnce({
			status: terminalState,
		});
		await execute(input());
		expect(mocks.completeQueue).toHaveBeenCalledWith("run-1", terminalState);
	});
});

async function execute(launchInput: ReturnType<typeof input>) {
	await launchRuntimeExecution(launchInput as never);
	await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledTimes(1));
}

function input(
	overrides: {
		lane?: "native-api-runner" | "codex-sdk";
		interactiveReview?: boolean;
		timeoutSeconds?: number;
		safetyPolicy?: Record<string, unknown>;
		agentModeSessionId?: string | null;
	} = {},
) {
	const runtimeContextSnapshot = {
		executionMode: "implementation",
		interactiveReview: overrides.interactiveReview ?? false,
	};
	return {
		taskId: "task-1",
		task: {
			id: "task-1",
			repositoryId: "repository-1",
			timeoutSeconds: overrides.timeoutSeconds,
			revision: 7,
			title: "Implement feature",
		},
		run: { id: "run-1", agentModeSessionId: "persisted-session" },
		repoInfo: {
			id: "repository-1",
			localPath: "/repo",
			safetyPolicy: overrides.safetyPolicy,
		},
		compiledPromptText: "compiled prompt",
		runtimeLatestUserMessage: "latest request",
		runtimeImageAttachments: [],
		runtimeContextSnapshot,
		runtimeOptions: { provider: "fixture" },
		runtimeLaneDefinition: {
			createAdapter: vi.fn(() => ({ start: mocks.runtimeStart })),
		},
		runtimeLaneResolution: {
			lane: overrides.lane ?? "native-api-runner",
			workerKind:
				(overrides.lane ?? "native-api-runner") === "codex-sdk"
					? "codex-agent"
					: "native-local",
			source: "role_route",
			diagnostics: [],
		},
		agentModeSessionId: overrides.agentModeSessionId,
	};
}

function runtimeResult(overrides: Record<string, unknown> = {}) {
	return {
		terminalState: "completed",
		stoppedBy: null,
		riskLevel: "low",
		contractWarnings: undefined,
		logContent: "runtime log",
		diffPatch: undefined,
		testResults: undefined,
		finalReport: "Final report",
		summary: "Runtime summary",
		...overrides,
	};
}

function todo(status: string, seq: number) {
	return { id: `todo-${seq}`, seq, title: `Todo ${seq}`, status };
}
