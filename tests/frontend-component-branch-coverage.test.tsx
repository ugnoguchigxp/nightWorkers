import { describe, expect, it, vi } from "vitest";
import type { NightWorkersWorkspaceState } from "../src/modules/nightworkers/hooks/useNightWorkersWorkspace";
import type { WorkbenchRouteState } from "../src/modules/nightworkers/routing/workbench-route-state";
import type {
	ActivityArtifact,
	PlanModeWorkspace,
	TaskMessage,
} from "../src/modules/nightworkers/types";
import type { PlanWorkspaceTab } from "../src/modules/specification";
import {
	buildActivityArtifact,
	buildBlueprintMessage,
	buildTask,
	buildTaskMessage,
	buildTaskRun,
} from "./helpers/nightworkers-fixtures";

type StateSetter<T> = (value: T | ((previous: T) => T)) => void;

let stateValues: unknown[] = [];
let effectMode: "skip" | "run" = "skip";

function resetHookMocks(values: unknown[] = [], mode: "skip" | "run" = "skip") {
	stateValues = [...values];
	effectMode = mode;
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useEffect: (callback: () => undefined | (() => void)) => {
				if (effectMode === "run") callback();
			},
			useMemo: <T,>(factory: () => T) => factory(),
			useRef: <T,>(initial: T) => ({ current: initial }),
			useState: <T,>(initial: T | (() => T)) => {
				const value =
					stateValues.length > 0
						? (stateValues.shift() as T)
						: typeof initial === "function"
							? (initial as () => T)()
							: initial;
				const setValue: StateSetter<T> = (next) => {
					if (typeof next === "function") {
						(next as (previous: T) => T)(value);
					}
				};
				return [value, setValue] as const;
			},
		};
	});
	vi.doMock("react-i18next", async () => ({
		...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
		useTranslation: () => ({
			t: (
				key: string,
				options?: {
					defaultValue?: string;
					count?: number;
					level?: string;
				},
			) => options?.defaultValue ?? String(options?.count ?? key),
		}),
	}));
}

function stubQueueModule() {
	vi.doMock("../src/modules/codingAgent", async (importOriginal) => ({
		...(await importOriginal<typeof import("../src/modules/codingAgent")>()),
		useLatestEvidenceCheckDescriptor: () => ({
			data: null,
			refetch: vi.fn(async () => ({ data: null })),
		}),
	}));
	vi.doMock("../src/composition/mission-pilot", async (importOriginal) => ({
		...(await importOriginal<
			typeof import("../src/composition/mission-pilot")
		>()),
		useMissionPilotArtifactAutoFocus: () => undefined,
	}));
	vi.doMock("../src/modules/queue", () => ({
		ImplementationQueueScreen: () => null,
		ProjectQueueScreen: () => null,
		useImplementationQueue: () => ({
			implementationQueue: {
				entries: [],
				running: [],
				pending: [],
				completed: [],
				failed: [],
			},
			implementationQueueHealth: {
				status: "healthy",
				processorCount: 1,
				activeProcessors: 0,
				maxProcessors: 2,
			},
			isImplementationQueueLoading: false,
			isImplementationQueueHealthLoading: false,
			createImplementationQueueEntry: vi.fn(async () => undefined),
			requeueImplementationQueueEntry: vi.fn(async () => undefined),
			updateImplementationQueueEntry: vi.fn(async () => undefined),
			archiveImplementationQueueEntry: vi.fn(async () => undefined),
			recoverImplementationQueueEntry: vi.fn(async () => undefined),
			updateImplementationQueueProcessorCount: vi.fn(async () => undefined),
		}),
	}));
	vi.doMock(
		"../src/modules/nightworkers/contexts/WorkspaceAppearanceContext",
		() => ({
			useWorkspaceAppearanceState: () => ({
				attributes: {
					"data-theme": "dark",
					"data-density": "comfortable",
					"data-shape": "rounded",
					"data-shadow": "soft",
					"data-shadow-direction": "bottom",
					"data-font": "system",
					"data-contrast": "normal",
					"data-motion": "reduced",
					"data-button-variant": "solid",
					"data-card-variant": "filled",
					"data-table-variant": "lined",
					"data-input-variant": "filled",
				},
			}),
		}),
	);
	vi.doMock(
		"../src/modules/nightworkers/contexts/WorkspaceLayoutContext",
		() => ({
			useWorkspaceLayoutActions: () => ({
				setPanelSizes: vi.fn(),
			}),
			useWorkspaceLayoutState: () => ({
				panelSizes: [26, 74],
			}),
		}),
	);
}

function jsonResponse(body: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

function stubPlanModeCommands() {
	let queryIndex = 0;
	vi.doMock("@tanstack/react-query", async () => ({
		...(await vi.importActual<typeof import("@tanstack/react-query")>(
			"@tanstack/react-query",
		)),
		useQueryClient: () => ({
			invalidateQueries: vi.fn(async () => undefined),
			getQueryData: vi.fn(() => createPlanWorkspace()),
			setQueryData: vi.fn(),
		}),
		useQuery: () => {
			queryIndex += 1;
			if (queryIndex === 1)
				return {
					data: createPlanWorkspace(),
					refetch: vi.fn(async () => ({ data: createPlanWorkspace() })),
				};
			if (queryIndex === 2)
				return {
					data: [createQuestionnaireSession()],
					refetch: vi.fn(async () => ({
						data: [createQuestionnaireSession()],
					})),
				};
			return { data: null, refetch: vi.fn(async () => ({ data: null })) };
		},
	}));
	const generatedMessage = buildTaskMessage({
		id: "generated-plan-view",
		taskId: "task-1",
		messageType: "markdown_document",
		content: "# Generated",
		metadataJson: { intent: "api_io_contract" },
	});
	vi.doMock("../src/modules/blueprint", () => ({
		generateBlueprintArtifact: vi.fn(async () =>
			jsonResponse({
				message: generatedMessage,
				workspace: createPlanWorkspace(),
			}),
		),
	}));
	vi.doMock("../src/modules/dataModel", () => ({
		generateDataModelArtifact: vi.fn(async () =>
			jsonResponse({
				message: generatedMessage,
				workspace: createPlanWorkspace(),
			}),
		),
	}));
	vi.doMock("../src/modules/specification", async () => {
		const actual = await vi.importActual<
			typeof import("../src/modules/specification")
		>("../src/modules/specification");
		return {
			...actual,
			fetchPlanModeWorkspace: vi.fn(async () =>
				jsonResponse(createPlanWorkspace()),
			),
			generateFeaturePlanArtifact: vi.fn(async () =>
				jsonResponse({
					message: generatedMessage,
					workspace: createPlanWorkspace(),
				}),
			),
		};
	});
	vi.doMock("../src/modules/questionnaire", async () => ({
		...(await vi.importActual<typeof import("../src/modules/questionnaire")>(
			"../src/modules/questionnaire",
		)),
		fetchDesignQuestionnaireSessions: vi.fn(async () =>
			jsonResponse([createQuestionnaireSession()]),
		),
		generateAdditionalDesignQuestionnaireQuestions: vi.fn(async () =>
			jsonResponse({
				session: createQuestionnaireSession(),
				result: { addedCount: 1, skippedDuplicateCount: 0 },
			}),
		),
		startDesignQuestionnaire: vi.fn(async () =>
			jsonResponse(createQuestionnaireSession()),
		),
		submitDesignQuestionnaireAnswers: vi.fn(async () =>
			jsonResponse(createQuestionnaireSession()),
		),
	}));
	vi.doMock("../src/modules/settings", () => ({
		fetchGeneralSettings: vi.fn(async () =>
			jsonResponse({
				planMode: {
					questionnaire: true,
					feature_plan: true,
					blueprint: true,
					data_model: true,
					user_flow: true,
					api_io_contract: true,
					activity_flow: true,
					sequence_flow: true,
					zod_schema_design: true,
				},
			}),
		),
	}));
	vi.doMock("../src/modules/planMode/planViewCommands", () => ({
		generatePlanViewArtifact: vi.fn(async () =>
			jsonResponse({
				message: generatedMessage,
				workspace: createPlanWorkspace(),
			}),
		),
	}));
}

async function triggerElementCallbacks(element: unknown) {
	const seen = new Set<unknown>();
	const visit = async (node: unknown) => {
		if (!node || typeof node !== "object" || seen.has(node)) return;
		seen.add(node);
		if (Array.isArray(node)) {
			for (const child of node) await visit(child);
			return;
		}
		const props = (node as { props?: Record<string, unknown> }).props;
		if (!props) return;
		for (const [name, value] of Object.entries(props)) {
			if (!name.startsWith("on") || typeof value !== "function") continue;
			const argument =
				name === "onGenerateDedicatedViews"
					? ["api_io_contract", "activity_flow"]
					: name === "onSelectSession"
						? createQuestionnaireSession()
						: name === "onStart"
							? "discover_tests"
							: name === "onChange"
								? { "q-1": { questionId: "q-1", freeText: "updated" } }
								: undefined;
			await value(argument);
		}
		await visit(props.children);
	};
	await visit(element);
}

function createWorkspace(
	overrides: Partial<NightWorkersWorkspaceState> = {},
): NightWorkersWorkspaceState {
	const now = "2026-07-08T00:00:00.000Z";
	const project = {
		id: "repo-1",
		name: "NightWorkers",
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
		allowed: true,
		queueEnabled: true,
		maxConcurrentSessions: 1,
		createdAt: now,
		updatedAt: now,
	};
	const session = buildTask({
		id: "task-1",
		repositoryId: project.id,
		title: "Task 1",
		status: "running",
	});
	const sessionView = {
		task: {
			id: session.id,
			repositoryId: project.id,
			title: session.title,
			status: session.status,
			updatedAt: now,
		},
		group: "processing" as const,
		emailState: "running" as const,
		phase: "Running",
	};
	const planArtifact = {
		id: "artifact-plan",
		taskId: session.id,
		kind: "plan_mode_workspace" as const,
		title: "Plan Mode Workspace",
		summary: "Plan workspace",
		source: { type: "task_message" as const, messageId: "message-plan" },
		createdAt: now,
		metadata: { initialTab: "blueprint" },
	};
	const reviewSession = {
		session: {
			id: "review-1",
			taskId: session.id,
			runId: "run-1",
			status: "completed",
			createdAt: now,
			updatedAt: now,
		},
		recommendation: { level: "approved", reason: "Looks good" },
		statusArtifact: { sections: [{ title: "Summary", items: [] }] },
	};
	return {
		projects: [project],
		sessions: [session],
		sessionViews: [sessionView],
		groupedSessionViews: {
			[project.id]: { processing: [sessionView], queue: [], archive: [] },
		},
		activeSessionId: session.id,
		activeSession: session,
		activeSessionView: sessionView,
		activeProject: project,
		activeSessionRuns: [
			buildTaskRun({
				id: "run-1",
				taskId: session.id,
				repositoryId: project.id,
			}),
		],
		latestRun: buildTaskRun({
			id: "run-1",
			taskId: session.id,
			repositoryId: project.id,
			status: "running",
		}),
		taskMessages: [
			buildTaskMessage({
				id: "message-plan",
				taskId: session.id,
				messageType: "markdown_document",
				content: "# Feature Plan",
				metadataJson: { intent: "feature_plan" },
			}),
		],
		latestRunEvents: [],
		llmUsageSummary: null,
		activityEvents: [],
		activityArtifacts: [],
		backgroundProcesses: [],
		activeStreamingResponse: "",
		latestRunTodos: [],
		latestRunReviews: [],
		activeReviewSession: reviewSession,
		activeGitCloseout: null,
		activeArtifactRefs: [
			planArtifact,
			{
				id: "artifact-review",
				taskId: session.id,
				runId: "run-1",
				kind: "review_status" as const,
				title: "Review",
				summary: "Review summary",
				source: { type: "review_result" as const, reviewId: "review-1" },
				createdAt: now,
			},
		],
		projectFileEntries: [],
		projectFileEntriesByDirectory: {},
		expandedProjectDirectories: {},
		expandedProjects: {},
		loadingProjectDirectories: {},
		selectedProjectFile: null,
		selectedProjectFilePath: null,
		isProjectFilesLoading: false,
		isProjectFileLoading: false,
		projectDiff: null,
		isProjectDiffLoading: false,
		isRealtimeConnected: true,
		realtimeStatus: "connected",
		isChatSubmitting: false,
		isProjectsLoading: false,
		isProjectListRefreshing: false,
		isSessionsLoading: false,
		isAgentWorking: false,
		isAgentThinking: false,
		activeProvider: "openai",
		llmSettings: {
			ACTIVE_LLM_PROVIDER: "openai",
			OPENAI_ENABLED: true,
			OPENAI_MODEL: "gpt-5",
			CODEX_ENABLED: true,
			CODEX_MODEL: "gpt-5-codex",
			IMPLEMENTATION_RUNTIME_LANE: "codex-agent",
			SESSION_QUEUE_MAX_CONCURRENCY: 1,
			providerEndpoints: [
				{
					id: "openai-main",
					kind: "openai",
					name: "OpenAI",
					enabled: true,
					models: ["gpt-5"],
					createdAt: now,
					updatedAt: now,
				},
			],
			roleRoutes: [
				{
					role: "plan",
					primary: {
						providerEndpointId: "openai-main",
						model: "gpt-5",
						thinkingDepth: "high",
					},
					fallbacks: [],
				},
			],
		},
		providerModelOptions: [{ value: "gpt-5", label: "GPT-5" }],
		setActiveSessionId: vi.fn(),
		createSession: vi.fn(async () => buildTask({ id: "task-new" })),
		sendWorkbenchMessage: vi.fn(async () => undefined),
		startRun: vi.fn(async () => undefined),
		stopLatestRun: vi.fn(async () => undefined),
		deleteProject: vi.fn(async () => undefined),
		setExpandedProjects: vi.fn(),
		fetchDirectories: vi.fn(async () => undefined),
		openProjectFile: vi.fn(async () => undefined),
		refreshProjectList: vi.fn(async () => undefined),
		...overrides,
	} as unknown as NightWorkersWorkspaceState;
}

function createPlanWorkspace(): PlanModeWorkspace {
	return {
		taskId: "task-1",
		repositoryId: "repo-1",
		generatedAt: "2026-07-08T00:00:00.000Z",
		featurePlanArtifacts: [
			{
				id: "feature-plan-1",
				kind: "feature_plan",
				title: "Feature Plan",
				sourceMessageId: "feature-message",
				createdAt: "2026-07-08T00:00:00.000Z",
			},
		],
		blueprintArtifacts: [
			{
				id: "blueprint-1",
				kind: "blueprint",
				title: "Blueprint",
				sourceMessageId: "blueprint-message",
				createdAt: "2026-07-08T00:00:00.000Z",
			},
		],
		dataModelArtifacts: [
			{
				id: "data-model-1",
				kind: "data_model",
				title: "Data Model",
				sourceMessageId: "data-message",
				createdAt: "2026-07-08T00:00:00.000Z",
			},
		],
		dedicatedViewArtifacts: [
			{
				id: "api-contract-1",
				kind: "api_io_contract",
				title: "API Contract",
				sourceMessageId: "api-message",
				createdAt: "2026-07-08T00:00:00.000Z",
			},
		],
		questionnaireSessions: [
			{
				id: "questionnaire-1",
				status: "accepted",
				blockingUnansweredCount: 0,
				totalQuestionCount: 1,
				answeredQuestionCount: 1,
				updatedAt: "2026-07-08T00:00:00.000Z",
			},
		],
		decisionReviews: [],
		implementationReferences: [],
		viewDecisions: [
			{ view: "questionnaire", decision: "include" },
			{ view: "feature_plan", decision: "include" },
			{ view: "blueprint", decision: "include" },
			{ view: "data_model", decision: "include" },
			{ view: "api_io_contract", decision: "include" },
		],
		routing: {
			revision: 0,
			entries: [
				{ view: "questionnaire", decision: "include", required: true },
				{ view: "feature_plan", decision: "include", required: true },
				{ view: "blueprint", decision: "include", required: false },
				{ view: "data_model", decision: "include", required: false },
				{ view: "api_io_contract", decision: "include", required: false },
			],
			editable: true,
			lockedReason: null,
			updatedBy: null,
			updatedAt: null,
		},
	};
}

function createQuestionnaireSession() {
	return {
		id: "questionnaire-1",
		taskId: "task-1",
		status: "accepted",
		answers: [
			{
				questionId: "q-1",
				answer: {
					questionId: "q-1",
					selectedOptionIds: [],
					rankedOptionIds: [],
					deferred: false,
					freeText: "Use a compact dashboard.",
				},
			},
		],
		questionSets: [
			{
				id: "set-1",
				questionnaire: {
					questionSets: [
						{
							id: "group-1",
							title: "Product",
							questions: [
								{
									id: "q-1",
									question: "What should be built?",
									answerType: "text",
									required: true,
								},
							],
						},
					],
				},
			},
		],
		createdAt: "2026-07-08T00:00:00.000Z",
		updatedAt: "2026-07-08T00:00:00.000Z",
	};
}

function createPlanMessages(): TaskMessage[] {
	return [
		buildTaskMessage({
			id: "verification-message",
			taskId: "task-1",
			messageType: "markdown_document",
			content: "# Verification",
			metadataJson: {
				verificationDocument: {
					conditions: [
						{
							id: "condition-1",
							text: "The dashboard renders.",
							status: "pending",
							required: true,
						},
					],
				},
			},
		}),
		buildTaskMessage({
			id: "feature-message",
			taskId: "task-1",
			messageType: "markdown_document",
			content: "# Feature Plan\nBuild the dashboard.",
			metadataJson: {
				intent: "feature_plan",
				verificationDocumentId: "verification-1",
				verificationSidecarMessageId: "verification-message",
			},
		}),
		buildBlueprintMessage({
			id: "blueprint-message",
			taskId: "task-1",
			content: "# Blueprint\nMain dashboard screen.",
		}),
		buildTaskMessage({
			id: "data-message",
			taskId: "task-1",
			messageType: "markdown_document",
			content: "# Data Model\nUser and Task tables.",
			metadataJson: { intent: "data_model" },
		}),
		buildTaskMessage({
			id: "api-message",
			taskId: "task-1",
			messageType: "markdown_document",
			content: "# API Contract\nGET /tasks",
			metadataJson: { intent: "api_io_contract" },
		}),
	];
}

async function renderShellRoute(routeState: WorkbenchRouteState) {
	resetHookMocks(["", "", "", { type: "closed" }, null]);
	stubQueueModule();
	const { NightWorkersShell } = await import(
		"../src/modules/nightworkers/components/NightWorkersShell"
	);
	return NightWorkersShell({
		workspace: createWorkspace(),
		routeState,
		onNavigate: vi.fn(),
		showFolderBrowser: false,
		onOpenFolderBrowser: vi.fn(),
		onCloseFolderBrowser: vi.fn(),
	});
}

function planViewerStateValues(activeTab: PlanWorkspaceTab) {
	return [
		createPlanWorkspace(),
		[createQuestionnaireSession()],
		activeTab,
		"questionnaire-1",
		{
			"q-1": {
				questionId: "q-1",
				selectedOptionIds: [],
				rankedOptionIds: [],
				deferred: false,
				freeText: "Use a compact dashboard.",
			},
		},
		null,
		null,
		null,
		{
			planMode: {
				questionnaire: true,
				feature_plan: true,
				blueprint: true,
				data_model: true,
				user_flow: true,
				api_io_contract: true,
				activity_flow: true,
				sequence_flow: true,
				zod_schema_design: true,
			},
		},
		new Set<string>(),
		[],
	];
}

describe("frontend component branch coverage", () => {
	it("evaluates NightWorkersShell route branches without network side effects", async () => {
		const routes: WorkbenchRouteState[] = [
			{ kind: "overview", range: "24h", projectId: "repo-1" },
			{ kind: "settings", section: "llm-providers" },
			{ kind: "global_queue", projectId: "repo-1" },
			{ kind: "project_queue", projectId: "repo-1", view: "table" },
			{ kind: "project_detail", projectId: "repo-1", tab: "evaluation" },
			{ kind: "project_detail", projectId: "missing", tab: "overview" },
			{ kind: "session", sessionId: "task-1", artifact: { kind: "todo" } },
			{
				kind: "session",
				sessionId: "missing",
				artifact: { kind: "artifact_ref", artifactId: "artifact-plan" },
			},
		];

		for (const route of routes) {
			await expect(renderShellRoute(route)).resolves.toBeTruthy();
		}
	}, 15_000);

	it("evaluates PlanModeWorkspaceViewer tab branches with injected state", async () => {
		const tabs: PlanWorkspaceTab[] = [
			"feature-plan",
			"blueprint",
			"data-model",
			"questionnaire",
			"status",
			"api-io-contract",
			"activity-flow",
		];
		const activityArtifacts: ActivityArtifact[] = [
			buildActivityArtifact({
				id: "blueprint-artifact",
				taskId: "task-1",
				kind: "app_blueprint",
				title: "Blueprint artifact",
			}),
		];

		for (const tab of tabs) {
			resetHookMocks(planViewerStateValues(tab).slice(2));
			stubPlanModeCommands();
			const { PlanModeWorkspaceViewer } = await import(
				"../src/modules/planMode/PlanModeWorkspaceViewer"
			);
			const artifactContextChange = vi.fn();
			const element = PlanModeWorkspaceViewer({
				sessionId: "task-1",
				taskMessages: createPlanMessages(),
				activityArtifacts,
				initialTab: tab,
				onTabChange: vi.fn(),
				onArtifactContextChange: artifactContextChange,
				onQueueSession: vi.fn(async () => undefined),
				onAddToQueue: vi.fn(async () => undefined),
			});

			await triggerElementCallbacks(element);
			expect(element).toBeTruthy();
		}
	});

	it("runs route artifact synchronization effects for each artifact route", async () => {
		const setArtifactFocus = vi.fn((next) => {
			if (typeof next === "function") next({ type: "closed" });
		});
		const setClearedArtifactContextId = vi.fn();
		const workspace = createWorkspace({
			selectedProjectFilePath: "src/old.ts",
		});
		resetHookMocks([], "run");
		const { useNightWorkersRouteArtifactSync: syncRouteArtifact } =
			await import(
				"../src/modules/nightworkers/components/nightworkers-shell-route-effects"
			);
		const routes: WorkbenchRouteState[] = [
			{ kind: "overview", range: "30d", projectId: null },
			{ kind: "session", sessionId: "task-1", artifact: null },
			{ kind: "session", sessionId: "task-1", artifact: { kind: "todo" } },
			{
				kind: "session",
				sessionId: "task-1",
				artifact: {
					kind: "project_tree",
					mode: "tree",
					filePath: "src/current.ts",
				},
			},
			{
				kind: "session",
				sessionId: "task-1",
				artifact: { kind: "plan_mode_workspace", tab: "blueprint" },
			},
			{
				kind: "session",
				sessionId: "task-1",
				artifact: { kind: "review_status" },
			},
			{
				kind: "session",
				sessionId: "task-1",
				artifact: { kind: "evidence_check" },
			},
			{
				kind: "session",
				sessionId: "task-1",
				artifact: { kind: "artifact_ref", artifactId: "artifact-plan" },
			},
			{
				kind: "session",
				sessionId: "missing",
				artifact: { kind: "artifact_ref", artifactId: "missing-artifact" },
			},
		];

		for (const routeState of routes) {
			syncRouteArtifact({
				routeState,
				workspace,
				setArtifactFocus,
				setClearedArtifactContextId,
				reviewStatusTitle: "Review",
				formatReviewStatusSummary: (level, count) => `${level}:${count}`,
				evidenceCheckTitle: "Evidence Check",
				evidenceCheckArtifactSummary: "Spec evidence",
			});
		}

		expect(setArtifactFocus).toHaveBeenCalled();
		expect(workspace.openProjectFile).toHaveBeenCalledWith("src/current.ts");
		expect(workspace.setActiveSessionId).not.toHaveBeenCalledWith("missing");
	});

	it("keeps the current artifact open while a review route is resolving", async () => {
		const currentFocus = {
			type: "artifact" as const,
			artifact: {
				id: "evidence-check-document-1",
				taskId: "task-1",
				kind: "evidence_check" as const,
				title: "Evidence Check",
				summary: "Spec evidence",
				source: {
					type: "verification_document" as const,
					verificationDocumentId: "document-1",
				},
				createdAt: "2026-07-08T00:00:00.000Z",
			},
		};
		const focusUpdates: unknown[] = [];
		const setArtifactFocus = vi.fn((next) => {
			if (typeof next === "function") focusUpdates.push(next(currentFocus));
		});
		const setClearedArtifactContextId = vi.fn();
		const baseWorkspace = createWorkspace();
		const workspace = createWorkspace({
			activeReviewSession: null,
			activeArtifactRefs: baseWorkspace.activeArtifactRefs.filter(
				(ref) => ref.kind !== "review_status",
			),
		});
		resetHookMocks([], "run");
		const { useNightWorkersRouteArtifactSync: syncRouteArtifact } =
			await import(
				"../src/modules/nightworkers/components/nightworkers-shell-route-effects"
			);

		syncRouteArtifact({
			routeState: {
				kind: "session",
				sessionId: "task-1",
				artifact: { kind: "review_status" },
			},
			workspace,
			setArtifactFocus,
			setClearedArtifactContextId,
			reviewStatusTitle: "Review",
			formatReviewStatusSummary: (level, count) => `${level}:${count}`,
			evidenceCheckTitle: "Evidence Check",
			evidenceCheckArtifactSummary: "Spec evidence",
		});

		expect(focusUpdates).toEqual([currentFocus]);
	});
});
