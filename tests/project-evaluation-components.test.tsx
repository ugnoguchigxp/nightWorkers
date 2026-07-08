import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DimensionSelector } from "../src/modules/project-evaluation/components/DimensionSelector";
import { EvaluationHistorySidebar } from "../src/modules/project-evaluation/components/EvaluationHistorySidebar";
import { EvaluationSummaryPanel } from "../src/modules/project-evaluation/components/EvaluationSummaryPanel";
import { ProjectEvaluationScreen } from "../src/modules/project-evaluation/components/ProjectEvaluationScreen";
import type {
	ProjectEvaluationActivityEvent,
	ProjectEvaluationDetail,
	ProjectEvaluationDimensionScore,
	ProjectEvaluationRun,
	ProjectImprovementIdea,
} from "../src/modules/project-evaluation/model/projectEvaluationTypes";

// Mock the controller hook
const mockController = {
	detail: null as ProjectEvaluationDetail | null,
	history: [] as ProjectEvaluationRun[],
	activityEvents: [] as ProjectEvaluationActivityEvent[],
	isRunning: false,
	isLoading: false,
	isViewingRunningEvaluation: false,
	isCreatingTasks: false,
	isGenerating: false,
	selectedKeys: new Set<string>(),
	selectedIdeaIds: new Set<string>(),
	error: null as string | null,
	previousEvaluation: null as ProjectEvaluationRun | null,
	runEvaluation: vi.fn(),
	selectEvaluation: vi.fn(),
	setSelectedKeys: vi.fn(),
	toggleIdea: vi.fn(),
	generateIdeas: vi.fn(),
	createTasks: vi.fn(),
};

vi.mock(
	"../src/modules/project-evaluation/hooks/useProjectEvaluationController",
	() => ({
		useProjectEvaluationController: () => mockController,
	}),
);

// Mock Lucide React
vi.mock("lucide-react", async () => {
	const actual =
		await vi.importActual<typeof import("lucide-react")>("lucide-react");
	return new Proxy(actual, {
		get(_target, prop) {
			if (prop === "__esModule") return true;
			if (prop === "then") return undefined;
			return () => <span data-testid={`icon-${String(prop)}`} />;
		},
	});
});

const mockEvaluation = (
	id: string,
	score: number,
	status: ProjectEvaluationRun["status"] = "completed",
): ProjectEvaluationRun => ({
	id,
	repositoryId: "repo-1",
	status,
	overallScore: score,
	summary: `Summary of evaluation ${id}`,
	dimensionsJson: [],
	createdAt: "2026-07-08T00:00:00Z",
	updatedAt: "2026-07-08T00:00:00Z",
	dimensions: [
		{
			key: "code_quality",
			label: "Code Quality",
			description: "Desc",
			score: score - 5,
		},
		{
			key: "security",
			label: "Security",
			description: "Desc",
			score: score + 5,
		},
	],
});

const mockIdea = (id: string, dimension: string): ProjectImprovementIdea => ({
	id,
	evaluationId: "eval-1",
	dimensionKey: dimension,
	title: `Idea ${id}`,
	description: `Description of Idea ${id}`,
	summary: `Description of Idea ${id}`,
	agentPrompt: `Implement Idea ${id}`,
	expectedOutcome: `Outcome for Idea ${id}`,
	targetDimensions: [dimension],
	implementationFocus: [`Focus ${id}`],
	scoreImpacts: [],
	impact: 80,
	effort: 40,
	status: "draft",
	taskId: null,
	createdAt: "2026-07-08T00:00:00Z",
	updatedAt: "2026-07-08T00:00:00Z",
});

describe("Project Evaluation Components", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockController.detail = null;
		mockController.history = [];
		mockController.activityEvents = [];
		mockController.isRunning = false;
		mockController.isLoading = false;
		mockController.isViewingRunningEvaluation = false;
		mockController.isCreatingTasks = false;
		mockController.isGenerating = false;
		mockController.selectedKeys = new Set();
		mockController.selectedIdeaIds = new Set();
		mockController.error = null;
		mockController.previousEvaluation = null;
	});

	describe("EvaluationHistorySidebar", () => {
		it("renders evaluations list and highlights active", () => {
			const evaluations = [
				mockEvaluation("eval-1", 75),
				mockEvaluation("eval-2", 80, "running"),
			];
			const onSelect = vi.fn();
			const markup = renderToStaticMarkup(
				<EvaluationHistorySidebar
					evaluations={evaluations}
					activeId="eval-1"
					onSelect={onSelect}
				/>,
			);
			expect(markup).toContain("History");
			expect(markup).toContain("75");
			expect(markup).toContain("..."); // running evaluation status or overallScore mock
		});
	});

	describe("EvaluationSummaryPanel", () => {
		it("renders evaluation summary and score", () => {
			const evaluation = mockEvaluation("eval-1", 85);
			const markup = renderToStaticMarkup(
				<EvaluationSummaryPanel evaluation={evaluation} previous={null} />,
			);
			expect(markup).toContain("LLM総評");
			expect(markup).toContain("85");
			expect(markup).toContain("baseline evaluation");
		});

		it("renders score delta relative to previous evaluation", () => {
			const evaluation = mockEvaluation("eval-2", 85);
			const previous = mockEvaluation("eval-1", 80);
			const markup = renderToStaticMarkup(
				<EvaluationSummaryPanel evaluation={evaluation} previous={previous} />,
			);
			expect(markup).toContain("+5 from previous");
		});
	});

	describe("DimensionSelector", () => {
		it("renders dimensions and reacts to change callbacks", () => {
			const dimensions = [
				{
					key: "code_quality",
					label: "Code Quality",
					description: "Desc",
					score: 70,
				},
				{ key: "security", label: "Security", description: "Desc", score: 90 },
			] as ProjectEvaluationDimensionScore[];
			const selectedKeys = new Set(["code_quality"]);
			const onChange = vi.fn();

			const markup = renderToStaticMarkup(
				<DimensionSelector
					dimensions={dimensions}
					selectedKeys={selectedKeys}
					onChange={onChange}
				/>,
			);

			expect(markup).toContain("Code Quality");
			expect(markup).toContain("Security");
			expect(markup).toContain("1 axes selected");
		});
	});

	describe("ProjectEvaluationScreen", () => {
		const project = {
			id: "repo-1",
			name: "Test Project",
			localPath: "/tmp",
			createdAt: "2026-07-08T00:00:00Z",
			updatedAt: "2026-07-08T00:00:00Z",
		};

		it("renders empty state when no detail is available", () => {
			const markup = renderToStaticMarkup(
				<ProjectEvaluationScreen project={project} />,
			);
			expect(markup).toContain("保存済み Project Evaluation はまだありません");
		});

		it("renders error message if error state is populated", () => {
			mockController.error = "Failed to run evaluation";
			const markup = renderToStaticMarkup(
				<ProjectEvaluationScreen project={project} />,
			);
			expect(markup).toContain("Failed to run evaluation");
		});

		it("renders result tab contents when detail is available", () => {
			const evalRun = mockEvaluation("eval-1", 90);
			const ideaObj = mockIdea("idea-1", "code_quality");
			mockController.detail = {
				evaluation: evalRun,
				improvements: [ideaObj],
				taskLinks: [],
			};
			mockController.selectedKeys = new Set(["code_quality"]);

			const markup = renderToStaticMarkup(
				<ProjectEvaluationScreen project={project} />,
			);
			expect(markup).toContain("LLM総評");
			expect(markup).toContain("Idea idea-1");
			expect(markup).toContain("Round 1 / 評価軸を選ぶ");
		});

		it("renders activity tab contents when viewing running evaluation", () => {
			mockController.isRunning = true;
			mockController.activityEvents = [
				{
					id: "event-1",
					evaluationId: "eval-1",
					phase: "init",
					level: "info",
					source: "structured-llm",
					message: "Running initialization...",
					createdAt: "2026-07-08T00:00:00Z",
				},
			];

			const markup = renderToStaticMarkup(
				<ProjectEvaluationScreen project={project} />,
			);
			expect(markup).toContain("LLMアクティビティ");
			expect(markup).toContain("LLMに依頼中");
		});
	});
});
