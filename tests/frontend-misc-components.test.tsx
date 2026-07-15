import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { DesktopNavigationBar } from "../src/components/DesktopNavigationBar";
import { AppearanceSettings } from "../src/modules/blueprint-preview/AppearanceSettings";
import { defaultBlueprintPreviewDesignSettings } from "../src/modules/blueprint-preview/designSettings";
import {
	BlueprintSectionSampleShowcase,
	BlueprintSectionSampleShowcaseError,
} from "../src/modules/blueprint-section-sample/components/BlueprintSectionSampleShowcase";
import { TodoListPane } from "../src/modules/nightworkers/components/TodoListPane";
import type {
	ImplementationQueueDashboard,
	ImplementationQueueHealth,
	ImplementationQueueItem,
	Repository,
	Task,
	TaskRunTodo,
} from "../src/modules/nightworkers/types";
import { WorkspaceList } from "../src/modules/planMode/workspace-panels/WorkspaceList";
import { DimensionSelector } from "../src/modules/project-evaluation/components/DimensionSelector";
import { ImprovementIdeaGrid } from "../src/modules/project-evaluation/components/ImprovementIdeaGrid";
import { ProjectEvaluationTaskLinks } from "../src/modules/project-evaluation/components/ProjectEvaluationTaskLinks";
import type {
	ProjectEvaluationDimensionScore,
	ProjectImprovementIdea,
} from "../src/modules/project-evaluation/model/projectEvaluationTypes";
import { ImplementationQueueScreen } from "../src/modules/queue/ImplementationQueueScreen";
import { TodoWorkflowPanel } from "../src/modules/todo/TodoWorkflowPanel";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		className,
	}: {
		children: React.ReactNode;
		to: string;
		className?: string;
	}) => (
		<a className={className} href={to}>
			{children}
		</a>
	),
}));

const now = "2026-07-08T00:00:00Z";

function renderWithQueryClient(node: React.ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	const markup = renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
	);
	queryClient.clear();
	return markup;
}

function project(): Repository {
	return {
		id: "repo-1",
		name: "NightWorkers",
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
		allowed: true,
		queueEnabled: true,
		maxConcurrentSessions: 2,
		createdAt: now,
		updatedAt: now,
	};
}

function task(id: string, title = id): Task {
	return {
		id,
		repositoryId: "repo-1",
		title,
		status: "ready",
		timeoutSeconds: 3600,
		priority: 1,
		createdAt: now,
		updatedAt: now,
	};
}

function queueItem(
	id: string,
	status: ImplementationQueueItem["status"],
	position?: number,
): ImplementationQueueItem {
	return {
		id,
		taskId: `task-${id}`,
		repositoryId: "repo-1",
		status,
		priority: 10,
		queuePosition: position,
		processorSlot: position,
		attemptCount: 1,
		createdAt: now,
		updatedAt: now,
		task: task(`task-${id}`, `Queue task ${id}`),
		repository: project(),
	};
}

function queueDashboard(): ImplementationQueueDashboard {
	const queued = queueItem("queued", "queued", 1);
	const processing = queueItem("processing", "processing", 1);
	const completed = queueItem("completed", "completed", 2);
	return {
		settings: { processorCount: 2 },
		processors: [
			{ slot: 1, entry: processing },
			{ slot: 2, entry: null },
		],
		queued: [queued],
		completed: [completed],
		notQueued: [
			{
				task: task("task-plan-ready", "Plan ready task"),
				repository: project(),
			},
		],
	};
}

function queueHealth(): ImplementationQueueHealth {
	return {
		generatedAt: now,
		counts: {
			queued: 1,
			claimed: 0,
			processing: 1,
			stale: 1,
			retryable: 1,
			needsHuman: 1,
			orphaned: 0,
			pendingCompletion: 1,
		},
		items: [
			{
				entryId: "processing",
				taskId: "task-processing",
				runId: "run-1",
				status: "processing",
				classification: "stale_processing",
				processorSlot: 1,
				attemptCount: 2,
				statusReason: "Heartbeat is stale",
				recommendedAction: "retry",
			},
		],
	};
}

function todos(): TaskRunTodo[] {
	return [
		{
			id: "todo-1",
			taskId: "task-1",
			runId: "run-1",
			seq: 1,
			title: "Passed todo",
			status: "passed",
			createdAt: now,
			updatedAt: now,
		},
		{
			id: "todo-2",
			taskId: "task-1",
			runId: "run-1",
			seq: 2,
			title: "Running todo",
			status: "running",
			createdAt: now,
			updatedAt: now,
		},
		{
			id: "todo-3",
			taskId: "task-1",
			runId: "run-1",
			seq: 3,
			title: "Human review",
			status: "needs_human",
			createdAt: now,
			updatedAt: now,
		},
		{
			id: "todo-4",
			taskId: "task-1",
			runId: "run-1",
			seq: 4,
			title: "Skipped todo",
			status: "skipped",
			createdAt: now,
			updatedAt: now,
		},
	];
}

function dimensions(): ProjectEvaluationDimensionScore[] {
	return [
		{
			key: "ux",
			label: "UX",
			score: 42,
			confidence: 0.8,
			rationale: "Needs focus",
			evidence: ["screen sample"],
			concerns: ["navigation"],
		},
		{
			key: "reliability",
			label: "Reliability",
			score: 66,
			confidence: 0.7,
			rationale: "Some gaps",
			evidence: ["tests"],
			concerns: ["coverage"],
		},
	];
}

function ideas(): ProjectImprovementIdea[] {
	return [
		{
			id: "11111111-1111-4111-8111-111111111111",
			title: "Improve queue visibility",
			summary: "Expose queue health and retries.",
			agentPrompt: "Improve the queue UI.",
			expectedOutcome: "Operators see stale jobs faster.",
			implementationFocus: ["queue", "health"],
			targetDimensions: ["ux", "reliability"],
			scoreImpacts: [
				{
					dimensionKey: "ux",
					currentScore: 42,
					expectedScoreGain: 12,
					expectedScoreAfter: 54,
					rationale: "More visible state",
				},
			],
			createdAt: now,
		},
	];
}

describe("miscellaneous frontend components", () => {
	it("renders desktop nav, appearance settings, workspace list, and sample showcase", () => {
		const appearanceMarkup = renderToStaticMarkup(
			<AppearanceSettings
				value={defaultBlueprintPreviewDesignSettings}
				onChange={vi.fn()}
			/>,
		);
		const workspaceListMarkup = renderToStaticMarkup(
			<WorkspaceList
				empty="No workspace artifacts"
				items={[
					{
						id: "artifact-1",
						title: "User Flow",
						kind: "user_flow",
						sourceMessageId: "message-1234567890",
						adoptionState: "adopted",
					},
				]}
			/>,
		);
		const showcaseMarkup = renderToStaticMarkup(
			<BlueprintSectionSampleShowcase />,
		);
		const errorMarkup = renderToStaticMarkup(
			<BlueprintSectionSampleShowcaseError />,
		);
		const navMarkup = renderToStaticMarkup(<DesktopNavigationBar />);

		expect(appearanceMarkup).toContain("テーマ");
		expect(workspaceListMarkup).toContain("User Flow");
		expect(showcaseMarkup).toContain("Blueprint sections");
		expect(errorMarkup).toContain("failed to render");
		expect(navMarkup).toContain("NightWorkers");
	});

	it("renders implementation queue dashboard states", () => {
		const markup = renderWithQueryClient(
			<ImplementationQueueScreen
				dashboard={queueDashboard()}
				health={queueHealth()}
				projects={[project()]}
				activeProjectFilterId={null}
				isLoading={false}
				onSetProjectFilter={vi.fn()}
				onOpenSession={vi.fn()}
				onQueueSession={async () => undefined}
				onArchiveEntry={async () => undefined}
				onRecoverEntry={async () => undefined}
				onUpdateProcessorCount={async () => undefined}
			/>,
		);
		const loadingMarkup = renderWithQueryClient(
			<ImplementationQueueScreen
				dashboard={null}
				health={null}
				projects={[project()]}
				activeProjectFilterId="repo-1"
				isLoading={true}
				onSetProjectFilter={vi.fn()}
				onOpenSession={vi.fn()}
				onQueueSession={async () => undefined}
				onArchiveEntry={async () => undefined}
				onRecoverEntry={async () => undefined}
				onUpdateProcessorCount={async () => undefined}
			/>,
		);

		expect(markup).toContain("Queue task queued");
		expect(markup).toContain("Queue task processing");
		expect(markup).toContain("Plan ready task");
		expect(markup).toContain("stale processing");
		expect(loadingMarkup).toContain("NightWorkers");
	});

	it("renders todo workflow and todo progress variants", () => {
		const todoMarkup = renderToStaticMarkup(<TodoListPane todos={todos()} />);
		const runtimePauseMarkup = renderToStaticMarkup(
			<TodoListPane
				todos={todos().filter((todo) => todo.status !== "needs_human")}
				allowRunningTodoResume
				onResume={async () => undefined}
			/>,
		);
		const workflowMarkup = renderWithQueryClient(<TodoWorkflowPanel />);

		expect(todoMarkup).toContain("todolist");
		expect(todoMarkup).toContain("Running todo");
		expect(todoMarkup).toContain("1/4");
		expect(runtimePauseMarkup).toContain("todo-resume-");
		expect(runtimePauseMarkup).toContain("同じTodoを再開できます");
		expect(workflowMarkup).toContain("TODO Workflow");
		expect(workflowMarkup).toContain("review every Todo");
	});

	it("renders project evaluation selection, ideas, and created task links", () => {
		const selectedKeys = new Set(["ux"] as const);
		const selectedIdeaIds = new Set(["11111111-1111-4111-8111-111111111111"]);
		const dimensionMarkup = renderToStaticMarkup(
			<DimensionSelector
				dimensions={dimensions()}
				selectedKeys={selectedKeys}
				onChange={vi.fn()}
			/>,
		);
		const ideaMarkup = renderToStaticMarkup(
			<ImprovementIdeaGrid
				dimensions={dimensions()}
				ideas={ideas()}
				selectedKeys={selectedKeys}
				selectedIdeaIds={selectedIdeaIds}
				isGenerating={false}
				isCreatingTasks={false}
				onGenerate={vi.fn()}
				onToggleIdea={vi.fn()}
				onCreateTasks={vi.fn()}
			/>,
		);
		const emptyIdeaMarkup = renderToStaticMarkup(
			<ImprovementIdeaGrid
				dimensions={dimensions()}
				ideas={[]}
				selectedKeys={new Set()}
				selectedIdeaIds={new Set()}
				isGenerating={true}
				isCreatingTasks={false}
				onGenerate={vi.fn()}
				onToggleIdea={vi.fn()}
				onCreateTasks={vi.fn()}
			/>,
		);
		const linksMarkup = renderToStaticMarkup(
			<ProjectEvaluationTaskLinks
				links={[
					{
						id: "link-1",
						evaluationId: "evaluation-1",
						ideaId: "idea-1",
						taskId: "task-1",
						task: task("task-1", "Created task"),
						createdAt: now,
					},
				]}
			/>,
		);

		expect(dimensionMarkup).toContain("UX");
		expect(ideaMarkup).toContain("Improve queue visibility");
		expect(emptyIdeaMarkup).toContain("選択軸から改善案を生成しています");
		expect(linksMarkup).toContain("Created task");
	});

	it("renders AppearanceSettings with themes and component variants", () => {
		const designSettings = {
			theme: "mint" as const,
			density: "compact" as const,
			shape: "rounded" as const,
			shadow: "soft" as const,
			shadowDirection: "bottom" as const,
			font: "system" as const,
			contrast: "normal" as const,
			motion: "reduced" as const,
			componentVariants: {
				button: "solid" as const,
				card: "filled" as const,
				table: "lined" as const,
				input: "filled" as const,
			},
		};

		const onChange = vi.fn();

		const markup = renderToStaticMarkup(
			<AppearanceSettings value={designSettings} onChange={onChange} />,
		);

		expect(markup).toContain("mint");
		expect(markup).toContain("compact");
		expect(markup).toContain("rounded");
		expect(markup).toContain("blueprint-design-theme-mint");
		expect(markup).toContain("blueprint-design-option-preview-compact");
		expect(markup).toContain("nightworkers-appearance-settings");
		expect(markup).toContain("nightworkers-appearance-options");
		expect(markup).toContain('data-theme="mint"');
	});
});
