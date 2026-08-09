import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
	operatorListener: null as
		| ((event: Record<string, unknown>) => Promise<void>)
		| null,
	terminalListener: null as
		| ((event: Record<string, unknown>) => Promise<void>)
		| null,
	messageListener: null as
		| ((message: Record<string, unknown>) => Promise<void>)
		| null,
	questionnaireListener: null as ((value: unknown) => Promise<void>) | null,
	resourcePages: {} as Record<string, Array<Record<string, unknown>>>,
	projection: {} as Record<string, unknown>,
	getSessionByTaskId: vi.fn(),
	getOrCreateSession: vi.fn(),
	toControlSummary: vi.fn(),
	finishStop: vi.fn(),
	initializeExecutionEvents: vi.fn(),
	readProjection: vi.fn(),
	readResource: vi.fn(),
	registerOperator: vi.fn(),
	registerTerminal: vi.fn(),
	registerMessage: vi.fn(),
	registerQuestionnaire: vi.fn(),
	recordQuestionnaire: vi.fn(),
	recordTaskEvent: vi.fn(),
	appendTaskEvent: vi.fn(),
	projectEvent: vi.fn(),
	publish: vi.fn(),
	isAgentSession: vi.fn(),
	backfill: vi.fn(),
	reconcileInterrupted: vi.fn(),
	listPlaying: vi.fn(),
	markActive: vi.fn(),
	scheduleWake: vi.fn(),
	cancelWake: vi.fn(),
	latestRunId: vi.fn(),
	createAccess: vi.fn(),
	preflight: vi.fn(),
	claimPlay: vi.fn(),
	claimStop: vi.fn(),
	completePrompt: vi.fn(),
	getSessionById: vi.fn(),
	dispatchPrompt: vi.fn(),
	runtimeActive: vi.fn(),
	reconcileRuntime: vi.fn(),
	stopRuntime: vi.fn(),
	cancelPending: vi.fn(),
	cancelRunning: vi.fn(),
	buildContext: vi.fn(),
}));

vi.mock("../packages/mission-pilot/src/backend/agentsShare", () => ({
	registerTaskRunTerminalListener: controls.registerTerminal,
}));

vi.mock(
	"../packages/mission-pilot/src/backend/questionnaire/questionnaire-events",
	() => ({
		registerQuestionnaireStateChangedListener: controls.registerQuestionnaire,
	}),
);

vi.mock("../packages/mission-pilot/src/backend/storage", () => ({
	getSessionByTaskId: controls.getSessionByTaskId,
	getOrCreateSession: controls.getOrCreateSession,
	toControlSummary: controls.toControlSummary,
	finishStop: controls.finishStop,
}));

vi.mock("../packages/mission-pilot/src/backend/task", () => ({
	registerTaskMessageCreatedListener: controls.registerMessage,
}));

vi.mock("../packages/mission-pilot/src/backend/taskOperator", () => ({
	humanTaskOperatorPrincipal: () => ({ kind: "human" }),
	humanTaskOperatorQueryContext: () => ({ kind: "query" }),
	initializeTaskOperatorExecutionEvents: controls.initializeExecutionEvents,
	readTaskOperatorProjection: controls.readProjection,
	readTaskOperatorResource: controls.readResource,
	registerTaskOperatorExecutionEventListener: controls.registerOperator,
}));

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-action-execution.repository",
	() => ({
		getLatestSucceededMissionPilotImplementationRunId: controls.latestRunId,
	}),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-agent-active-registry",
	() => ({ markMissionPilotAgentTaskActive: controls.markActive }),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-agent-lifecycle.repository",
	() => ({
		cancelPendingMissionPilotToolCalls: controls.cancelPending,
		cancelRunningMissionPilotToolCalls: controls.cancelRunning,
	}),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-agent-runtime",
	() => ({
		isMissionPilotAgentRuntimeActive: controls.runtimeActive,
		reconcileInterruptedMissionPilotAgentSessions: controls.reconcileRuntime,
		stopMissionPilotAgentRuntime: controls.stopRuntime,
	}),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-agent-session.repository",
	() => ({
		backfillStoppedMissionPilotAgentSessions: controls.backfill,
		claimAgentPlay: controls.claimPlay,
		claimAgentStop: controls.claimStop,
		completeAgentInitialPromptDispatch: controls.completePrompt,
		getMissionPilotSessionById: controls.getSessionById,
		isMissionPilotAgentSession: controls.isAgentSession,
		listPlayingAgentSessions: controls.listPlaying,
	}),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-agent-wake.service",
	() => ({
		cancelScheduledMissionPilotAgentWake: controls.cancelWake,
		scheduleMissionPilotAgentWake: controls.scheduleWake,
	}),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-provider.port",
	() => ({ preflightMissionPilotProviderToolTurn: controls.preflight }),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-task-event.adapter",
	() => ({
		recordMissionPilotQuestionnaireStateChanged: controls.recordQuestionnaire,
		recordMissionPilotTaskEvent: controls.recordTaskEvent,
	}),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-task-event.repository",
	() => ({
		appendMissionPilotTaskEvent: controls.appendTaskEvent,
		projectMissionPilotExecutionEvent: controls.projectEvent,
	}),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/mission-pilot-delegation",
	() => ({ createMissionPilotTaskOperatorAccess: controls.createAccess }),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/mission-pilot-initial-prompt.service",
	() => ({ dispatchMissionPilotInitialPrompt: controls.dispatchPrompt }),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/mission-pilot-realtime",
	() => ({ publishMissionPilotUpdated: controls.publish }),
);

vi.mock(
	"../packages/mission-pilot/src/backend/runtime/prompts/mission-pilot-system-context",
	() => ({ buildMissionPilotSystemContext: controls.buildContext }),
);

import {
	getControl,
	initializeMissionPilotAgentQuestionnaireEvents,
	initializeMissionPilotAgentTaskMessageEvents,
	initializeMissionPilotRunSync,
	play,
	reconcileMissionPilotRunOutcomes,
	reconcileMissionPilotStartup,
	stop,
	stopMissionPilotRuntimeEventListeners,
} from "../packages/mission-pilot/src/backend/runtime/mission-pilot.service";

function session(overrides: Record<string, unknown> = {}) {
	return {
		id: "session-1",
		taskId: "task-1",
		desiredState: "playing",
		version: 1,
		initialPromptState: "sent",
		activeRunId: null,
		lastErrorCode: null,
		...overrides,
	};
}

function projection(overrides: Record<string, unknown> = {}) {
	return {
		task: { id: "task-1", revision: 3, title: "Task title" },
		project: { id: "project-1" },
		latestTerminalRun: null,
		...overrides,
	};
}

function setTaskText(
	objective = "Task goal",
	acceptanceCriteria = "Acceptance",
	revision = 3,
) {
	controls.resourcePages = {
		objective: [
			{
				sourceDigest: "objective-digest",
				sourceRevision: revision,
				content: { text: objective },
				nextCursor: null,
			},
		],
		acceptance_criteria: [
			{
				sourceDigest: "acceptance-digest",
				sourceRevision: revision,
				content: { text: acceptanceCriteria },
				nextCursor: null,
			},
		],
	};
}

async function expectCode(promise: Promise<unknown>, code: string) {
	await expect(promise).rejects.toMatchObject({ code });
}

beforeEach(() => {
	stopMissionPilotRuntimeEventListeners();
	controls.operatorListener = null;
	controls.terminalListener = null;
	controls.messageListener = null;
	controls.questionnaireListener = null;
	vi.clearAllMocks();
	controls.registerOperator.mockImplementation((listener) => {
		controls.operatorListener = listener;
		return vi.fn();
	});
	controls.registerTerminal.mockImplementation((listener) => {
		controls.terminalListener = listener;
		return vi.fn();
	});
	controls.registerMessage.mockImplementation((listener) => {
		controls.messageListener = listener;
		return vi.fn();
	});
	controls.registerQuestionnaire.mockImplementation((listener) => {
		controls.questionnaireListener = listener;
		return vi.fn();
	});
	controls.projection = projection();
	controls.readProjection.mockImplementation(async () => controls.projection);
	setTaskText();
	controls.readResource.mockImplementation(async ({ resourceId, cursor }) => {
		const pages = controls.resourcePages[String(resourceId)] ?? [];
		return pages[typeof cursor === "number" ? cursor : 0];
	});
	controls.getSessionByTaskId.mockResolvedValue(session());
	controls.getOrCreateSession.mockResolvedValue(session());
	controls.toControlSummary.mockImplementation((value) => ({
		id: value.id,
		desiredState: value.desiredState,
		version: value.version,
	}));
	controls.finishStop.mockImplementation(async (_taskId, version) =>
		session({ desiredState: "stopped", version: Number(version) + 1 }),
	);
	controls.isAgentSession.mockResolvedValue(true);
	controls.createAccess.mockResolvedValue({
		context: { delegated: true },
		delegatedAuthorization: { id: "authorization" },
	});
	controls.preflight.mockReturnValue({ ok: true, candidateCount: 1 });
	controls.claimPlay.mockResolvedValue(
		session({ version: 2, initialPromptState: "sent" }),
	);
	controls.claimStop.mockResolvedValue(session({ version: 2 }));
	controls.completePrompt.mockResolvedValue(session({ version: 3 }));
	controls.getSessionById.mockResolvedValue(null);
	controls.dispatchPrompt.mockResolvedValue({
		initialPromptMessageId: "message-1",
	});
	controls.runtimeActive.mockReturnValue(false);
	controls.stopRuntime.mockResolvedValue({ quiesced: true });
	controls.cancelWake.mockResolvedValue(undefined);
	controls.cancelPending.mockResolvedValue(undefined);
	controls.cancelRunning.mockResolvedValue(undefined);
	controls.appendTaskEvent.mockResolvedValue({ id: "appended" });
	controls.projectEvent.mockResolvedValue(session());
	controls.latestRunId.mockResolvedValue(null);
	controls.backfill.mockResolvedValue(0);
	controls.reconcileRuntime.mockResolvedValue([]);
	controls.listPlaying.mockResolvedValue([]);
	controls.buildContext.mockReturnValue({ context: true });
});

describe("mission-pilot.service extra coverage", () => {
	it("initializes, filters, projects, and unregisters run event listeners", async () => {
		initializeMissionPilotRunSync();
		initializeMissionPilotRunSync();
		expect(controls.initializeExecutionEvents).toHaveBeenCalledOnce();
		expect(controls.registerOperator).toHaveBeenCalledOnce();
		expect(controls.registerTerminal).toHaveBeenCalledOnce();
		const operator = controls.operatorListener;
		const terminal = controls.terminalListener;
		if (!operator || !terminal)
			throw new Error("listeners were not registered");

		await operator({ type: "task.run.progress" });
		controls.getSessionByTaskId.mockResolvedValueOnce(null);
		await operator({
			type: "task.run.started",
			taskRef: { id: "task-1" },
			resourceRef: { id: "run-1" },
		});
		controls.getSessionByTaskId.mockResolvedValueOnce(
			session({ desiredState: "stopped" }),
		);
		await operator({
			type: "task.run.started",
			taskRef: { id: "task-1" },
			resourceRef: { id: "run-1" },
		});
		controls.isAgentSession.mockResolvedValueOnce(false);
		await operator({
			type: "task.run.started",
			taskRef: { id: "task-1" },
			resourceRef: { id: "run-1" },
		});
		controls.projectEvent.mockResolvedValueOnce(null);
		await operator({
			type: "task.run.started",
			taskRef: { id: "task-1" },
			resourceRef: { id: "run-null" },
		});
		await operator({
			type: "task.run.started",
			taskRef: { id: "task-1" },
			resourceRef: { id: "run-ok" },
		});
		expect(controls.publish).toHaveBeenCalled();

		controls.getSessionByTaskId.mockResolvedValueOnce(null);
		await terminal({ taskId: "task-1" });
		controls.appendTaskEvent.mockResolvedValueOnce(null);
		await terminal({
			taskId: "task-1",
			runId: "run-failed",
			eventId: "event-failed",
			taskRevision: 4,
			status: "failed",
			occurredAt: "now",
		});
		controls.projectEvent.mockResolvedValueOnce(null);
		await terminal({
			taskId: "task-1",
			runId: "run-blocked",
			eventId: "event-blocked",
			taskRevision: 4,
			status: "blocked",
			occurredAt: "now",
		});
		await terminal({
			taskId: "task-1",
			runId: "run-complete",
			eventId: "event-complete",
			taskRevision: 4,
			status: "completed",
			occurredAt: "now",
		});
		expect(controls.appendTaskEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "task_run.terminal" }),
		);
		expect(controls.scheduleWake).toHaveBeenCalledWith({
			sessionId: "session-1",
		});

		stopMissionPilotRuntimeEventListeners();
		stopMissionPilotRuntimeEventListeners();
	});

	it("filters task messages, records external users, and relays questionnaire changes", async () => {
		initializeMissionPilotAgentTaskMessageEvents();
		initializeMissionPilotAgentTaskMessageEvents();
		initializeMissionPilotAgentQuestionnaireEvents();
		initializeMissionPilotAgentQuestionnaireEvents();
		const listener = controls.messageListener;
		if (!listener || !controls.questionnaireListener)
			throw new Error("listeners were not registered");

		await listener({ role: "assistant" });
		controls.getSessionByTaskId.mockResolvedValueOnce(null);
		await listener({ role: "user", taskId: "task-1", metadataJson: null });
		await listener({
			id: "source",
			role: "user",
			taskId: "task-1",
			metadataJson: { source: "mission_pilot" },
		});
		await listener({
			id: "delegated",
			role: "user",
			taskId: "task-1",
			metadataJson: {
				actor: { kind: "delegated_user", actorId: "session-1" },
			},
		});
		await listener({
			id: "external",
			role: "user",
			taskId: "task-1",
			content: "Human message",
			metadataJson: { actor: [] },
		});
		expect(controls.recordTaskEvent).toHaveBeenCalledWith({
			taskId: "task-1",
			type: "task.user_message_added",
			sourceEventId: "task-message:external",
			taskRevision: 3,
			payload: { messageId: "external", content: "Human message" },
		});
		await controls.questionnaireListener({ id: "questionnaire" });
		expect(controls.recordQuestionnaire).toHaveBeenCalledWith({
			id: "questionnaire",
		});
	});

	it("reconciles startup and all terminal run outcome guards", async () => {
		controls.backfill.mockResolvedValue(2);
		controls.reconcileRuntime.mockResolvedValue([
			session({ id: "interrupted-playing", taskId: "task-playing" }),
			session({
				id: "interrupted-stopped",
				taskId: "task-stopped",
				desiredState: "stopped",
			}),
		]);
		controls.listPlaying.mockResolvedValue([
			{ session: session({ id: "listed", taskId: "task-listed" }) },
		]);
		expect(await reconcileMissionPilotStartup()).toBe(4);
		expect(controls.markActive).toHaveBeenCalledWith("task-listed");

		const sessions = [
			session({ id: "no-run", taskId: "no-run" }),
			session({
				id: "no-terminal",
				taskId: "no-terminal",
				activeRunId: "run-2",
			}),
			session({ id: "mismatch", taskId: "mismatch", activeRunId: "run-3" }),
			session({
				id: "not-appended",
				taskId: "not-appended",
				activeRunId: "run-4",
			}),
			session({
				id: "not-updated",
				taskId: "not-updated",
				activeRunId: "run-5",
			}),
			session({ id: "success", taskId: "success", activeRunId: "run-6" }),
			session({ id: "failure", taskId: "failure", activeRunId: "run-7" }),
		];
		controls.listPlaying.mockResolvedValue(
			sessions.map((value) => ({ session: value })),
		);
		controls.latestRunId.mockResolvedValue(null);
		controls.readProjection.mockImplementation(async (taskId) => {
			const terminals: Record<string, unknown> = {
				"no-terminal": null,
				mismatch: { id: "different", status: "completed", revision: 1 },
				"not-appended": { id: "run-4", status: "completed", revision: 2 },
				"not-updated": { id: "run-5", status: "completed", revision: 3 },
				success: { id: "run-6", status: "completed", revision: 4 },
				failure: { id: "run-7", status: "needs_human", revision: 5 },
			};
			return projection({
				task: { id: taskId, revision: 9, title: "Task" },
				latestTerminalRun: terminals[String(taskId)],
			});
		});
		controls.appendTaskEvent.mockImplementation(async ({ taskId }) =>
			taskId === "not-appended" ? null : { id: "appended" },
		);
		controls.projectEvent.mockImplementation(async ({ taskId }) =>
			taskId === "not-updated" ? null : session({ taskId }),
		);
		expect(await reconcileMissionPilotRunOutcomes()).toBe(2);
		expect(controls.appendTaskEvent).toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "task_run.failed" }),
		);
	});

	it("rejects play at revision, prompt, provider, migration, and claim boundaries", async () => {
		setTaskText("Goal", "Acceptance", 2);
		await expectCode(play("task-1", 1), "MISSION_PILOT_VERSION_CONFLICT");

		setTaskText("   ", "Acceptance", 3);
		await expectCode(
			play("task-1", 1),
			"MISSION_PILOT_INITIAL_PROMPT_REQUIRED",
		);

		setTaskText();
		controls.preflight.mockReturnValueOnce({
			ok: false,
			code: "PROVIDER_UNSUPPORTED",
			message: "unsupported",
		});
		await expectCode(play("task-1", 1), "PROVIDER_UNSUPPORTED");

		controls.getSessionByTaskId.mockResolvedValueOnce(null);
		controls.isAgentSession.mockResolvedValueOnce(false);
		await expectCode(
			play("task-1", 1),
			"MISSION_PILOT_AGENT_MIGRATION_REQUIRED",
		);

		controls.claimPlay.mockResolvedValueOnce(null);
		await expectCode(play("task-1", 1), "MISSION_PILOT_VERSION_CONFLICT");
	});

	it("plays existing and new sessions with optional acceptance and dispatch states", async () => {
		setTaskText("Goal", "", 3);
		controls.getSessionByTaskId.mockResolvedValueOnce(null);
		controls.claimPlay.mockImplementationOnce(
			async (_taskId, _version, _principal, config) => {
				config.systemContext({ pushPolicy: "allowed" });
				return session({ version: 2, initialPromptState: "dispatching" });
			},
		);
		controls.getSessionById.mockResolvedValueOnce(session({ version: 4 }));
		const played = await play("task-1", 1, {
			providerPreflight: () => ({ ok: true, candidateCount: 1 }),
		});
		expect(played).toMatchObject({
			missionPilot: { id: "session-1", version: 4 },
			run: null,
			messages: [],
		});
		expect(controls.getOrCreateSession).toHaveBeenCalledWith(
			expect.objectContaining({
				task: expect.objectContaining({ acceptanceCriteria: null }),
			}),
		);
		expect(controls.completePrompt).toHaveBeenCalled();
		expect(controls.buildContext).toHaveBeenCalledWith(
			expect.objectContaining({ pushPolicy: "allowed" }),
		);

		setTaskText("Goal", "Acceptance", 3);
		controls.claimPlay.mockResolvedValueOnce(
			session({ version: 5, initialPromptState: "sent" }),
		);
		await play("task-1", 4);
		expect(controls.dispatchPrompt).toHaveBeenCalledTimes(1);
	});

	it("handles initial prompt completion conflicts and dispatch failures", async () => {
		controls.claimPlay.mockResolvedValueOnce(
			session({ version: 2, initialPromptState: "dispatching" }),
		);
		controls.completePrompt.mockResolvedValueOnce(null);
		controls.claimStop.mockResolvedValueOnce(null);
		controls.getSessionByTaskId.mockResolvedValueOnce(null);
		await expectCode(play("task-1", 1), "MISSION_PILOT_VERSION_CONFLICT");

		controls.claimPlay.mockResolvedValueOnce(
			session({ version: 2, initialPromptState: "dispatching" }),
		);
		controls.dispatchPrompt.mockRejectedValueOnce("dispatch failed");
		controls.claimStop.mockResolvedValueOnce(session({ version: 3 }));
		controls.getSessionByTaskId.mockResolvedValueOnce(session({ version: 4 }));
		await expectCode(
			play("task-1", 1),
			"MISSION_PILOT_INITIAL_PROMPT_DISPATCH_FAILED",
		);
		expect(controls.finishStop).toHaveBeenCalledWith(
			"task-1",
			3,
			"dispatch failed",
			null,
			"MISSION_PILOT_INITIAL_PROMPT_DISPATCH_FAILED",
			"failed",
		);
	});

	it("validates paged task text changes, invalid pages, and paging limits", async () => {
		controls.resourcePages.objective = [
			{
				sourceDigest: "one",
				sourceRevision: 3,
				content: { text: "part one" },
				nextCursor: 1,
			},
			{
				sourceDigest: "two",
				sourceRevision: 3,
				content: { text: "part two" },
				nextCursor: null,
			},
		];
		await expectCode(play("task-1", 1), "MISSION_PILOT_TASK_TEXT_CHANGED");

		setTaskText();
		controls.resourcePages.objective[0].content = { text: 42 };
		await expectCode(play("task-1", 1), "MISSION_PILOT_TASK_TEXT_INVALID");

		setTaskText();
		controls.resourcePages.objective = Array.from(
			{ length: 64 },
			(_, index) => ({
				sourceDigest: "same",
				sourceRevision: 3,
				content: { text: "x" },
				nextCursor: index + 1,
			}),
		);
		await expectCode(play("task-1", 1), "MISSION_PILOT_TASK_TEXT_TOO_LARGE");
	});

	it("returns controls and covers every stop transition and runtime outcome", async () => {
		controls.getSessionByTaskId.mockResolvedValueOnce(null);
		expect(await getControl("missing")).toBeNull();
		expect(await getControl("task-1")).toMatchObject({ id: "session-1" });

		controls.getSessionByTaskId.mockResolvedValueOnce(null);
		await expectCode(stop("task-1", 1), "MISSION_PILOT_NOT_FOUND");
		controls.isAgentSession.mockResolvedValueOnce(false);
		await expectCode(
			stop("task-1", 1),
			"MISSION_PILOT_AGENT_MIGRATION_REQUIRED",
		);

		controls.getSessionByTaskId.mockResolvedValueOnce(
			session({ desiredState: "stopped" }),
		);
		expect(await stop("task-1", 1)).toMatchObject({ stoppedRun: null });

		controls.claimStop.mockResolvedValueOnce(null);
		await expectCode(stop("task-1", 1), "MISSION_PILOT_VERSION_CONFLICT");

		controls.stopRuntime.mockResolvedValueOnce({ quiesced: true });
		const stopped = await stop("task-1", 1);
		expect(stopped).toMatchObject({ stoppedRun: null });
		expect(controls.cancelRunning).toHaveBeenCalledWith("session-1");

		controls.getSessionByTaskId.mockResolvedValueOnce(
			session({
				desiredState: "stopped",
				lastErrorCode: "MISSION_PILOT_RUNTIME_STOP_TIMEOUT",
			}),
		);
		controls.stopRuntime.mockResolvedValueOnce({ quiesced: false });
		await stop("task-1", 1);
		expect(controls.finishStop).toHaveBeenCalledWith(
			"task-1",
			2,
			"Mission Pilot runtime did not acknowledge the stop request in time.",
			null,
			"MISSION_PILOT_RUNTIME_STOP_TIMEOUT",
		);

		controls.finishStop.mockResolvedValueOnce(null);
		await expectCode(stop("task-1", 1), "MISSION_PILOT_VERSION_CONFLICT");
	});
});
