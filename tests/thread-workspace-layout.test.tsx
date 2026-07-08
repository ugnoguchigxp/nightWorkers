import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	nextArtifactButtonCooldown,
	ThreadWorkspace,
} from "../src/modules/nightworkers/components/ThreadWorkspace";

type ThreadWorkspaceProps = Parameters<typeof ThreadWorkspace>[0];

// Mock i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { title?: string }) => {
			if (options?.title) return `${key}_${options.title}`;
			return key;
		},
	}),
}));

// Mock Resizable Panels
vi.mock("react-resizable-panels", () => ({
	Group: ({ children }: { children?: ReactNode }) => (
		<div className="mock-resizable-group">{children}</div>
	),
	Panel: ({ children, id }: { children?: ReactNode; id?: string }) => (
		<div className="mock-resizable-panel" id={id}>
			{children}
		</div>
	),
	Separator: () => <div className="mock-resizable-separator" />,
}));

// Mock child components
vi.mock("./ThreadWorkspaceBody", () => ({
	ThreadBody: () => <div className="mock-thread-body">Body</div>,
}));

vi.mock("./ThreadWorkspaceBanner", () => ({
	formatUsageBadge: () => "UsageBadge",
	formatUsageTitle: () => "UsageTitle",
	WorkbenchStateBanner: () => <div className="mock-banner">Banner</div>,
}));

describe("ThreadWorkspace component & helpers", () => {
	const now = "2026-07-08T00:00:00.000Z";
	const activeSession: NonNullable<ThreadWorkspaceProps["activeSession"]> = {
		id: "sess-1",
		repositoryId: "repo-1",
		title: "Active Task Title",
		status: "pending",
		timeoutSeconds: 60,
		priority: 0,
		createdAt: now,
		updatedAt: now,
	};
	const activeProject: NonNullable<ThreadWorkspaceProps["activeProject"]> = {
		id: "repo-1",
		name: "My Project",
		localPath: "/tmp/project",
		branch: "main",
		allowed: true,
		queueEnabled: true,
		maxConcurrentSessions: 1,
		createdAt: now,
		updatedAt: now,
	};

	const defaultProps: ThreadWorkspaceProps = {
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
		backgroundProcesses: [],
		artifactRefs: [],
		isAgentWorking: false,
		isAgentThinking: false,
		realtimeStatus: "connected",
		model: "gpt-4",
		thinkingDepth: "deep",
		thinkingDepthOptions: [],
		onModelChange: vi.fn(),
		modelOptions: [],
		onThinkingDepthChange: vi.fn(),
		onSubmitInitialPrompt: vi.fn(async () => {}),
		onSubmitWorkbenchMessage: vi.fn(async () => {}),
		onOpenBlueprintArtifact: vi.fn(async () => {}),
		isBlueprintArtifactOpen: false,
		isBlueprintActionBusy: false,
		onOpenReviewArtifact: vi.fn(async () => {}),
		isReviewArtifactOpen: false,
		hasReviewArtifact: false,
		isReviewActionBusy: false,
		onOpenTestModeArtifact: vi.fn(),
		isTestModeArtifactOpen: false,
		onOpenTodoArtifact: vi.fn(),
		isTodoArtifactOpen: false,
		hasTodoArtifact: false,
		onDeleteSession: vi.fn(),
		onQueueSession: vi.fn(),
		onRemoveQueueEntry: vi.fn(),
		onRequeueQueueEntry: vi.fn(),
		onOpenArtifact: vi.fn(),
		isProjectFilesOpen: false,
		onOpenProjectFiles: vi.fn(),
		onGrantExternalPath: vi.fn(async () => {}),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders empty prompt when activeSession is null", () => {
		const markup = renderToStaticMarkup(<ThreadWorkspace {...defaultProps} />);
		expect(markup).toContain("thread.emptyPrompt");
	});

	it("renders task headers and tools when activeSession is set", () => {
		const props = {
			...defaultProps,
			activeSession,
			activeProject,
			artifactRefs: [{ id: "art-1", kind: "plan_mode_workspace" }],
		};

		const markup = renderToStaticMarkup(<ThreadWorkspace {...props} />);
		expect(markup).toContain("My Project");
		expect(markup).toContain("Active Task Title");
		expect(markup).toContain("i:0 / o:0");
	});

	it("renders resizable panels when splitPanel is provided", () => {
		const props = {
			...defaultProps,
			activeSession,
			splitPanel: <div className="split-content">Split</div>,
		};

		const markup = renderToStaticMarkup(<ThreadWorkspace {...props} />);
		expect(markup).toContain("mock-resizable-group");
		expect(markup).toContain("split-content");
	});

	it("nextArtifactButtonCooldown throttles actions", () => {
		// Cooldown is active
		expect(nextArtifactButtonCooldown(100, 200)).toBeNull();
		// Cooldown expired
		expect(nextArtifactButtonCooldown(300, 200)).toBe(1000); // 300 + 700
	});
});
