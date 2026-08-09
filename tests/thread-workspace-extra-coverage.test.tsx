import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Effect = () => undefined | (() => void);

let stateSlots: unknown[] = [];
let refSlots: Array<{ current: unknown }> = [];
let stateCursor = 0;
let refCursor = 0;
let effects: Effect[] = [];
let layoutEffects: Array<() => void> = [];
let groupRef: { current: { setLayout: ReturnType<typeof vi.fn> } | null };
let resizeCallbacks: Array<() => void> = [];
let resizeObservers: Array<{
	disconnect: ReturnType<typeof vi.fn>;
	observe: ReturnType<typeof vi.fn>;
}> = [];

const scrollMocks = {
	buildPersistedScrollState: vi.fn(),
	createScrollSnapshot: vi.fn(),
	loadPersistedScrollState: vi.fn(),
	persistScrollState: vi.fn(),
	readScrollSnapshot: vi.fn(),
	resolveEffectiveScrollState: vi.fn(),
	resolveRestoredScrollTop: vi.fn(),
	restoreScrollState: vi.fn(),
	shouldKeepPendingRestore: vi.fn(),
};
const logArtifactPerf = vi.fn();

async function createHarness() {
	stateSlots = [];
	refSlots = [];
	stateCursor = 0;
	refCursor = 0;
	effects = [];
	layoutEffects = [];
	resizeCallbacks = [];
	resizeObservers = [];
	groupRef = { current: { setLayout: vi.fn(() => true) } };
	for (const mock of Object.values(scrollMocks)) mock.mockReset();
	logArtifactPerf.mockReset();
	const snapshot = {
		scrollTop: 100,
		maxScrollTop: 700,
		distanceFromBottom: 600,
		wasNearBottom: false,
	};
	scrollMocks.readScrollSnapshot.mockReturnValue(snapshot);
	scrollMocks.buildPersistedScrollState.mockReturnValue({
		mode: "manual",
		snapshot,
	});
	scrollMocks.resolveEffectiveScrollState.mockImplementation(
		(state: unknown, forceLatestFocus: boolean) =>
			forceLatestFocus ? { mode: "bottom" } : state,
	);
	scrollMocks.shouldKeepPendingRestore.mockReturnValue(false);
	scrollMocks.restoreScrollState.mockImplementation(
		(node: {
			scrollTop: number;
			scrollHeight: number;
			clientHeight: number;
		}) => {
			node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
		},
	);
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useEffect: (effect: Effect) => effects.push(effect),
			useLayoutEffect: (effect: () => void) => layoutEffects.push(effect),
			useMemo: <T,>(factory: () => T) => factory(),
			useRef: <T,>(initial: T) => {
				const index = refCursor++;
				refSlots[index] ??= { current: initial };
				return refSlots[index] as { current: T };
			},
			useState: <T,>(initial: T) => {
				const index = stateCursor++;
				if (stateSlots.length <= index) stateSlots[index] = initial;
				const setter = vi.fn((next: T | ((current: T) => T)) => {
					stateSlots[index] =
						typeof next === "function"
							? (next as (current: T) => T)(stateSlots[index] as T)
							: next;
				});
				return [stateSlots[index] as T, setter] as const;
			},
		};
	});
	vi.doMock("react-i18next", () => ({
		useTranslation: () => ({ t: (key: string) => key }),
	}));
	vi.doMock("react-resizable-panels", () => ({
		Group: "panel-group",
		Panel: "panel",
		Separator: "separator",
		useGroupRef: () => groupRef,
	}));
	vi.doMock(
		"../src/modules/nightworkers/components/ThreadWorkspaceBanner",
		() => ({
			WorkbenchStateBanner: "workbench-banner",
		}),
	);
	vi.doMock(
		"../src/modules/nightworkers/components/ThreadWorkspaceBody",
		() => ({
			ThreadBody: "thread-body",
		}),
	);
	vi.doMock(
		"../src/modules/nightworkers/components/ThreadWorkspaceHeader",
		() => ({
			ThreadWorkspaceHeader: "workspace-header",
		}),
	);
	vi.doMock("../src/modules/nightworkers/artifactPerformance", () => ({
		logArtifactPerf,
	}));
	vi.doMock(
		"../src/modules/nightworkers/components/ThreadWorkspaceScrollState",
		() => scrollMocks,
	);

	class ResizeObserverMock {
		disconnect = vi.fn();
		observe = vi.fn();

		constructor(callback: () => void) {
			resizeCallbacks.push(callback);
			resizeObservers.push(this);
		}
	}
	vi.stubGlobal("ResizeObserver", ResizeObserverMock);

	const module = await import(
		"../src/modules/nightworkers/components/ThreadWorkspace"
	);
	return {
		...module,
		useWorkspace(input: ReturnType<typeof props>) {
			stateCursor = 0;
			refCursor = 0;
			effects = [];
			layoutEffects = [];
			return module.ThreadWorkspace(input as never) as ReactElement;
		},
	};
}

function props(overrides: Record<string, unknown> = {}) {
	return {
		activeSession: null,
		sessionView: null,
		activeProject: null,
		runs: [],
		taskMessages: [],
		latestRunEvents: [],
		llmUsageSummary: null,
		activityEvents: [],
		activityArtifacts: [],
		activeStreamingResponse: "",
		backgroundProcesses: undefined,
		artifactRefs: [],
		activeArtifactContext: null,
		isAgentWorking: false,
		isAgentThinking: false,
		realtimeStatus: "connected",
		model: "gpt-5.3",
		thinkingDepth: "high",
		thinkingDepthOptions: [],
		onModelChange: vi.fn(),
		modelOptions: [],
		onThinkingDepthChange: vi.fn(),
		onSubmitInitialPrompt: vi.fn(async () => undefined),
		onSubmitWorkbenchMessage: vi.fn(async () => undefined),
		onStopActiveRun: undefined,
		onStopBackgroundProcess: undefined,
		onOpenBlueprintArtifact: vi.fn(async () => undefined),
		isBlueprintArtifactOpen: false,
		isBlueprintActionBusy: false,
		onOpenReviewArtifact: vi.fn(async () => undefined),
		isReviewArtifactOpen: false,
		hasReviewArtifact: false,
		isReviewActionBusy: false,
		onOpenEvidenceCheckArtifact: vi.fn(),
		isEvidenceCheckArtifactOpen: false,
		onOpenTodoArtifact: vi.fn(),
		isTodoArtifactOpen: false,
		hasTodoArtifact: false,
		hasEvidenceCheckArtifact: false,
		onDeleteSession: vi.fn(),
		onQueueSession: vi.fn(),
		onRemoveQueueEntry: vi.fn(),
		onRequeueQueueEntry: vi.fn(),
		onOpenArtifact: vi.fn(),
		onOpenProjectFile: undefined,
		onClearArtifactContext: undefined,
		isProjectFilesOpen: false,
		onOpenProjectFiles: vi.fn(),
		onTogglePilotThoughtDock: undefined,
		onGrantExternalPath: vi.fn(async () => undefined),
		splitPanel: undefined,
		...overrides,
	};
}

function elements(node: ReactNode): ReactElement[] {
	if (
		node === null ||
		node === undefined ||
		typeof node === "boolean" ||
		typeof node === "string" ||
		typeof node === "number"
	)
		return [];
	if (Array.isArray(node)) return node.flatMap(elements);
	const element = node as ReactElement<{ children?: ReactNode }>;
	return [element, ...elements(element.props?.children)];
}

function requiredElement(root: ReactElement, type: string) {
	const element = elements(root).find((candidate) => candidate.type === type);
	if (!element) throw new Error(`Element not found: ${type}`);
	return element;
}

function scrollNode(overrides: Record<string, unknown> = {}) {
	return {
		scrollTop: 100,
		scrollHeight: 1000,
		clientHeight: 300,
		...overrides,
	} as HTMLDivElement;
}

describe("ThreadWorkspace extra coverage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-09T00:00:00.000Z"));
	});

	it("renders empty and split layouts with the expected child props", async () => {
		const harness = await createHarness();
		let root = harness.useWorkspace(props());
		let body = requiredElement(root, "thread-body");
		const header = requiredElement(root, "workspace-header");
		expect(body.props.workbenchBanner).toBeNull();
		expect(header.props.blueprintArtifact).toBeUndefined();
		expect(header.props.debugModeTooltipLabel).toBe("thread.tooltip.debugMode");
		expect(header.props.pilotThoughtTooltipLabel).toBe(
			"thread.tooltip.pilotThought",
		);
		const separator = requiredElement(root, "separator");
		expect(separator.props).toMatchObject({
			disabled: true,
			style: { width: 0, pointerEvents: "none" },
		});
		const panels = elements(root).filter((element) => element.type === "panel");
		expect(panels[0].props).toMatchObject({
			defaultSize: "100%",
			minSize: "38%",
		});
		expect(panels[1].props).toMatchObject({ defaultSize: "0%", minSize: "0%" });

		const splitPanel = <aside>artifact</aside>;
		root = harness.useWorkspace(
			props({
				activeSession: { id: "task-1" },
				sessionView: { state: "running" },
				splitPanel,
				artifactRefs: [
					{ id: "blueprint", kind: "app_blueprint" },
					{ id: "plan", kind: "plan_mode_workspace" },
				],
			}),
		);
		body = requiredElement(root, "thread-body");
		expect(body.props.workbenchBanner.type).toBe("workbench-banner");
		expect(
			requiredElement(root, "workspace-header").props.blueprintArtifact,
		).toMatchObject({ id: "plan" });
		expect(requiredElement(root, "separator").props).toMatchObject({
			disabled: false,
			style: undefined,
		});
		const splitPanels = elements(root).filter(
			(element) => element.type === "panel",
		);
		expect(splitPanels[0].props.defaultSize).toBe("50%");
		expect(splitPanels[1].props).toMatchObject({
			defaultSize: "50%",
			minSize: "28%",
		});
		expect(splitPanels[1].props.children).toBe(splitPanel);
	});

	it("throttles artifact callbacks and clears cooldown timers", async () => {
		const harness = await createHarness();
		const onOpenArtifact = vi.fn();
		const onOpenEvidenceCheckArtifact = vi.fn();
		const onOpenReviewArtifact = vi.fn(async () => undefined);
		let root = harness.useWorkspace(
			props({
				onOpenArtifact,
				onOpenEvidenceCheckArtifact,
				onOpenReviewArtifact,
			}),
		);
		let body = requiredElement(root, "thread-body");
		const artifact = { id: "artifact-1", kind: "app_blueprint" };
		body.props.onOpenArtifact(artifact);
		expect(onOpenArtifact).toHaveBeenCalledWith(artifact);
		expect(stateSlots[1]).toBe(true);

		body.props.onOpenEvidenceCheckArtifact();
		expect(onOpenEvidenceCheckArtifact).not.toHaveBeenCalled();
		vi.setSystemTime(new Date("2026-08-09T00:00:00.701Z"));
		body.props.onOpenEvidenceCheckArtifact();
		expect(onOpenEvidenceCheckArtifact).toHaveBeenCalledOnce();
		vi.setSystemTime(new Date("2026-08-09T00:00:01.402Z"));
		body.props.onOpenReviewModeArtifact();
		expect(onOpenReviewArtifact).toHaveBeenCalledOnce();

		root = harness.useWorkspace(props());
		expect(
			requiredElement(root, "workspace-header").props
				.artifactButtonsCoolingDown,
		).toBe(true);
		vi.runAllTimers();
		expect(stateSlots[1]).toBe(false);

		body = requiredElement(root, "thread-body");
		expect(body.props.onOpenProjectFile).toBeUndefined();
		expect(body.props.onClearArtifactContext).toBeUndefined();
		const cleanup = effects[0]();
		cleanup?.();
	});

	it("attaches and replaces ResizeObservers across scroll container refs", async () => {
		const harness = await createHarness();
		const root = harness.useWorkspace(
			props({ activeSession: { id: "task-1" } }),
		);
		const body = requiredElement(root, "thread-body");
		const first = scrollNode();
		body.props.scrollContainerRef(first);
		expect(resizeObservers).toHaveLength(1);
		expect(resizeObservers[0].observe).toHaveBeenCalledWith(first);

		resizeCallbacks[0]();
		expect(scrollMocks.restoreScrollState).not.toHaveBeenCalled();
		first.scrollHeight = 1200;
		resizeCallbacks[0]();
		expect(scrollMocks.restoreScrollState).toHaveBeenCalled();
		expect(scrollMocks.persistScrollState).toHaveBeenCalledWith(
			"task-1",
			expect.any(Object),
		);

		refSlots[2].current = null;
		resizeCallbacks[0]();
		refSlots[2].current = first;
		refSlots[7].current = null;
		resizeCallbacks[0]();

		const second = scrollNode({ scrollHeight: 1400 });
		body.props.scrollContainerRef(second);
		expect(resizeObservers[0].disconnect).toHaveBeenCalled();
		expect(resizeObservers[1].observe).toHaveBeenCalledWith(second);
		body.props.scrollContainerRef(null);
		expect(resizeObservers[1].disconnect).toHaveBeenCalled();

		vi.stubGlobal("ResizeObserver", undefined);
		body.props.scrollContainerRef(first);
		expect(resizeObservers).toHaveLength(2);
	});

	it("handles suppressed, manual, and forced-latest scroll events", async () => {
		const harness = await createHarness();
		let root = harness.useWorkspace(props({ activeSession: { id: "task-1" } }));
		let body = requiredElement(root, "thread-body");
		body.props.onScroll();

		const node = scrollNode({ scrollTop: 200 });
		body.props.scrollContainerRef(node);
		refSlots[5].current = 200.5;
		body.props.onScroll();
		expect(refSlots[5].current).toBeNull();

		refSlots[5].current = 100;
		refSlots[4].current = { mode: "bottom" };
		body.props.onScroll();
		expect(scrollMocks.readScrollSnapshot).toHaveBeenCalledWith(node);
		expect(refSlots[4].current).toBeNull();
		expect(scrollMocks.persistScrollState).toHaveBeenCalledWith(
			"task-1",
			expect.any(Object),
		);

		root = harness.useWorkspace(
			props({ activeSession: { id: "task-1" }, isAgentThinking: true }),
		);
		body = requiredElement(root, "thread-body");
		refSlots[2].current = node;
		refSlots[5].current = null;
		body.props.onScroll();
		expect(refSlots[3].current).toEqual({ mode: "bottom" });

		root = harness.useWorkspace(props());
		body = requiredElement(root, "thread-body");
		refSlots[2].current = node;
		body.props.onScroll();
		expect(scrollMocks.persistScrollState).not.toHaveBeenCalledWith(
			"",
			expect.anything(),
		);
	});

	it("restores persisted and latest-focused scroll state in layout effects", async () => {
		const harness = await createHarness();
		harness.useWorkspace(props());
		layoutEffects[0]();
		expect(refSlots[3].current).toEqual({ mode: "bottom" });
		layoutEffects[1]();
		layoutEffects[2]();

		const manual = {
			mode: "manual",
			snapshot: {
				scrollTop: 100,
				maxScrollTop: 700,
				distanceFromBottom: 600,
				wasNearBottom: false,
			},
		};
		scrollMocks.loadPersistedScrollState.mockReturnValue(manual);
		harness.useWorkspace(props({ activeSession: { id: "task-1" } }));
		const node = scrollNode();
		refSlots[2].current = node;
		layoutEffects[0]();
		expect(scrollMocks.loadPersistedScrollState).toHaveBeenCalledWith("task-1");
		expect(scrollMocks.restoreScrollState).toHaveBeenCalledWith(node, manual);
		expect(refSlots[4].current).toBeNull();
		layoutEffects[1]();

		harness.useWorkspace(
			props({ activeSession: { id: "task-1" }, isAgentThinking: true }),
		);
		refSlots[2].current = node;
		layoutEffects[0]();
		layoutEffects[1]();
		expect(scrollMocks.restoreScrollState).toHaveBeenCalledWith(node, {
			mode: "bottom",
		});
		expect(scrollMocks.persistScrollState).toHaveBeenCalledWith("task-1", {
			mode: "bottom",
		});
		expect(refSlots[7].current).toEqual({
			clientHeight: 300,
			scrollHeight: 1000,
		});
	});

	it("reapplies panel layout when switching between single and split modes", async () => {
		const harness = await createHarness();
		harness.useWorkspace(props());
		const node = scrollNode();
		refSlots[2].current = node;
		layoutEffects[2]();
		expect(groupRef.current?.setLayout).not.toHaveBeenCalled();

		harness.useWorkspace(props({ splitPanel: <aside>artifact</aside> }));
		refSlots[2].current = node;
		layoutEffects[2]();
		expect(groupRef.current?.setLayout).toHaveBeenCalledWith({
			"nightworkers-thread-main": 50,
			"nightworkers-artifact": 50,
		});
		expect(logArtifactPerf).toHaveBeenCalledWith(
			"threadWorkspace.layoutModeChanged",
			expect.objectContaining({
				from: "single",
				to: "split",
				appliedLayout: true,
			}),
		);

		groupRef.current = null;
		harness.useWorkspace(props());
		refSlots[2].current = node;
		layoutEffects[2]();
		expect(logArtifactPerf).toHaveBeenLastCalledWith(
			"threadWorkspace.layoutModeChanged",
			expect.objectContaining({ appliedLayout: undefined }),
		);
	});
});
