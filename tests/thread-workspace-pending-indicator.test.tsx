import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	ARTIFACT_BUTTON_ACTION_COOLDOWN_MS,
	nextArtifactButtonCooldown,
	ThreadWorkspace,
} from "../src/modules/nightworkers/components/ThreadWorkspace";

const baseProps = {
	activeSession: null,
	sessionView: null,
	activeProject: null,
	runs: [],
	latestRun: undefined,
	taskMessages: [],
	latestRunEvents: [],
	activityEvents: [],
	activityArtifacts: [],
	activeStreamingResponse: "",
	latestRunTodos: [],
	artifactRefs: [],
	isAgentWorking: false,
	isAgentThinking: false,
	realtimeStatus: "connected" as const,
	model: "test-model",
	thinkingDepth: "medium" as const,
	onModelChange: vi.fn(),
	modelOptions: [],
	onThinkingDepthChange: vi.fn(),
	onSubmitInitialPrompt: vi.fn(),
	onSubmitWorkbenchMessage: vi.fn(),
	onOpenBlueprintArtifact: vi.fn(),
	isBlueprintArtifactOpen: false,
	isBlueprintActionBusy: false,
	onOpenReviewArtifact: vi.fn(),
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
};

describe("ThreadWorkspace pending indicator", () => {
	it("guards artifact button actions during the cooldown window", () => {
		const now = 1000;
		const nextCooldownUntil = nextArtifactButtonCooldown(now, 0);

		expect(nextCooldownUntil).toBe(now + ARTIFACT_BUTTON_ACTION_COOLDOWN_MS);
		expect(nextArtifactButtonCooldown(now + 1, nextCooldownUntil || 0)).toBe(
			null,
		);
		expect(
			nextArtifactButtonCooldown(
				now + ARTIFACT_BUTTON_ACTION_COOLDOWN_MS,
				nextCooldownUntil || 0,
			),
		).toBe(now + ARTIFACT_BUTTON_ACTION_COOLDOWN_MS * 2);
	});

	it("shows the assistant thinking indicator while the first session is still being created", () => {
		const markup = renderToStaticMarkup(
			<ThreadWorkspace
				{...baseProps}
				isAgentWorking={true}
				isAgentThinking={true}
			/>,
		);

		expect(markup).toContain("AIが返答を生成中です");
		expect(markup).toContain("nightworkers-thinking-dot");
	});

	it("shows the assistant thinking indicator at the end of an active running session", () => {
		const now = new Date().toISOString();
		const markup = renderToStaticMarkup(
			<ThreadWorkspace
				{...baseProps}
				activeProject={{
					id: "repo-1",
					name: "todolist",
					localPath: "/Users/y.noguchi/Code/todolist",
					branch: "main",
					allowed: true,
					queueEnabled: false,
					maxConcurrentSessions: 1,
					createdAt: now,
					updatedAt: now,
				}}
				activeSession={{
					id: "task-1",
					repositoryId: "repo-1",
					title: "Copy template",
					status: "running",
					timeoutSeconds: 3600,
					priority: 0,
					createdAt: now,
					updatedAt: now,
				}}
				latestRun={{
					id: "run-1",
					taskId: "task-1",
					repositoryId: "repo-1",
					status: "running",
					workerKind: "native-local",
					timeoutSeconds: 3600,
					startedAt: now,
					createdAt: now,
					updatedAt: now,
				}}
				isAgentWorking={false}
				isAgentThinking={true}
			/>,
		);

		expect(markup).toContain("AIが返答を生成中です");
		expect(markup).toContain("nightworkers-thinking-dot");
		expect(markup).not.toContain("AIが作業中");
		expect(markup).toContain('aria-label="thread.testModeArtifact"');
		expect(markup.indexOf('aria-label="thread.testModeArtifact"')).toBeLessThan(
			markup.indexOf('aria-label="reviewStatus.start"'),
		);
		expect(markup).toContain('title="thread.tooltip.debugMode"');
		expect(markup).toContain('title="thread.tooltip.planMode"');
		expect(markup).toContain('title="thread.tooltip.testMode"');
		expect(markup).toContain('title="thread.tooltip.reviewMode"');
		expect(markup).toContain('title="thread.tooltip.todoList"');
		expect(markup.indexOf('title="thread.deleteTask"')).toBeLessThan(
			markup.indexOf('aria-label="thread.tooltip.debugMode"'),
		);
	});
});
