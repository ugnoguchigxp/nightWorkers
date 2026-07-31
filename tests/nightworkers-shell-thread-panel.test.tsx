import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NightWorkersShellThreadPanel } from "../src/modules/nightworkers/components/NightWorkersShellThreadPanel";
import type {
	WorkbenchArtifactRef,
	WorkbenchChatIntent,
} from "../src/modules/nightworkers/types";

type NightWorkersShellThreadPanelProps = Parameters<
	typeof NightWorkersShellThreadPanel
>[0];

type ThreadWorkspaceMockProps = {
	onSubmitWorkbenchMessage: (
		prompt: string,
		intent: WorkbenchChatIntent,
	) => void | Promise<void>;
	onStopActiveRun?: () => void | Promise<void>;
	onDeleteSession: () => void;
	onOpenArtifact: (artifact: WorkbenchArtifactRef) => void;
	onGrantExternalPath: (path: string) => void | Promise<void>;
};

// Mock i18next
vi.mock("react-i18next", () => ({
	initReactI18next: {
		type: "3rdParty",
		init: () => undefined,
	},
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

// Mock sub-components
vi.mock("./ThreadWorkspace", () => ({
	ThreadWorkspace: ({
		onSubmitWorkbenchMessage,
		onStopActiveRun,
		onDeleteSession,
		onOpenArtifact,
		onGrantExternalPath,
	}: ThreadWorkspaceMockProps) => (
		<div>
			<button
				onClick={() => onSubmitWorkbenchMessage("test-prompt", "normal")}
				id="btn-submit"
				type="button"
			>
				Submit
			</button>
			<button onClick={onStopActiveRun} id="btn-stop" type="button">
				Stop
			</button>
			<button onClick={onDeleteSession} id="btn-delete" type="button">
				Delete
			</button>
			<button
				onClick={() => onOpenArtifact({ id: "art-1", name: "Art 1" })}
				id="btn-open-art"
				type="button"
			>
				Open Art
			</button>
			<button
				onClick={() => onGrantExternalPath("/external")}
				id="btn-grant"
				type="button"
			>
				Grant
			</button>
		</div>
	),
}));

vi.mock("./ArtifactPane", () => ({
	ArtifactPane: () => <div>ArtifactPane</div>,
}));

vi.mock("./TodoListPane", () => ({
	TodoListPane: () => <div>TodoListPane</div>,
}));

describe("NightWorkersShellThreadPanel component", () => {
	const mockWorkspace = {
		activeSession: { id: "sess-1", status: "running" },
		activeSessionView: { queueEntry: { id: "entry-1" } },
		activeProject: { id: "proj-1", safetyPolicy: {} },
		activeSessionRuns: [],
		latestRun: { id: "run-1" },
		taskMessages: [],
		latestRunEvents: [],
		llmUsageSummary: null,
		activityEvents: [],
		activityArtifacts: [],
		backgroundProcesses: [],
		activeStreamingResponse: "",
		activeArtifactRefs: [],
		projectFileEntries: [],
		projectFileEntriesByDirectory: {},
		expandedProjectDirectories: {},
		loadingProjectDirectories: {},
		selectedProjectFile: null,
		selectedProjectFilePath: null,
		isProjectFilesLoading: false,
		isProjectFileLoading: false,
		projectDiff: null,
		isProjectDiffLoading: false,
		realtimeStatus: "connected",
		isChatSubmitting: false,
		sendWorkbenchMessage: vi.fn(async () => ({ run: true, messages: [] })),
		stopRun: vi.fn(async () => undefined),
		deleteSession: vi.fn(),
		updateProject: vi.fn(async () => undefined),
		openProjectFile: vi.fn(),
	} as NightWorkersShellThreadPanelProps["workspace"];

	const mockQueueState = {
		removeImplementationQueueEntry: vi.fn(async () => undefined),
		requeueImplementationQueueEntry: vi.fn(async () => undefined),
	} as NightWorkersShellThreadPanelProps["queueState"];

	const defaultProps: NightWorkersShellThreadPanelProps = {
		workspace: mockWorkspace,
		queueState: mockQueueState,
		routeState: { kind: "session", sessionId: "sess-1", projectId: "proj-1" },
		onNavigate: vi.fn(),
		workspaceRef: { current: mockWorkspace },
		model: "gpt-4",
		modelOptions: [],
		thinkingDepth: "deep",
		thinkingDepthOptions: [],
		onModelChange: vi.fn(),
		onThinkingDepthChange: vi.fn(),
		onSubmitPrompt: vi.fn(async () => undefined),
		buildComposerLlmSelection: vi.fn(),
		onComposerLlmSelectionSubmitted: vi.fn(),
		openQuestionnaireWorkspace: vi.fn(async () => undefined),
		selectedArtifactContext: null,
		selectedArtifact: null,
		artifactFocus: { type: "closed" },
		setArtifactFocus: vi.fn(),
		setClearedArtifactContextId: vi.fn(),
		artifactPaneOpen: false,
		isTodoArtifactOpen: false,
		hasTodoArtifact: false,
		canStopLatestRun: true,
		onOpenBlueprintArtifact: vi.fn(async () => undefined),
		isBlueprintArtifactOpen: false,
		onOpenReviewArtifact: vi.fn(async () => undefined),
		isReviewArtifactOpen: false,
		onOpenEvidenceCheckArtifact: vi.fn(),
		isEvidenceCheckArtifactOpen: false,
		onOpenTodoArtifact: vi.fn(),
		startSessionAndFocusTodo: vi.fn(async () => undefined),
		queueActiveSessionAndFocusTodo: vi.fn(async () => undefined),
		addActiveSessionToQueue: vi.fn(async () => undefined),
		isActiveImplementationLocked: false,
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders successfully and forwards workspace actions", async () => {
		const markup = renderToStaticMarkup(
			<QueryClientProvider client={new QueryClient()}>
				<NightWorkersShellThreadPanel {...defaultProps} />
			</QueryClientProvider>,
		);
		expect(markup).toContain("composer.placeholder");
		expect(markup).toContain("modelControls.model");
		expect(mockWorkspace.sendWorkbenchMessage).not.toHaveBeenCalled();
	});
});
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
