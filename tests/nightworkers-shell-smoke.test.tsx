import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "../src/i18n/setup";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NightWorkersShell } from "../src/modules/nightworkers/components/NightWorkersShell";
import { WorkspaceAppearanceProvider } from "../src/modules/nightworkers/contexts/WorkspaceAppearanceContext";
import { WorkspaceLayoutProvider } from "../src/modules/nightworkers/contexts/WorkspaceLayoutContext";
import type { NightWorkersWorkspaceState } from "../src/modules/nightworkers/hooks/useNightWorkersWorkspace";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
		},
	},
});

function createDummyWorkspace(): NightWorkersWorkspaceState {
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
	const session = {
		id: "session-1",
		repositoryId: "repo-1",
		title: "Task 1",
		description: "Dummy description",
		objective: "Dummy objective",
		acceptanceCriteria: "Dummy criteria",
		status: "running" as const,
		timeoutSeconds: 3600,
		priority: 0,
		createdAt: now,
		updatedAt: now,
	};
	const sView = {
		task: {
			id: "session-1",
			repositoryId: "repo-1",
			title: "Task 1",
			status: "running",
			updatedAt: now,
		},
		group: "processing" as const,
		emailState: "running" as const,
		phase: "Running",
	};

	return {
		projects: [project],
		sessions: [session],
		sessionViews: [sView],
		groupedSessionViews: {
			"repo-1": {
				processing: [sView],
				queue: [],
				archive: [],
			},
		},
		activeSessionId: "session-1",
		activeSession: session,
		activeSessionView: sView,
		activeProject: project,
		activeSessionRuns: [],
		latestRun: undefined,
		taskMessages: [],
		latestRunEvents: [],
		llmUsageSummary: {
			totalPromptTokens: 100,
			totalCompletionTokens: 50,
			totalCost: 0.01,
			durationSeconds: 10,
			totalRequests: 2,
			promptTokensByModel: { "gpt-4": 100 },
			completionTokensByModel: { "gpt-4": 50 },
			costByModel: { "gpt-4": 0.01 },
			requestsByModel: { "gpt-4": 2 },
			inputTokens: 100,
			outputTokens: 50,
			promptInputTokens: 100,
			stateCardTokens: 20,
			averageDurationMs: 1000,
			usageMode: "normal",
		},
		activityEvents: [],
		activityArtifacts: [],
		backgroundProcesses: [],
		activeStreamingResponse: "",
		latestRunTodos: [
			{
				id: "todo-1",
				taskId: "session-1",
				runId: "run-1",
				stepIndex: 1,
				status: "completed",
				createdAt: now,
				updatedAt: now,
			},
		],
		latestRunReviews: [],
		activeReviewSession: null,
		activeGitCloseout: null,
		activeArtifactRefs: [],
		projectFileEntries: [
			{
				path: "src/main.tsx",
				name: "main.tsx",
				type: "file",
				size: 100,
				updatedAt: now,
			},
		],
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
		realtimeStatus: "connected" as const,
		isChatSubmitting: false,
		isProjectsLoading: false,
		isProjectListRefreshing: false,
		isSessionsLoading: false,
		isAgentWorking: false,
		isAgentThinking: false,
		activeProvider: "openai" as const,
		llmSettings: {
			ACTIVE_LLM_PROVIDER: "openai",
			AZURE_OPENAI_ENABLED: false,
			AZURE_OPENAI_API_KEY: "",
			AZURE_OPENAI_ENDPOINT: "",
			AZURE_OPENAI_DEPLOYMENT_NAME: "",
			AZURE_OPENAI_API_VERSION: "",
			OPENAI_ENABLED: true,
			OPENAI_API_KEY: "test-key",
			OPENAI_BASE_URL: "",
			OPENAI_MODEL: "gpt-4",
			AWS_BEDROCK_ENABLED: false,
			AWS_ACCESS_KEY_ID: "",
			AWS_SECRET_ACCESS_KEY: "",
			AWS_REGION: "",
			AWS_BEDROCK_MODEL: "",
			CODEX_ENABLED: false,
			CODEX_ACCESS_TOKEN: "",
			CODEX_MODEL: "",
			IMPLEMENTATION_RUNTIME_LANE: "codex-agent",
			SESSION_QUEUE_MAX_CONCURRENCY: 1,
			providerEndpoints: [
				{
					id: "openai-endpoint",
					kind: "openai",
					name: "OpenAI",
					enabled: true,
					models: ["gpt-4"],
					createdAt: now,
					updatedAt: now,
				},
			],
			roleRoutes: [
				{
					role: "plan",
					primary: { providerEndpointId: "openai-endpoint", model: "gpt-4" },
					fallbacks: [],
				},
			],
		},
		refreshProjectList: async () => undefined,
		providerModelOptions: [],
	} as unknown as NightWorkersWorkspaceState;
}

describe("NightWorkersShell Smoke Test", () => {
	it("renders main shell with overview screen by default", () => {
		const workspace = createDummyWorkspace();
		const markup = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<WorkspaceAppearanceProvider>
					<WorkspaceLayoutProvider>
						<NightWorkersShell
							workspace={workspace}
							routeState={{ kind: "overview", range: "30d", projectId: null }}
							onNavigate={() => undefined}
							showFolderBrowser={false}
							onOpenFolderBrowser={() => undefined}
							onCloseFolderBrowser={() => undefined}
						/>
					</WorkspaceLayoutProvider>
				</WorkspaceAppearanceProvider>
			</QueryClientProvider>,
		);

		expect(markup).toContain("nightWorkers");
		expect(markup).toContain("Task 1");
	});

	it("renders main shell settings screen when routed to settings", () => {
		const workspace = createDummyWorkspace();
		const markup = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<WorkspaceAppearanceProvider>
					<WorkspaceLayoutProvider>
						<NightWorkersShell
							workspace={workspace}
							routeState={{ kind: "settings", section: "general" }}
							onNavigate={() => undefined}
							showFolderBrowser={false}
							onOpenFolderBrowser={() => undefined}
							onCloseFolderBrowser={() => undefined}
						/>
					</WorkspaceLayoutProvider>
				</WorkspaceAppearanceProvider>
			</QueryClientProvider>,
		);

		expect(markup).toContain("設定をロード中");
	});

	it("renders main shell with session routing", () => {
		const workspace = createDummyWorkspace();
		const markup = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<WorkspaceAppearanceProvider>
					<WorkspaceLayoutProvider>
						<NightWorkersShell
							workspace={workspace}
							routeState={{
								kind: "session",
								projectId: "repo-1",
								sessionId: "session-1",
							}}
							onNavigate={() => undefined}
							showFolderBrowser={false}
							onOpenFolderBrowser={() => undefined}
							onCloseFolderBrowser={() => undefined}
						/>
					</WorkspaceLayoutProvider>
				</WorkspaceAppearanceProvider>
			</QueryClientProvider>,
		);

		expect(markup).toContain("nightWorkers");
		expect(markup).toContain("Task 1");
	});

	it("renders main shell with project queue routing", () => {
		const workspace = createDummyWorkspace();
		const markup = renderToStaticMarkup(
			<QueryClientProvider client={queryClient}>
				<WorkspaceAppearanceProvider>
					<WorkspaceLayoutProvider>
						<NightWorkersShell
							workspace={workspace}
							routeState={{ kind: "project_queue", projectId: "repo-1" }}
							onNavigate={() => undefined}
							showFolderBrowser={false}
							onOpenFolderBrowser={() => undefined}
							onCloseFolderBrowser={() => undefined}
						/>
					</WorkspaceLayoutProvider>
				</WorkspaceAppearanceProvider>
			</QueryClientProvider>,
		);

		expect(markup).toContain("nightWorkers");
		expect(markup).toContain("Task 1");
	});
});
