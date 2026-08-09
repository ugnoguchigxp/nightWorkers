import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
	stateValues: [] as unknown[],
	setters: [] as Array<ReturnType<typeof vi.fn>>,
	queryIndex: 0,
	workspace: null as Record<string, unknown> | null | undefined,
	sessions: undefined as unknown[] | undefined,
	workspaceRefetchData: undefined as unknown,
	sessionsRefetchData: undefined as unknown,
	queryPrevious: undefined as unknown,
	workspaceMessages: {} as Record<string, unknown>,
	viewDecisions: [] as Array<Record<string, unknown>>,
	capabilities: {} as Record<string, boolean>,
	visibleTabs: ["status"] as string[],
	generation: { status: "idle", messageId: null } as Record<string, unknown>,
	projectionKey: null as string | null,
	initialTabUpdate: null as string | null,
	shouldOpen: false,
	shouldStart: false,
	completedSession: false,
	completedStatus: false,
	workspaceActionsArgs: null as Record<string, unknown> | null,
	questionnaireArgs: null as Record<string, unknown> | null,
	artifactArgs: null as Record<string, unknown> | null,
	outputsArgs: null as Record<string, unknown> | null,
	routingArgs: null as Record<string, unknown> | null,
	viewProps: null as Record<string, unknown> | null,
	setQueryData: vi.fn(),
	refetchWorkspace: vi.fn(),
	refetchSessions: vi.fn(),
	onResetScroll: vi.fn(),
	runAction: vi.fn(),
	runSessionAction: vi.fn(),
	startQuestionnaire: vi.fn(),
	submitAnswers: vi.fn(),
	requestQuestions: vi.fn(),
	generateArtifact: vi.fn(),
	generateViews: vi.fn(),
	repairView: vi.fn(),
	updateRouting: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
			callback,
		useEffect: (callback: () => undefined | (() => void)) => {
			callback();
		},
		useMemo: <T,>(factory: () => T) => factory(),
		useRef: <T,>(initial: T) => ({ current: initial }),
		useState: <T,>(initial: T | (() => T)) => {
			const value =
				controls.stateValues.length > 0
					? (controls.stateValues.shift() as T)
					: typeof initial === "function"
						? (initial as () => T)()
						: initial;
			const setter = vi.fn((next: T | ((previous: T) => T)) => {
				if (typeof next === "function") {
					return (next as (previous: T) => T)(value);
				}
				return next;
			});
			controls.setters.push(setter);
			return [value, setter] as const;
		},
	};
});

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({
		setQueryData: controls.setQueryData,
	}),
	useQuery: () => {
		controls.queryIndex += 1;
		return controls.queryIndex % 2 === 1
			? { data: controls.workspace, refetch: controls.refetchWorkspace }
			: { data: controls.sessions, refetch: controls.refetchSessions };
	},
}));

vi.mock("../src/modules/questionnaire", () => ({
	designQuestionnaireSessionsQueryKey: (sessionId: string) => [
		"questionnaires",
		sessionId,
	],
	designQuestionnaireSessionsQueryOptions: (sessionId: string) => ({
		sessionId,
	}),
	getQuestionnaireSessionProjectionKey: () => controls.projectionKey,
}));

vi.mock("../src/modules/specification", () => ({
	getPlanModeCapabilities: () => controls.capabilities,
	planModeWorkspaceQueryOptions: (sessionId: string) => ({ sessionId }),
	resolvePlanWorkspaceViewDecisions: () => controls.viewDecisions,
	selectPlanModeWorkspaceMessages: () => controls.workspaceMessages,
}));

vi.mock("../src/modules/planMode/PlanModeQuestionnaire", () => ({
	getAnswerProgress: (groups: unknown[], answers: Record<string, unknown>) => ({
		groupCount: groups.length,
		answerCount: Object.keys(answers).length,
	}),
	getQuestionnaireSubmissionState: (args: Record<string, unknown>) => args,
	getUnansweredQuestions: (groups: unknown[]) =>
		groups.length > 0 ? [{ id: "unanswered" }] : [],
}));

vi.mock("../src/modules/planMode/PlanModeWorkspace.controller", () => ({
	usePlanWorkspaceActions: (args: Record<string, unknown>) => {
		controls.workspaceActionsArgs = args;
		return {
			runAction: controls.runAction,
			runSessionAction: controls.runSessionAction,
		};
	},
}));

vi.mock("../src/modules/planMode/PlanModeWorkspaceView", () => ({
	PlanModeWorkspaceView: (props: Record<string, unknown>) => {
		controls.viewProps = props;
		return null;
	},
}));

vi.mock("../src/modules/planMode/PlanModeWorkspaceViewer.helpers", () => ({
	extractViewDecisions: () => [{ view: "blueprint", decision: "include" }],
	isCompletedQuestionnaireSession: () => controls.completedSession,
	isCompletedStatus: () => controls.completedStatus,
}));

vi.mock("../src/modules/planMode/PlanModeWorkspaceViewer.model", () => ({
	buildVisiblePlanWorkspaceTabs: () => controls.visibleTabs,
	resetPlanWorkspaceScrollToTop: (
		getElement: () => unknown,
		windowValue: unknown,
	) => {
		getElement();
		controls.onResetScroll(windowValue);
	},
	resolveInitialPlanWorkspaceTabUpdate: () => controls.initialTabUpdate,
	resolveQuestionnaireGenerationState: () => controls.generation,
	shouldOpenQuestionnaireForEmptyBlueprint: () => controls.shouldOpen,
	shouldShowQuestionnaireStartAction: () => controls.shouldStart,
}));

vi.mock("../src/modules/planMode/usePlanModeArtifactGeneration", () => ({
	usePlanModeArtifactGenerationForWorkspace: (
		args: Record<string, unknown>,
	) => {
		controls.artifactArgs = args;
		return {
			activeDedicatedView: "api_io_contract",
			activeDedicatedArtifact: { id: "dedicated-artifact" },
			activeDedicatedMessage: { id: "dedicated-message" },
			generatePlanModeArtifact: controls.generateArtifact,
			generateDedicatedViews: controls.generateViews,
			repairDedicatedViewAfterMermaidFailure: controls.repairView,
		};
	},
}));

vi.mock("../src/modules/planMode/usePlanModeGeneralSettings", () => ({
	usePlanModeGeneralSettings: () => ({ planMode: controls.capabilities }),
}));

vi.mock("../src/modules/planMode/usePlanModeQuestionnaireActions", () => ({
	usePlanModeQuestionnaireActions: (args: Record<string, unknown>) => {
		controls.questionnaireArgs = args;
		return {
			startQuestionnaire: controls.startQuestionnaire,
			submitAnswersForNextStep: controls.submitAnswers,
			requestAdditionalQuestionnaireQuestions: controls.requestQuestions,
		};
	},
}));

vi.mock("../src/modules/planMode/usePlanModeRoutingEditor", () => ({
	usePlanModeRoutingEditor: (args: Record<string, unknown>) => {
		controls.routingArgs = args;
		return controls.updateRouting;
	},
}));

vi.mock("../src/modules/planMode/usePlanModeWorkspaceOutputs", () => ({
	usePlanModeWorkspaceOutputs: (args: Record<string, unknown>) => {
		controls.outputsArgs = args;
	},
}));

import { PlanModeWorkspaceViewer } from "../src/modules/planMode/PlanModeWorkspaceViewer";

const message = (id: string) => ({ id, content: id });

function questionnaireSession(
	id: string,
	status: string,
	withQuestionnaire = true,
) {
	return {
		id,
		status,
		answers: [{ questionId: "q-1", answer: { freeText: id } }],
		questionSets: [
			withQuestionnaire
				? { questionnaire: { questionSets: [{ id: `${id}-group` }] } }
				: { questionnaire: null },
		],
	};
}

function workspace(overrides: Record<string, unknown> = {}) {
	return {
		featurePlanArtifacts: [],
		questionnaireSessions: [],
		blueprintArtifacts: [],
		dataModelArtifacts: [],
		dedicatedViewArtifacts: [],
		...overrides,
	};
}

function setDefaultMessages(overrides: Record<string, unknown> = {}) {
	controls.workspaceMessages = {
		blueprintMessages: [],
		designDocMessages: [],
		activeFeaturePlanMessage: null,
		activeBlueprintMessage: null,
		activeDataModelMessage: null,
		activeBlueprintSourceMessageId: null,
		combinedTaskMessages: [],
		...overrides,
	};
}

async function settleEffects() {
	await Promise.resolve();
	await Promise.resolve();
}

beforeEach(() => {
	vi.stubGlobal("window", { scrollTo: vi.fn() });
	controls.stateValues = [];
	controls.setters = [];
	controls.queryIndex = 0;
	controls.workspace = null;
	controls.sessions = undefined;
	controls.workspaceRefetchData = undefined;
	controls.sessionsRefetchData = undefined;
	controls.queryPrevious = undefined;
	controls.viewDecisions = [];
	controls.capabilities = {
		questionnaire: true,
		feature_plan: true,
		blueprint: true,
		data_model: true,
	};
	controls.visibleTabs = ["status"];
	controls.generation = { status: "idle", messageId: null };
	controls.projectionKey = null;
	controls.initialTabUpdate = null;
	controls.shouldOpen = false;
	controls.shouldStart = false;
	controls.completedSession = false;
	controls.completedStatus = false;
	controls.workspaceActionsArgs = null;
	controls.questionnaireArgs = null;
	controls.artifactArgs = null;
	controls.outputsArgs = null;
	controls.routingArgs = null;
	controls.viewProps = null;
	setDefaultMessages();
	vi.clearAllMocks();
	controls.setQueryData.mockImplementation((_key: unknown, updater: unknown) =>
		typeof updater === "function"
			? (updater as (value: unknown) => unknown)(controls.queryPrevious)
			: updater,
	);
	controls.refetchWorkspace.mockImplementation(async () => ({
		data: controls.workspaceRefetchData,
	}));
	controls.refetchSessions.mockImplementation(async () => ({
		data: controls.sessionsRefetchData,
	}));
});

describe("PlanModeWorkspaceViewer extra coverage", () => {
	it("projects a rich accepted session and exposes all artifact and status props", async () => {
		const first = questionnaireSession("session-1", "draft", false);
		const active = questionnaireSession("session-2", "accepted");
		controls.workspace = workspace({
			featurePlanArtifacts: [{ id: "feature-artifact" }],
			questionnaireSessions: [
				{ id: "session-2", status: "accepted" },
				{ id: "summary-fallback", status: "draft" },
			],
			blueprintArtifacts: [{ id: "blueprint-artifact" }],
			dataModelArtifacts: [{ id: "data-artifact" }],
			dedicatedViewArtifacts: [{ id: "dedicated-artifact" }],
			routing: { mode: "manual" },
		});
		controls.sessions = [first, active];
		controls.workspaceRefetchData = controls.workspace;
		controls.sessionsRefetchData = controls.sessions;
		controls.stateValues = [
			"blueprint",
			"session-2",
			{ "q-1": { freeText: "existing" } },
			"generating-blueprint",
			"action failed",
			"action complete",
			new Set(["session-2"]),
			[message("generated")],
		];
		setDefaultMessages({
			blueprintMessages: [message("blueprint-list")],
			designDocMessages: [message("old-design"), message("feature-fallback")],
			activeBlueprintMessage: message("blueprint"),
			activeDataModelMessage: message("data-model"),
			activeBlueprintSourceMessageId: "blueprint-source",
			combinedTaskMessages: [message("combined")],
		});
		controls.viewDecisions = [
			{ view: "blueprint", decision: "include" },
			{ view: "data_model", decision: "exclude" },
		];
		controls.visibleTabs = ["blueprint", "status", "questionnaire"];
		controls.generation = { status: "ready", messageId: "ready-message" };
		controls.projectionKey = "projection-2";
		controls.initialTabUpdate = "blueprint";
		controls.shouldStart = true;
		controls.completedSession = true;

		const onTabChange = vi.fn();
		const onArtifactContextChange = vi.fn();
		const onExportDescriptorChange = vi.fn();
		const onQueueSession = vi.fn();
		const onAddToQueue = vi.fn();
		const element = PlanModeWorkspaceViewer({
			sessionId: "task-1",
			taskMessages: [message("task") as never],
			activityArtifacts: [{ id: "activity" } as never],
			initialTab: "blueprint",
			onTabChange,
			onArtifactContextChange,
			onExportDescriptorChange,
			onQueueSession,
			onAddToQueue,
			isImplementationLocked: true,
		});
		await settleEffects();

		const props = (element as { props: Record<string, unknown> }).props;
		expect(props).toMatchObject({
			activeTab: "blueprint",
			hasFeaturePlan: true,
			canGenerateDataModel: true,
			showQuestionnaireStartAction: true,
			isQuestionnaireGenerating: false,
			actionError: "action failed",
			actionNotice: "action complete",
			activeQuestionnaireSummary: { id: "session-2" },
			activeDedicatedView: "api_io_contract",
		});
		expect(controls.artifactArgs).toMatchObject({
			featurePlanMessage: { id: "feature-fallback" },
			activeBlueprintSourceMessageId: "blueprint-source",
		});
		expect(controls.outputsArgs).toMatchObject({
			readyQuestionnaireSessionId: "session-2",
			onArtifactContextChange,
			onExportDescriptorChange,
		});
		expect(props.onQueueSession).toBe(onQueueSession);
		expect(props.onAddToQueue).toBe(onAddToQueue);

		(props.selectActiveTab as (tab: string) => void)("blueprint");
		expect(onTabChange).not.toHaveBeenCalled();
		(props.selectActiveTab as (tab: string) => void)("status");
		expect(onTabChange).toHaveBeenCalledWith("status");
		(
			props.onSelectSession as (
				session: ReturnType<typeof questionnaireSession>,
			) => void
		)(first);
		expect(controls.setters[1]).toHaveBeenCalledWith("session-1");
		expect(controls.setters[2]).toHaveBeenCalled();
		(props.handleQuestionnaireAnswersChange as (answers: object) => void)({});
		expect(controls.setters[2]).toHaveBeenCalledWith({});

		const actionCallbacks = controls.workspaceActionsArgs as {
			resetWorkspaceScrollTop: () => void;
			refresh: (options?: {
				preserveGeneratedBlueprintFocus?: boolean;
			}) => Promise<void>;
		};
		actionCallbacks.resetWorkspaceScrollTop();
		expect(controls.onResetScroll).toHaveBeenCalledWith(window);
		controls.shouldOpen = true;
		await actionCallbacks.refresh({ preserveGeneratedBlueprintFocus: true });
		expect(controls.refetchWorkspace).toHaveBeenCalled();
	});

	it("handles undefined queries, empty selections, generating state, and optional callbacks", async () => {
		controls.capabilities = {
			questionnaire: false,
			feature_plan: false,
			blueprint: false,
			data_model: false,
		};
		controls.generation = { status: "generating", messageId: "generation" };
		controls.projectionKey = "empty-projection";
		controls.shouldStart = true;
		controls.stateValues = [
			"questionnaire",
			null,
			{},
			null,
			null,
			null,
			new Set(),
			[],
		];

		const element = PlanModeWorkspaceViewer({
			sessionId: "",
			taskMessages: [],
		});
		await settleEffects();
		const props = (element as { props: Record<string, unknown> }).props;

		expect(props).toMatchObject({
			activeTab: "questionnaire",
			featurePlanMessage: null,
			activeQuestionnaireSession: null,
			activeQuestionnaireSummary: null,
			canGenerateDataModel: false,
			hasFeaturePlan: false,
			showQuestionnaireStartAction: false,
			isQuestionnaireGenerating: true,
		});
		expect(controls.setters[1]).toHaveBeenCalledWith(null);
		expect(controls.setters[2]).toHaveBeenCalledWith({});
		expect(controls.refetchWorkspace).not.toHaveBeenCalled();
		expect(controls.outputsArgs).toMatchObject({
			readyQuestionnaireSessionId: null,
			viewDecisions: [],
		});
		(props.selectActiveTab as (tab: string) => void)("status");
	});

	it("falls back across session, summary, feature plan, and hidden tab selections", async () => {
		const selected = questionnaireSession("session-first", "review_ready");
		controls.sessions = [selected];
		controls.workspace = workspace({
			questionnaireSessions: [{ id: "other", status: "complete" }],
		});
		controls.workspaceRefetchData = workspace({ blueprintArtifacts: [] });
		controls.sessionsRefetchData = [];
		controls.stateValues = [
			"hidden-tab",
			"missing-session",
			{},
			null,
			null,
			null,
			new Set(),
			[],
		];
		setDefaultMessages({
			designDocMessages: [message("only-design")],
			activeFeaturePlanMessage: message("active-feature"),
		});
		controls.visibleTabs = ["status"];
		controls.projectionKey = "first-projection";
		controls.completedStatus = true;
		controls.shouldOpen = true;

		const onTabChange = vi.fn();
		const element = PlanModeWorkspaceViewer({
			sessionId: "task-fallback",
			taskMessages: [],
			onTabChange,
		});
		await settleEffects();
		const props = (element as { props: Record<string, unknown> }).props;

		expect(props).toMatchObject({
			featurePlanMessage: { id: "active-feature" },
			activeQuestionnaireSession: { id: "session-first" },
			activeQuestionnaireSummary: { id: "other" },
		});
		expect(controls.setters[1]).toHaveBeenCalledWith("session-first");
		expect(onTabChange).toHaveBeenCalledWith("status");
		expect(controls.outputsArgs).toMatchObject({
			readyQuestionnaireSessionId: "session-first",
		});
	});

	it("applies both questionnaire cache update forms and refetch defaults", async () => {
		controls.sessions = [];
		controls.workspace = workspace();
		controls.workspaceRefetchData = undefined;
		controls.sessionsRefetchData = undefined;
		controls.projectionKey = "no-session";
		controls.stateValues = [
			"status",
			null,
			{},
			null,
			null,
			null,
			new Set(),
			[],
		];
		controls.visibleTabs = ["status"];

		PlanModeWorkspaceViewer({
			sessionId: "task-cache",
			taskMessages: [],
			initialTab: "status",
		});
		await settleEffects();
		const setSessions = controls.questionnaireArgs?.setSessions as (
			update: unknown,
		) => void;
		controls.queryPrevious = undefined;
		setSessions((previous: unknown[]) => [...previous, { id: "added" }]);
		controls.queryPrevious = [{ id: "old" }];
		setSessions([{ id: "replacement" }]);
		expect(controls.setQueryData).toHaveBeenCalledTimes(2);

		controls.shouldOpen = false;
		const { refresh } = controls.workspaceActionsArgs as {
			refresh: (options?: Record<string, unknown>) => Promise<void>;
		};
		await refresh();
		expect(controls.refetchSessions).toHaveBeenCalled();
	});
});
