import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let setters: Array<ReturnType<typeof vi.fn>> = [];
let refs: Array<{ current: unknown }> = [];
let effects: Array<() => undefined | (() => void)> = [];

const planArtifact = {
	id: "plan-1",
	taskId: "session-1",
	kind: "plan_mode_workspace",
	metadata: { initialTab: "feature_plan" },
};
const blueprintArtifact = {
	id: "blueprint-1",
	taskId: "session-1",
	kind: "app_blueprint",
};
const reviewArtifact = {
	id: "review-1",
	taskId: "session-1",
	kind: "review_status",
};
const evidenceArtifact = {
	id: "evidence-1",
	taskId: "session-1",
	kind: "evidence_check",
};

function workspace(overrides: Record<string, unknown> = {}) {
	const session = {
		id: "session-1",
		repositoryId: "repo-1",
		title: "Session",
		status: "ready",
		updatedAt: "now",
		createdAt: "before",
	};
	return {
		projects: [{ id: "repo-1", name: "Project" }],
		activeProject: { id: "repo-1", name: "Project" },
		sessions: [session],
		activeSessionId: "session-1",
		activeSession: session,
		activeArtifactRefs: [planArtifact, reviewArtifact, evidenceArtifact],
		latestRun: null,
		latestRunTodos: [],
		taskMessages: [],
		isAgentWorking: false,
		setActiveSessionId: vi.fn(),
		createSession: vi.fn(async () => ({ ...session, id: "new-session" })),
		sendWorkbenchMessage: vi.fn(async () => undefined),
		startRun: vi.fn(async () => undefined),
		...overrides,
	};
}

function setup(
	workspaceValue = workspace(),
	state: unknown[] = ["", { type: "closed" }, null, null],
	options: {
		evidenceData?: unknown;
		refetchData?: unknown;
		queueError?: unknown;
	} = {},
) {
	const values = [...state];
	setters = [];
	refs = [];
	effects = [];
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useEffect: (callback: () => undefined | (() => void)) =>
				effects.push(callback),
			useRef: <T,>(initial: T) => {
				const ref = { current: initial };
				refs.push(ref as { current: unknown });
				return ref;
			},
			useState: <T,>(initial: T) => {
				const value = values.length ? (values.shift() as T) : initial;
				const setter = vi.fn((next: T | ((current: T) => T)) =>
					typeof next === "function"
						? (next as (current: T) => T)(value)
						: next,
				);
				setters.push(setter);
				return [value, setter] as const;
			},
		};
	});
	vi.doMock("react-i18next", () => ({
		useTranslation: () => ({ t: (key: string) => key }),
	}));

	const queueState = {
		createImplementationQueueEntry: vi.fn(
			async (_id: string, opts?: unknown) => {
				if (options.queueError && !opts) throw options.queueError;
			},
		),
	};
	vi.doMock("../src/modules/queue", () => ({
		useImplementationQueue: () => queueState,
	}));
	const evidenceQuery = {
		data: options.evidenceData,
		refetch: vi.fn(async () => ({ data: options.refetchData })),
	};
	const buildEvidenceCheckArtifactFromDescriptor = vi.fn(
		({ descriptor }: { descriptor: { id?: string } }) => ({
			...evidenceArtifact,
			id: descriptor.id ?? "descriptor-evidence",
		}),
	);
	const buildEvidenceCheckArtifact = vi.fn(() => ({
		...evidenceArtifact,
		id: "built-evidence",
	}));
	vi.doMock("../src/modules/codingAgent", () => ({
		useLatestEvidenceCheckDescriptor: () => evidenceQuery,
		buildEvidenceCheckArtifactFromDescriptor,
		buildEvidenceCheckArtifact,
	}));
	vi.doMock("../../../composition/mission-pilot", () => ({}));
	vi.doMock("../src/composition/mission-pilot", () => ({
		useMissionPilotArtifactAutoFocus: vi.fn(),
	}));
	vi.doMock("../src/modules/review", () => ({
		useReviewModeArtifactAutoFocus: vi.fn(),
	}));
	vi.doMock(
		"../src/modules/nightworkers/contexts/WorkspaceAppearanceContext",
		() => ({
			useWorkspaceAppearanceState: () => ({
				attributes: { "data-theme": "night" },
			}),
		}),
	);
	const setPanelSizes = vi.fn();
	vi.doMock(
		"../src/modules/nightworkers/contexts/WorkspaceLayoutContext",
		() => ({
			useWorkspaceLayoutState: () => ({ panelSizes: [25, 75] }),
			useWorkspaceLayoutActions: () => ({ setPanelSizes }),
		}),
	);
	const routeModel = {
		showSettings: false,
		isOverviewActive: false,
		showQueueScreen: false,
		queueProjectFilterId: null,
		projectQueueProjectId: null,
		projectDetailProjectId: null,
		projectQueueProject: null,
		projectDetailProject: null,
		projectQueueSessionViews: [],
		projectDetailSessionViews: [],
		missingProjectRoute: false,
		missingSessionRoute: false,
	};
	vi.doMock(
		"../src/modules/nightworkers/components/nightworkers-shell-route-model",
		() => ({
			resolveNightWorkersShellRouteModel: () => routeModel,
		}),
	);
	const useNightWorkersRouteArtifactSync = vi.fn();
	vi.doMock(
		"../src/modules/nightworkers/components/nightworkers-shell-route-effects",
		() => ({
			useNightWorkersRouteArtifactSync,
		}),
	);
	const markArtifactOpenStart = vi.fn();
	vi.doMock("../src/modules/nightworkers/artifactPerformance", () => ({
		markArtifactOpenStart,
	}));
	const buildArtifactContext = vi.fn((artifact: { id: string }) => ({
		artifactId: artifact.id,
	}));
	vi.doMock("../src/modules/nightworkers/workbenchSelectors", () => ({
		buildArtifactContext,
	}));
	const buildComposerLlmSelection = vi.fn(() => ({
		providerEndpointId: "endpoint",
		model: "model",
	}));
	const clearComposerLlmSelectionOverride = vi.fn();
	const preserveRef = { current: null as string | null };
	vi.doMock(
		"../src/modules/nightworkers/components/useNightWorkersComposer",
		() => ({
			useNightWorkersComposer: () => ({
				model: "model",
				thinkingDepth: "medium",
				composerModelOptions: [],
				composerThinkingDepthOptions: [],
				buildComposerLlmSelection,
				clearComposerLlmSelectionOverride,
				handleComposerModelChange: vi.fn(),
				handleComposerThinkingDepthChange: vi.fn(),
				preserveComposerOverrideSessionIdRef: preserveRef,
			}),
		}),
	);
	const navigation = {
		handleSelectSession: vi.fn(),
		handleCreateSession: vi.fn(),
		handleDeleteProject: vi.fn(),
		handleToggleProject: vi.fn(),
		handleOpenFolderBrowser: vi.fn(),
		handleOpenOverview: vi.fn(),
		handleOpenProjectQueue: vi.fn(),
		handleOpenProjectDetail: vi.fn(),
		handleProjectEvaluationTasksCreated: vi.fn(),
		handleProjectDetailTasksCreated: vi.fn(),
	};
	vi.doMock(
		"../src/modules/nightworkers/components/useNightWorkersProjectNavigation",
		() => ({
			useNightWorkersProjectNavigation: () => navigation,
		}),
	);
	const openQuestionnaireWorkspace = vi.fn();
	vi.doMock(
		"../src/modules/nightworkers/components/useNightWorkersQuestionnaire",
		() => ({
			useNightWorkersQuestionnaire: () => ({ openQuestionnaireWorkspace }),
		}),
	);
	const isImplementationLockedStatus = vi.fn(
		(status: unknown) => status === "locked" || status === "running",
	);
	const isMissionProposalApprovalRequiredError = vi.fn(
		(error: unknown) =>
			(error as { code?: string })?.code === "MISSION_APPROVAL_REQUIRED",
	);
	const resolvePlanWorkspaceInitialTab = vi.fn((tab: unknown) =>
		typeof tab === "string" ? tab : "status",
	);
	vi.doMock(
		"../src/modules/nightworkers/components/nightworkers-shell-utils",
		() => ({
			isImplementationLockedStatus,
			isMissionProposalApprovalRequiredError,
			resolvePlanWorkspaceInitialTab,
			projectEvaluationDraftStorageKey: "key",
			projectEvaluationTaskPromptDrafts: {},
		}),
	);
	function NightWorkersShellLayout() {
		return null;
	}
	vi.doMock(
		"../src/modules/nightworkers/components/NightWorkersShellLayout",
		() => ({ NightWorkersShellLayout }),
	);
	return {
		workspaceValue,
		queueState,
		evidenceQuery,
		buildEvidenceCheckArtifactFromDescriptor,
		buildEvidenceCheckArtifact,
		setPanelSizes,
		routeModel,
		markArtifactOpenStart,
		buildArtifactContext,
		buildComposerLlmSelection,
		clearComposerLlmSelectionOverride,
		preserveRef,
		navigation,
		openQuestionnaireWorkspace,
		resolvePlanWorkspaceInitialTab,
	};
}

async function render(workspaceValue: ReturnType<typeof workspace>) {
	const { NightWorkersShell } = await import(
		"../src/modules/nightworkers/components/NightWorkersShell"
	);
	const onNavigate = vi.fn();
	const root = NightWorkersShell({
		routeState: {
			kind: "session",
			sessionId: workspaceValue.activeSessionId,
		} as never,
		workspace: workspaceValue as never,
		onNavigate,
		onOpenFolderBrowser: vi.fn(),
	} as never) as ReactElement;
	return {
		root,
		layout: root.props,
		thread: root.props.threadPanelProps,
		onNavigate,
	};
}

describe("NightWorkers shell coverage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.stubGlobal("window", { confirm: vi.fn(() => true) });
	});

	it("projects the base route, artifacts, evidence, and interactive review flags", async () => {
		const current = workspace({
			latestRun: {
				id: "run-1",
				status: "context_compiling",
				contextSnapshot: {
					executionMode: "review",
					reviewRuntime: { contextPolicy: "codex_default" },
				},
			},
		});
		const tools = setup(
			current,
			[
				"src/file.ts",
				{ type: "artifact", artifact: planArtifact },
				null,
				"session-1",
			],
			{ evidenceData: { id: "descriptor" } },
		);
		const { layout, thread } = await render(current);
		expect(layout.visibleActiveSessionId).toBe("session-1");
		expect(layout.isPilotThoughtDockOpen).toBe(true);
		expect(thread.selectedArtifactContext).toEqual({ artifactId: "plan-1" });
		expect(thread.hideTodoArtifact).toBe(true);
		expect(thread.hasEvidenceCheckArtifact).toBe(true);
		expect(thread.canStopLatestRun).toBe(true);
		expect(tools.buildEvidenceCheckArtifactFromDescriptor).toHaveBeenCalled();
		thread.onTogglePilotThoughtDock();
		expect(setters[3]).toHaveBeenCalledWith(expect.any(Function));
	});

	it("submits to an existing session and creates a missing session with images", async () => {
		let current = workspace();
		let tools = setup(current);
		let { thread } = await render(current);
		await thread.onSubmitPrompt("hello", "implementation", [{ id: "image" }]);
		expect(current.sendWorkbenchMessage).toHaveBeenCalledWith(
			"session-1",
			"hello",
			"implementation",
			null,
			{ providerEndpointId: "endpoint", model: "model" },
			[{ id: "image" }],
		);

		current = workspace({
			activeSession: null,
			activeSessionId: null,
			activeProject: null,
			sessions: [],
		});
		tools = setup(current);
		({ thread } = await render(current));
		await thread.onSubmitPrompt("new prompt");
		expect(current.setActiveSessionId).toHaveBeenCalledWith(null);
		expect(current.createSession).toHaveBeenCalledWith(
			expect.objectContaining({ repositoryId: "repo-1", title: "New Session" }),
		);
		expect(current.sendWorkbenchMessage).toHaveBeenCalledWith(
			"new-session",
			"new prompt",
			"intake",
			null,
			expect.any(Object),
			[],
		);
		expect(tools.preserveRef.current).toBe("new-session");
		expect(tools.clearComposerLlmSelectionOverride).toHaveBeenCalled();

		current = workspace({
			projects: [],
			activeProject: null,
			activeSession: null,
			activeSessionId: null,
		});
		setup(current);
		({ thread } = await render(current));
		await thread.onSubmitPrompt("ignored");
		expect(current.createSession).not.toHaveBeenCalled();
	});

	it("opens, normalizes, and closes plan and blueprint artifacts", async () => {
		let current = workspace();
		let tools = setup(current);
		let rendered = await render(current);
		await rendered.thread.onOpenBlueprintArtifact();
		expect(tools.resolvePlanWorkspaceInitialTab).toHaveBeenCalled();
		expect(tools.markArtifactOpenStart).toHaveBeenCalled();
		expect(setters[1]).toHaveBeenCalledWith(
			expect.objectContaining({ type: "artifact" }),
		);
		expect(rendered.onNavigate).toHaveBeenCalledWith(
			expect.objectContaining({
				artifact: { kind: "plan_mode_workspace", tab: "feature_plan" },
			}),
		);

		current = workspace({ activeArtifactRefs: [blueprintArtifact] });
		tools = setup(current);
		rendered = await render(current);
		await rendered.thread.onOpenBlueprintArtifact();
		expect(rendered.onNavigate).toHaveBeenCalledWith(
			expect.objectContaining({
				artifact: { kind: "artifact_ref", artifactId: "blueprint-1" },
			}),
		);

		setup(current, [
			"",
			{ type: "artifact", artifact: blueprintArtifact },
			null,
			null,
		]);
		rendered = await render(current);
		await rendered.thread.onOpenBlueprintArtifact();
		expect(setters[1]).toHaveBeenCalledWith({ type: "closed" });
	});

	it("opens and closes review artifacts and ignores missing sessions/artifacts", async () => {
		let current = workspace();
		setup(current);
		let rendered = await render(current);
		await rendered.thread.onOpenReviewArtifact();
		expect(rendered.onNavigate).toHaveBeenCalledWith(
			expect.objectContaining({ artifact: { kind: "review_status" } }),
		);

		setup(current, [
			"",
			{ type: "artifact", artifact: reviewArtifact },
			null,
			null,
		]);
		rendered = await render(current);
		await rendered.thread.onOpenReviewArtifact();
		expect(setters[1]).toHaveBeenCalledWith({ type: "closed" });

		current = workspace({
			activeArtifactRefs: [],
			activeSession: null,
			activeSessionId: null,
		});
		setup(current);
		rendered = await render(current);
		await rendered.thread.onOpenBlueprintArtifact();
		await rendered.thread.onOpenReviewArtifact();
		expect(rendered.onNavigate).not.toHaveBeenCalled();
	});

	it("opens existing, refreshed, and absent evidence artifacts and toggles closed", async () => {
		let current = workspace();
		setup(current);
		let rendered = await render(current);
		await rendered.thread.onOpenEvidenceCheckArtifact();
		expect(rendered.onNavigate).toHaveBeenCalledWith(
			expect.objectContaining({ artifact: { kind: "evidence_check" } }),
		);

		current = workspace({ activeArtifactRefs: [], taskMessages: [] });
		const tools = setup(current, ["", { type: "closed" }, null, null], {
			refetchData: { id: "refetched" },
		});
		// Prevent the synthesized fallback from masking the refetch branch.
		tools.buildEvidenceCheckArtifact.mockReturnValue(null);
		rendered = await render(current);
		await rendered.thread.onOpenEvidenceCheckArtifact();
		expect(tools.evidenceQuery.refetch).toHaveBeenCalled();
		expect(tools.buildEvidenceCheckArtifactFromDescriptor).toHaveBeenCalled();

		setup(workspace(), [
			"",
			{ type: "artifact", artifact: evidenceArtifact },
			null,
			null,
		]);
		rendered = await render(workspace());
		await rendered.thread.onOpenEvidenceCheckArtifact();
		expect(setters[1]).toHaveBeenCalledWith({ type: "closed" });
	});

	it("toggles Todo, starts sessions, and refuses implementation-locked tasks", async () => {
		let current = workspace();
		setup(current);
		let rendered = await render(current);
		rendered.thread.onOpenTodoArtifact();
		expect(setters[1]).toHaveBeenCalledWith({ type: "todo" });
		await rendered.thread.startSessionAndFocusTodo("session-1");
		expect(current.startRun).toHaveBeenCalledWith("session-1");

		setup(current, ["", { type: "todo" }, null, null]);
		rendered = await render(current);
		rendered.thread.onOpenTodoArtifact();
		expect(setters[1]).toHaveBeenCalledWith({ type: "closed" });

		current = workspace({
			sessions: [workspace().activeSession, { id: "locked", status: "locked" }],
		});
		setup(current);
		rendered = await render(current);
		await rendered.thread.startSessionAndFocusTodo("locked");
		expect(current.startRun).not.toHaveBeenCalled();
	});

	it("queues sessions, handles approval confirmation, and guards locked sessions", async () => {
		let current = workspace();
		let tools = setup(current, undefined, {
			queueError: { code: "MISSION_APPROVAL_REQUIRED" },
		});
		let rendered = await render(current);
		await rendered.layout.onQueueSession("session-1");
		expect(
			tools.queueState.createImplementationQueueEntry,
		).toHaveBeenNthCalledWith(2, "session-1", { approveMissionProposal: true });
		await rendered.layout.onQueueSessionAndFocusTodo("session-1");
		await rendered.thread.queueActiveSessionAndFocusTodo();
		await rendered.thread.addActiveSessionToQueue();
		expect(rendered.onNavigate).toHaveBeenCalledWith(
			expect.objectContaining({ artifact: { kind: "todo" } }),
		);

		vi.mocked(window.confirm).mockReturnValue(false);
		tools = setup(current, undefined, {
			queueError: { code: "MISSION_APPROVAL_REQUIRED" },
		});
		rendered = await render(current);
		await expect(rendered.layout.onQueueSession("session-1")).rejects.toEqual({
			code: "MISSION_APPROVAL_REQUIRED",
		});

		tools = setup(current, undefined, { queueError: new Error("other") });
		rendered = await render(current);
		await expect(rendered.layout.onQueueSession("session-1")).rejects.toThrow(
			"other",
		);

		current = workspace({
			activeSession: { ...workspace().activeSession, status: "locked" },
		});
		setup(current);
		rendered = await render(current);
		await rendered.thread.addActiveSessionToQueue();
		expect(current.setActiveSessionId).not.toHaveBeenCalled();
	});

	it("closes stale and unavailable selected artifacts through effects", async () => {
		let current = workspace({ activeSessionId: "other-session" });
		setup(current, [
			"",
			{ type: "artifact", artifact: planArtifact },
			null,
			null,
		]);
		await render(current);
		effects.at(-1)?.();
		expect(setters[1]).toHaveBeenCalledWith({ type: "closed" });

		current = workspace({ activeArtifactRefs: [] });
		setup(current, [
			"",
			{ type: "artifact", artifact: blueprintArtifact },
			null,
			null,
		]);
		await render(current);
		effects.at(-1)?.();
		expect(setters[1]).toHaveBeenCalledWith({ type: "closed" });

		setup(current, [
			"",
			{ type: "artifact", artifact: { ...blueprintArtifact, kind: "diff" } },
			null,
			null,
		]);
		await render(current);
		effects.at(-1)?.();
		expect(setters[1]).not.toHaveBeenCalled();
	});

	it("clears selected artifact context and computes route-screen visibility", async () => {
		const current = workspace();
		const tools = setup(current, [
			"",
			{ type: "artifact", artifact: planArtifact },
			"plan-1",
			null,
		]);
		tools.routeModel.showSettings = true;
		const { layout, thread } = await render(current);
		expect(layout.visibleActiveSessionId).toBeNull();
		expect(thread.selectedArtifactContext).toBeNull();
		effects[0]();
		expect(refs[1].current).toBe(current);
	});
});
