import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let setters: Array<ReturnType<typeof vi.fn>> = [];
let traceItems: unknown[] = [];

const session = { id: "session-1", status: "ready" };
const artifact = {
	id: "artifact-1",
	taskId: "session-1",
	kind: "plan_mode_workspace",
};

function workspace(overrides: Record<string, unknown> = {}) {
	return {
		activeSession: session,
		activeSessionId: "session-1",
		activeSessionView: { queueEntry: { id: "entry-1" } },
		activeProject: {
			id: "repo-1",
			safetyPolicy: { externalAllowedPaths: ["/existing"] },
		},
		activeSessionRuns: [],
		latestRun: { id: "run-1", status: "needs_human", contextSnapshot: null },
		taskMessages: [],
		latestRunEvents: [],
		llmUsageSummary: null,
		activityEvents: [],
		activityArtifacts: [],
		backgroundProcesses: [],
		activeStreamingResponse: null,
		activeArtifactRefs: [{ kind: "review_status" }],
		isAgentWorking: false,
		isAgentThinking: false,
		realtimeStatus: "connected",
		isChatSubmitting: false,
		stopRun: vi.fn(async () => undefined),
		cancelChatSubmit: vi.fn(async () => undefined),
		stopBackgroundProcess: vi.fn(),
		deleteSession: vi.fn(),
		openProjectFile: vi.fn(),
		sendWorkbenchMessage: vi.fn(async () => ({
			run: { id: "run" },
			messages: [],
		})),
		updateProject: vi.fn(async () => undefined),
		resumeTodo: vi.fn(async () => undefined),
		isResumingTodo: false,
		latestRunTodos: [],
		projectFileEntries: [],
		projectFileEntriesByDirectory: {},
		expandedProjectDirectories: [],
		loadingProjectDirectories: [],
		selectedProjectFile: null,
		selectedProjectFilePath: null,
		isProjectFilesLoading: false,
		isProjectFileLoading: false,
		projectDiff: null,
		isProjectDiffLoading: false,
		toggleProjectDirectory: vi.fn(),
		refreshProjectFiles: vi.fn(),
		refreshProjectDiff: vi.fn(),
		activeReviewSession: null,
		activeGitCloseout: null,
		archiveCompletedSession: vi.fn(),
		restoreArchivedSession: vi.fn(),
		...overrides,
	};
}

function component(name: string) {
	return Object.defineProperty(() => null, "name", { value: name });
}

function setup(state: unknown[] = [null], trace: unknown[] = []) {
	const values = [...state];
	setters = [];
	traceItems = trace;
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useState: <T,>(initial: T) => {
				const value = values.length ? (values.shift() as T) : initial;
				const setter = vi.fn();
				setters.push(setter);
				return [value, setter] as const;
			},
		};
	});
	vi.doMock("../src/modules/nightworkers/components/ThreadWorkspace", () => ({
		ThreadWorkspace: component("ThreadWorkspace"),
	}));
	vi.doMock("../src/modules/todo/CodexTodoTracePane", () => ({
		CodexTodoTracePane: component("CodexTodoTracePane"),
	}));
	vi.doMock("../src/modules/nightworkers/components/TodoListPane", () => ({
		TodoListPane: component("TodoListPane"),
	}));
	const markArtifactOpenStart = vi.fn();
	vi.doMock("../src/modules/nightworkers/artifactPerformance", () => ({
		markArtifactOpenStart,
	}));
	vi.doMock("../src/modules/nightworkers/codexTodoTrace", () => ({
		projectLatestCodexTodoTrace: () => traceItems,
	}));
	const buildOverviewRoute = vi.fn(() => ({
		kind: "overview",
		range: "30d",
		projectId: null,
	}));
	vi.doMock(
		"../src/modules/nightworkers/routing/workbench-route-state",
		async () => ({
			...(await vi.importActual(
				"../src/modules/nightworkers/routing/workbench-route-state",
			)),
			buildOverviewRoute,
		}),
	);
	const designQuestionnaireMessageIds = vi.fn(
		(messages: Array<{ id: string }>) =>
			new Set(messages.map((message) => message.id)),
	);
	const isDesignQuestionnaireReadyMessage = vi.fn(
		(message: { ready?: boolean }) => message.ready === true,
	);
	const asProjectSafetyPolicy = vi.fn((value: unknown) => value || {});
	vi.doMock(
		"../src/modules/nightworkers/components/nightworkers-shell-utils",
		() => ({
			designQuestionnaireMessageIds,
			isDesignQuestionnaireReadyMessage,
			asProjectSafetyPolicy,
		}),
	);
	return {
		markArtifactOpenStart,
		buildOverviewRoute,
		designQuestionnaireMessageIds,
		isDesignQuestionnaireReadyMessage,
		asProjectSafetyPolicy,
	};
}

function props(current = workspace(), overrides: Record<string, unknown> = {}) {
	const onNavigate = vi.fn();
	const workspaceRef = { current };
	return {
		workspace: current,
		queueState: {
			removeImplementationQueueEntry: vi.fn(),
			requeueImplementationQueueEntry: vi.fn(),
		},
		routeState: { kind: "session", sessionId: "session-1", artifact: null },
		onNavigate,
		workspaceRef,
		model: "model",
		modelOptions: [],
		thinkingDepth: "medium",
		thinkingDepthOptions: [],
		onModelChange: vi.fn(),
		onThinkingDepthChange: vi.fn(),
		onSubmitPrompt: vi.fn(async () => undefined),
		buildComposerLlmSelection: vi.fn(() => ({
			providerEndpointId: "endpoint",
			model: "model",
		})),
		onComposerLlmSelectionSubmitted: vi.fn(),
		openQuestionnaireWorkspace: vi.fn(),
		selectedArtifactContext: { artifactId: "base" },
		selectedArtifact: artifact,
		artifactFocus: { type: "closed" },
		setArtifactFocus: vi.fn(),
		setClearedArtifactContextId: vi.fn(),
		artifactPaneOpen: false,
		isTodoArtifactOpen: false,
		hasTodoArtifact: true,
		hideTodoArtifact: false,
		hasEvidenceCheckArtifact: true,
		canStopLatestRun: false,
		onOpenBlueprintArtifact: vi.fn(),
		isBlueprintArtifactOpen: false,
		onOpenReviewArtifact: vi.fn(),
		isReviewArtifactOpen: false,
		onOpenEvidenceCheckArtifact: vi.fn(),
		isEvidenceCheckArtifactOpen: false,
		onOpenTodoArtifact: vi.fn(),
		startSessionAndFocusTodo: vi.fn(),
		queueActiveSessionAndFocusTodo: vi.fn(),
		addActiveSessionToQueue: vi.fn(),
		isActiveImplementationLocked: false,
		isPilotThoughtDockOpen: false,
		onTogglePilotThoughtDock: vi.fn(),
		...overrides,
	} as never;
}

async function render(panelProps: ReturnType<typeof props>) {
	const { NightWorkersShellThreadPanel } = await import(
		"../src/modules/nightworkers/components/NightWorkersShellThreadPanel"
	);
	return NightWorkersShellThreadPanel(panelProps) as ReactElement;
}

function elements(node: ReactNode): ReactElement[] {
	if (
		node == null ||
		typeof node === "boolean" ||
		typeof node === "string" ||
		typeof node === "number"
	)
		return [];
	if (Array.isArray(node)) return node.flatMap(elements);
	const element = node as ReactElement<{ children?: ReactNode }>;
	return [element, ...elements(element.props?.children)];
}

function splitChild(root: ReactElement) {
	return elements(root.props.splitPanel).find(
		(element) =>
			element.props &&
			("onProjectArtifactModeChange" in element.props ||
				"todos" in element.props ||
				"items" in element.props),
	)!;
}

describe("NightWorkers shell thread panel coverage", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("projects workspace state and submits initial prompts", async () => {
		setup();
		const current = workspace({
			latestRun: { id: "run-1", status: "running" },
			isChatSubmitting: true,
		});
		const panelProps = props(current);
		const root = await render(panelProps);
		expect(root.props.activeSession).toBe(current.activeSession);
		expect(root.props.canStopActiveRun).toBe(true);
		root.props.onSubmitInitialPrompt("hello", [{ id: "image" }]);
		expect(panelProps.onSubmitPrompt).toHaveBeenCalledWith("hello", undefined, [
			{ id: "image" },
		]);
	});

	it("submits normal and review workbench messages and opens a newly returned questionnaire", async () => {
		setup();
		let current = workspace();
		let panelProps = props(current);
		let root = await render(panelProps);
		await root.props.onSubmitWorkbenchMessage("normal", "implementation", []);
		expect(current.sendWorkbenchMessage).toHaveBeenCalledWith(
			"session-1",
			"normal",
			"implementation",
			{ artifactId: "base" },
			expect.any(Object),
			[],
		);
		expect(panelProps.onComposerLlmSelectionSubmitted).toHaveBeenCalled();

		current = workspace({
			taskMessages: [{ id: "old" }],
			sendWorkbenchMessage: vi.fn(async () => ({
				run: null,
				messages: [
					{ id: "old", ready: true },
					{ id: "new", ready: true },
				],
			})),
		});
		panelProps = props(current, {
			selectedArtifact: { ...artifact, kind: "review_status" },
		});
		root = await render(panelProps);
		await root.props.onSubmitWorkbenchMessage("review", "implementation", []);
		expect(current.sendWorkbenchMessage).toHaveBeenCalledWith(
			"session-1",
			"review",
			"review_prompt",
			{ artifactId: "base" },
			undefined,
			[],
		);
		expect(panelProps.openQuestionnaireWorkspace).toHaveBeenCalledWith(
			{ id: "new", ready: true },
			"questionnaire",
		);

		current = workspace({ activeSession: null });
		panelProps = props(current);
		root = await render(panelProps);
		await root.props.onSubmitWorkbenchMessage("outer", "intake", []);
		expect(panelProps.onSubmitPrompt).toHaveBeenCalledWith(
			"outer",
			"intake",
			[],
		);
	});

	it("stops active runs or cancels an in-flight chat", async () => {
		setup();
		let current = workspace();
		let panelProps = props(current, { canStopLatestRun: true });
		let root = await render(panelProps);
		await root.props.onStopActiveRun();
		expect(current.stopRun).toHaveBeenCalledWith("run-1");

		current = workspace({ latestRun: null });
		panelProps = props(current, { canStopLatestRun: false });
		root = await render(panelProps);
		await root.props.onStopActiveRun();
		expect(current.cancelChatSubmit).toHaveBeenCalled();
	});

	it("deletes, queues, removes, requeues, opens, and clears artifacts", async () => {
		const tools = setup();
		let current = workspace();
		let panelProps = props(current);
		let root = await render(panelProps);
		root.props.onDeleteSession();
		expect(current.deleteSession).toHaveBeenCalledWith("session-1");
		expect(panelProps.onNavigate).toHaveBeenCalledWith({
			kind: "overview",
			range: "30d",
			projectId: null,
		});
		await root.props.onQueueSession();
		expect(panelProps.startSessionAndFocusTodo).toHaveBeenCalledWith(
			"session-1",
		);
		root.props.onRemoveQueueEntry();
		root.props.onRequeueQueueEntry("retry");
		expect(
			panelProps.queueState.removeImplementationQueueEntry,
		).toHaveBeenCalledWith("entry-1");
		expect(
			panelProps.queueState.requeueImplementationQueueEntry,
		).toHaveBeenCalledWith("entry-1", "retry");
		root.props.onOpenArtifact(artifact);
		expect(tools.markArtifactOpenStart).toHaveBeenCalledWith(artifact);
		expect(panelProps.setArtifactFocus).toHaveBeenCalledWith({
			type: "artifact",
			artifact,
		});
		root.props.onClearArtifactContext();
		expect(panelProps.setClearedArtifactContextId).toHaveBeenCalledWith(
			"artifact-1",
		);

		current = workspace({
			activeSession: null,
			activeSessionId: null,
			activeSessionView: null,
		});
		panelProps = props(current, { selectedArtifact: null });
		root = await render(panelProps);
		root.props.onDeleteSession();
		await root.props.onQueueSession();
		root.props.onRemoveQueueEntry();
		root.props.onRequeueQueueEntry();
		root.props.onClearArtifactContext();
		expect(current.deleteSession).not.toHaveBeenCalled();
	});

	it("opens project files and toggles the project tree", async () => {
		setup();
		const current = workspace();
		let panelProps = props(current);
		let root = await render(panelProps);
		root.props.onOpenProjectFile("src/a.ts");
		expect(current.openProjectFile).toHaveBeenCalledWith("src/a.ts");
		expect(panelProps.onNavigate).toHaveBeenCalledWith(
			expect.objectContaining({
				artifact: expect.objectContaining({ filePath: "src/a.ts" }),
			}),
		);
		root.props.onOpenProjectFiles();
		expect(panelProps.setArtifactFocus).toHaveBeenCalledWith({
			type: "project_tree",
		});

		panelProps = props(current, { artifactFocus: { type: "project_tree" } });
		root = await render(panelProps);
		root.props.onOpenProjectFiles();
		expect(panelProps.setArtifactFocus).toHaveBeenCalledWith({
			type: "closed",
		});

		panelProps = props(current, {
			workspaceRef: { current: workspace({ activeSessionId: null }) },
		});
		root = await render(panelProps);
		root.props.onOpenProjectFiles();
		expect(panelProps.setArtifactFocus).not.toHaveBeenCalled();
	});

	it("grants deduplicated external paths and guards projects", async () => {
		const tools = setup();
		let current = workspace();
		let root = await render(props(current));
		await root.props.onGrantExternalPath("/new");
		expect(current.updateProject).toHaveBeenCalledWith("repo-1", {
			safetyPolicy: { externalAllowedPaths: ["/existing", "/new"] },
		});
		await root.props.onGrantExternalPath("/existing");
		expect(tools.asProjectSafetyPolicy).toHaveBeenCalled();

		current = workspace({ activeProject: null });
		root = await render(props(current));
		await root.props.onGrantExternalPath("/ignored");
		expect(current.updateProject).not.toHaveBeenCalled();
	});

	it("renders trace and Todo split panes and resumes only with a run", async () => {
		setup([null], [{ id: "trace" }]);
		let current = workspace({
			latestRun: { id: "run-1", status: "finalizing" },
		});
		let root = await render(props(current, { isTodoArtifactOpen: true }));
		let split = splitChild(root);
		expect(split.type.name).toBe("CodexTodoTracePane");
		expect(split.props.runActive).toBe(true);

		setup();
		current = workspace({
			latestRun: {
				id: "run-1",
				status: "needs_human",
				contextSnapshot: {
					runtimePause: {
						version: 1,
						kind: "host_limit",
						stoppedBy: "budget",
						resumableRunningTodo: true,
					},
				},
			},
		});
		root = await render(props(current, { isTodoArtifactOpen: true }));
		split = splitChild(root);
		expect(split.type.name).toBe("TodoListPane");
		expect(split.props.allowRunningTodoResume).toBe(true);
		await split.props.onResume("todo-1", 2, "continue");
		expect(current.resumeTodo).toHaveBeenCalledWith({
			runId: "run-1",
			todoId: "todo-1",
			expectedTodoRevision: 2,
			userContext: "continue",
		});

		setup();
		current = workspace({ latestRun: null });
		root = await render(props(current, { isTodoArtifactOpen: true }));
		split = splitChild(root);
		await split.props.onResume("todo", 1, "");
		expect(current.resumeTodo).not.toHaveBeenCalled();
	});

	it("configures artifact pane callbacks, route modes, tabs, queue, and review actions", async () => {
		setup([{ artifactId: "plan-context" }]);
		const current = workspace({ selectedProjectFilePath: "src/current.ts" });
		const panelProps = props(current, {
			artifactPaneOpen: true,
			artifactFocus: { type: "artifact", artifact },
			routeState: {
				kind: "session",
				sessionId: "session-1",
				artifact: { kind: "plan_mode_workspace", tab: "feature_plan" },
			},
		});
		const root = await render(panelProps);
		expect(root.props.activeArtifactContext).toEqual({
			artifactId: "plan-context",
		});
		const pane = splitChild(root);
		expect(pane.props.focusType).toBe("artifact");
		expect(pane.props.projectArtifactMode).toBe("tree");
		pane.props.onProjectArtifactModeChange("diff");
		expect(panelProps.onNavigate).toHaveBeenCalledWith(
			expect.objectContaining({
				artifact: expect.objectContaining({ mode: "diff" }),
			}),
		);
		pane.props.onPlanWorkspaceTabChange("feature_plan");
		expect(panelProps.onNavigate).toHaveBeenCalledTimes(1);
		pane.props.onPlanWorkspaceTabChange("blueprint");
		expect(panelProps.onNavigate).toHaveBeenCalledTimes(2);
		pane.props.onPlanWorkspaceArtifactContextChange({ artifactId: "next" });
		expect(setters[0]).toHaveBeenCalledWith({ artifactId: "next" });
		await pane.props.onQueueSession();
		expect(panelProps.queueActiveSessionAndFocusTodo).toHaveBeenCalled();
		pane.props.onCompleteAndArchiveTask("task", {
			discardPendingCloseouts: true,
		});
		pane.props.onRestoreArchivedTask("task");
		expect(current.archiveCompletedSession).toHaveBeenCalled();
		expect(current.restoreArchivedSession).toHaveBeenCalled();
		await expect(pane.props.onSubmitReviewPrompt("review")).resolves.toBe(true);
	});

	it("guards artifact route changes and review submission without an active task", async () => {
		setup();
		const current = workspace({ activeSession: null, activeSessionId: null });
		const panelProps = props(current, {
			artifactPaneOpen: true,
			artifactFocus: { type: "project_tree" },
		});
		const root = await render(panelProps);
		const pane = splitChild(root);
		pane.props.onProjectArtifactModeChange("diff");
		pane.props.onPlanWorkspaceTabChange("status");
		await expect(pane.props.onSubmitReviewPrompt("review")).resolves.toBe(
			false,
		);
		expect(panelProps.onNavigate).not.toHaveBeenCalled();
	});

	it("rejects malformed host-limit pause shapes", async () => {
		for (const contextSnapshot of [
			null,
			[],
			{},
			{ runtimePause: [] },
			{ runtimePause: { version: 2 } },
			{ runtimePause: { version: 1, kind: "other" } },
		]) {
			setup();
			const current = workspace({
				latestRun: { id: "run", status: "needs_human", contextSnapshot },
			});
			const root = await render(props(current, { isTodoArtifactOpen: true }));
			expect(splitChild(root).props.allowRunningTodoResume).toBe(false);
		}
	});
});
