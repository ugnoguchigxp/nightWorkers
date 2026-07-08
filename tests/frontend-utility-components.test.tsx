import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { DevErrorPanel } from "../src/components/DevErrorPanel";
import { CodeBlock } from "../src/components/ui/CodeBlock";
import {
	artifactFileName,
	buildArtifactVersions,
	buildExportedArtifactContent,
} from "../src/modules/nightworkers/components/ArtifactPaneVersions";
import { ProjectDetailScreen } from "../src/modules/nightworkers/components/ProjectDetailScreen";
import { emptyMetrics } from "../src/modules/nightworkers/components/project-detail/data";
import { ProjectDetailOverview } from "../src/modules/nightworkers/components/project-detail/ProjectDetailOverview";
import { StackProfilePanel } from "../src/modules/nightworkers/components/project-detail/ProjectDetailStack";
import { MessagePayload } from "../src/modules/nightworkers/components/ThreadTimelineMessagePayload";
import type {
	ActivityArtifact,
	ProjectFileContent,
	Repository,
	TaskMessage,
	TaskRun,
	WorkbenchArtifactRef,
	WorkbenchSessionView,
} from "../src/modules/nightworkers/types";

function message(
	overrides: Partial<TaskMessage> & { metadataJson?: unknown },
): TaskMessage {
	return {
		id: "message-1",
		taskId: "task-1",
		runId: "run-1",
		role: "assistant",
		content: "Hello from assistant",
		messageType: "text",
		metadataJson: {},
		createdAt: "2026-07-08T00:00:00Z",
		...overrides,
	};
}

function project(): Repository {
	return {
		id: "repo-1",
		name: "NightWorkers",
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
		allowed: true,
		queueEnabled: true,
		maxConcurrentSessions: 1,
		createdAt: "2026-07-08T00:00:00Z",
		updatedAt: "2026-07-08T00:00:00Z",
	};
}

function sessionView(
	overrides: Partial<WorkbenchSessionView> = {},
): WorkbenchSessionView {
	return {
		task: {
			id: "task-1",
			repositoryId: "repo-1",
			title: "Improve frontend coverage",
			status: "running",
			timeoutSeconds: 3600,
			priority: 1,
			createdAt: "2026-07-08T00:00:00Z",
			updatedAt: "2026-07-08T00:00:00Z",
		},
		group: "processing",
		emailState: "running",
		primaryAction: "open_run",
		phase: "Implementation",
		progress: {
			completedTodos: 2,
			totalTodos: 4,
			activeTodo: "Add tests",
			latestEventSummary: "Running frontend tests",
		},
		artifactCounts: { app_blueprint: 1 },
		badges: ["coverage"],
		...overrides,
	};
}

describe("frontend utility components", () => {
	it("renders developer error diagnostics with route and stack hints", () => {
		const error = new Error("Broken render");
		error.stack = [
			"Error: Broken render",
			"    at ProjectDetailScreen (/src/modules/nightworkers/components/ProjectDetailScreen.tsx:10:5)",
			"    at NightWorkersShell (/src/modules/nightworkers/components/NightWorkersShell.tsx:20:5)",
		].join("\n");

		const markup = renderToStaticMarkup(
			<DevErrorPanel
				error={error}
				info={{ componentStack: "\n    at ProjectDetailScreen" }}
				reset={vi.fn()}
			/>,
		);

		expect(markup).toContain("Broken render");
		expect(markup).toContain("AI context preview");
		expect(markup).toContain("ProjectDetailScreen.tsx");
		expect(markup).toContain("Route file hints");
	});

	it("renders code blocks with file tabs, icons, and empty states", () => {
		const multiFileMarkup = renderToStaticMarkup(
			<CodeBlock
				data={[
					{
						filename: "package.json",
						language: "json",
						code: '{ "scripts": { "test": "vitest" } }',
					},
					{
						filename: "README.md",
						language: "markdown",
						code: "# NightWorkers",
					},
					{
						filename: "src/app.tsx",
						language: "tsx",
						code: "export const App = () => null;",
					},
				]}
				defaultValue="README.md"
				maxHeight="12rem"
			/>,
		);
		const emptyMarkup = renderToStaticMarkup(
			<CodeBlock data={[]} showHeader={false} lineNumbers={false} />,
		);

		expect(multiFileMarkup).toContain("README.md");
		expect(multiFileMarkup).toContain("NightWorkers");
		expect(multiFileMarkup).toContain("item 2 of 3");
		expect(emptyMarkup).toContain("No code available");
	});

	it("renders message payload variants and artifact cards", () => {
		const openedArtifacts: WorkbenchArtifactRef[] = [];
		const onOpenArtifact = (artifact: WorkbenchArtifactRef) => {
			openedArtifacts.push(artifact);
		};
		const blueprintMarkup = renderToStaticMarkup(
			<MessagePayload
				message={message({
					messageType: "markdown_document",
					content: "Blueprint content",
					metadataJson: {
						appBlueprint: {
							name: "Ops Console",
							description: "An operations dashboard.",
							screens: [
								{
									name: "Home",
									sections: [
										{ id: "hero", name: "Hero" },
										{ id: "table", name: "Table" },
									],
								},
							],
						},
						display: { title: "Ops Console Blueprint" },
						validation: { issues: [{ message: "missing state" }] },
					},
				})}
				onOpenArtifact={onOpenArtifact}
			/>,
		);
		const apiMarkup = renderToStaticMarkup(
			<MessagePayload
				message={message({
					messageType: "api_contract",
					content: "API",
					metadataJson: {
						artifactKind: "plan_mode_api_contract",
						apiContract: {
							title: "Orders API",
							summary: "Order endpoints",
							openapi: {
								paths: {
									"/orders": { get: {}, post: {}, trace: {} },
								},
							},
						},
					},
				})}
				onOpenArtifact={onOpenArtifact}
			/>,
		);
		const zodMarkup = renderToStaticMarkup(
			<MessagePayload
				message={message({
					messageType: "zod_schema",
					content: "Schema",
					metadataJson: {
						artifactKind: "plan_mode_zod_schema",
						zodSchema: {
							title: "Order Schema",
							schemaName: "Order",
							summary: "Order fields",
							fields: [{ name: "id" }, { name: "status" }],
						},
					},
				})}
				onOpenArtifact={onOpenArtifact}
			/>,
		);
		const toolDiffMarkup = renderToStaticMarkup(
			<MessagePayload
				message={message({
					role: "user",
					content: "diff --git a/app.ts b/app.ts",
					metadataJson: {
						intent: "tool_diff",
						toolName: "apply_patch",
						codeBlock: {
							filename: "app.ts",
							language: "diff",
							code: "+const ok = true;",
						},
					},
				})}
				onOpenArtifact={onOpenArtifact}
			/>,
		);
		const chartMarkup = renderToStaticMarkup(
			<MessagePayload
				message={message({
					messageType: "chart",
					metadataJson: { chartData: { series: [1, 2, 3] } },
				})}
				onOpenArtifact={onOpenArtifact}
			/>,
		);

		expect(blueprintMarkup).toContain("Ops Console");
		expect(blueprintMarkup).toContain("2");
		expect(apiMarkup).toContain("Orders API");
		expect(apiMarkup).toContain("2 endpoints");
		expect(zodMarkup).toContain("Order Schema");
		expect(zodMarkup).toContain("2");
		expect(toolDiffMarkup).toContain("apply_patch");
		expect(chartMarkup).toContain("series");
		expect(openedArtifacts).toEqual([]);
	});

	it("builds artifact versions and exported content from messages and activity artifacts", () => {
		const selectedArtifact: WorkbenchArtifactRef = {
			id: "selected-1",
			taskId: "task-1",
			runId: "run-1",
			kind: "app_blueprint",
			title: "Selected Blueprint",
			summary: "Selected",
			source: { type: "task_message", messageId: "message-selected" },
			createdAt: "2026-07-08T00:03:00Z",
			metadata: { selected: true },
		};
		const taskMessage = message({
			id: "message-2",
			messageType: "markdown_document",
			content: "Message blueprint",
			metadataJson: {
				appBlueprint: { name: "Message Blueprint" },
				display: { summary: "Message summary" },
			},
			createdAt: "2026-07-08T00:01:00Z",
		});
		const activityArtifact: ActivityArtifact = {
			id: "artifact-1",
			taskId: "task-1",
			runId: "run-1",
			kind: "app_blueprint",
			path: "blueprint.md",
			contentText: "Activity blueprint",
			metadataJson: {
				mockBlueprint: { name: "Activity Blueprint" },
				summary: "Activity summary",
			},
			createdAt: "2026-07-08T00:02:00Z",
		};
		const latestRun = {
			id: "run-1",
			diffPatch: "diff --git a/app.ts b/app.ts",
		} as TaskRun;
		const selectedFile: ProjectFileContent = {
			path: "src/app.ts",
			content: "export const ok = true;",
			size: 23,
			truncated: false,
		};

		const versions = buildArtifactVersions(
			selectedArtifact,
			[taskMessage],
			[activityArtifact],
		);

		expect(versions.map((artifact) => artifact.title)).toEqual([
			"Message Blueprint",
			"Activity Blueprint",
			"Selected Blueprint",
		]);
		expect(
			buildExportedArtifactContent({
				showDiff: true,
				latestRun,
				selectedMessage: null,
				selectedActivityArtifact: null,
				selectedFile: null,
				selectedArtifact,
			}),
		).toContain("diff --git");
		expect(
			buildExportedArtifactContent({
				showDiff: false,
				selectedMessage: taskMessage,
				selectedActivityArtifact: activityArtifact,
				selectedFile,
				selectedArtifact,
			}),
		).toBe("Activity blueprint");
		expect(artifactFileName(selectedArtifact)).toBe("selected-blueprint.md");
	});

	it("renders project detail overview and stack panels with populated metrics", () => {
		const metrics = {
			...emptyMetrics,
			stackProfile: {
				summary: "React + Hono",
				manifestStatus: "found" as const,
				manifestPath: "package.json",
				packageManager: "bun",
				technologies: [
					{
						name: "React",
						category: "frontend" as const,
						packageName: "react",
						version: "19.2.4",
						source: "package_json" as const,
						confidence: "high" as const,
					},
					{
						name: "Hono",
						category: "backend" as const,
						packageName: "hono",
						version: "4.12.21",
						source: "package_json" as const,
						confidence: "high" as const,
					},
				],
			},
			projectMeta: {
				version: 1,
				scannedAt: "2026-07-08T00:00:00Z",
				scanDurationMs: 120,
				git: {
					head: "abcdef123456",
					shortHead: "abcdef1",
					displayHead: "main@abcdef1",
					committedAt: "2026-07-08T00:00:00Z",
					status: "available",
				},
				files: {
					total: 120,
					source: 80,
					tests: 40,
					sourceLoc: 12_000,
				},
				ontology: {
					moduleCount: 12,
					available: true,
				},
				fileScale: {
					value: "medium",
					score: 3,
				},
			},
			runs: { total: 12, completed: 8, failed: 1 },
			llmUsage: {
				...emptyMetrics.llmUsage,
				totalTokens: 120_000,
				inputTokens: 80_000,
				outputTokens: 40_000,
				cachedInputTokens: 10_000,
				reasoningOutputTokens: 2_000,
				stateCardTokens: 3_000,
				promptInputTokens: 5_000,
				outputTokensPerSecond: 24.5,
				totalCost: 12.34,
				averageTokensPerRun: 10_000,
				averageCostPerRun: 1.23,
			},
			health: { latestEvaluationScore: 82, coverageAverage: 80.1 },
		};
		const overviewMarkup = renderToStaticMarkup(
			<ProjectDetailOverview
				metrics={metrics}
				totalRuns={12}
				completedCount={8}
				modelUsageRows={[
					{
						model: "gpt-test",
						role: "implementation",
						calls: 4,
						tokens: 12_000,
						inputTokens: 8_000,
						outputTokens: 4_000,
						cachedInputTokens: 1_000,
						reasoningOutputTokens: 200,
						outputTokensPerSecond: 24.5,
						cost: "$1.23",
					},
				]}
				topTokenTasks={[
					{
						title: "Coverage task",
						phase: "task-1",
						tokens: 12_000,
						inputTokens: 8_000,
						outputTokens: 4_000,
						cachedInputTokens: 1_000,
						reasoningOutputTokens: 200,
						outputTokensPerSecond: 24.5,
						cost: "$1.23",
						sessionId: "task-1",
					},
				]}
				coverageAxes={[
					{ labelKey: "projectDetail.coverage.statements", value: 80.06 },
					{ labelKey: "projectDetail.coverage.lines", value: 82.61 },
				]}
				onOpenSession={vi.fn()}
			/>,
		);
		const stackMarkup = renderToStaticMarkup(
			<StackProfilePanel
				stackProfile={metrics.stackProfile}
				projectPath="/Users/y.noguchi/Code/nightWorkers"
			/>,
		);

		expect(overviewMarkup).toContain("React + Hono");
		expect(overviewMarkup).toContain("gpt-test");
		expect(overviewMarkup).toContain("Coverage task");
		expect(stackMarkup).toContain("React");
		expect(stackMarkup).toContain("Hono");
		expect(stackMarkup).toContain("package.json");
	});

	it("renders project detail screen tab surfaces without fetching during SSR", () => {
		const queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		const renderedTabs = [
			"overview",
			"mission",
			"evaluation",
			"quality",
			"stack",
		].map((activeTab) =>
			renderToStaticMarkup(
				<QueryClientProvider client={queryClient}>
					<ProjectDetailScreen
						project={project()}
						sessionViews={[
							sessionView(),
							sessionView({
								task: {
									...sessionView().task,
									id: "task-2",
									title: "Review generated tests",
									status: "completed",
								},
								group: "archive",
								emailState: "done",
								primaryAction: "open",
							}),
						]}
						activeTab={
							activeTab as
								| "overview"
								| "mission"
								| "evaluation"
								| "quality"
								| "stack"
						}
						onActiveTabChange={vi.fn()}
						onOpenSession={vi.fn()}
						onEvaluationTasksCreated={vi.fn()}
					/>
				</QueryClientProvider>,
			),
		);

		const combinedMarkup = renderedTabs.join("\n");
		expect(combinedMarkup).toContain("NightWorkers");
		expect(combinedMarkup).toContain("タスク生成");
		expect(combinedMarkup).toContain("品質");
		expect(combinedMarkup).toContain("Project Evaluation");
		expect(combinedMarkup).toContain("未検出");
		queryClient.clear();
	});
});
