// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonByLabel, clickDom, flushDom, mountDom } from "./dom-test-utils";

function evaluation(status: "running" | "completed") {
	return {
		id: "evaluation-1",
		repositoryId: "repo-1",
		status,
		overallScore: 82,
		summary: "The repository is in good shape.",
		dimensionsJson: [],
		createdAt: "2026-08-16T00:00:00.000Z",
		updatedAt: "2026-08-16T00:00:00.000Z",
		dimensions: [
			{
				key: "code_quality",
				label: "Code quality",
				description: "Maintainability",
				score: 82,
			},
		],
	};
}

async function loadProjectEvaluationScreen() {
	vi.resetModules();
	const runEvaluation = vi.fn();
	const controller = {
		detail: null as null | {
			evaluation: ReturnType<typeof evaluation>;
			activityEvents: Array<Record<string, unknown>>;
			improvements: [];
			taskLinks: [];
		},
		history: [] as Array<ReturnType<typeof evaluation>>,
		activityEvents: [] as Array<Record<string, unknown>>,
		isRunning: false,
		isLoading: true,
		isViewingRunningEvaluation: false,
		isCreatingTasks: false,
		isGenerating: false,
		selectedKeys: new Set<string>(),
		selectedIdeaIds: new Set<string>(),
		error: null as string | null,
		previousEvaluation: null,
		runEvaluation,
		selectEvaluation: vi.fn(),
		setSelectedKeys: vi.fn(),
		toggleIdea: vi.fn(),
		generateIdeas: vi.fn(),
		createTasks: vi.fn(),
	};
	vi.doMock(
		"../src/modules/project-evaluation/hooks/useProjectEvaluationController",
		() => ({ useProjectEvaluationController: () => controller }),
	);

	const { ProjectEvaluationScreen } = await import(
		"../src/modules/project-evaluation/components/ProjectEvaluationScreen"
	);
	return { ProjectEvaluationScreen, controller, runEvaluation };
}

const project = {
	id: "repo-1",
	name: "NightWorkers",
	localPath: "/work/nightworkers",
	createdAt: "2026-08-16T00:00:00.000Z",
	updatedAt: "2026-08-16T00:00:00.000Z",
};

describe("ProjectEvaluationScreen behavior", () => {
	afterEach(() => document.body.replaceChildren());

	it("shows loading, exposes an alert with a rerun action, and switches back to the completed result after activity", async () => {
		const module = await loadProjectEvaluationScreen();
		const screen = await mountDom(
			<module.ProjectEvaluationScreen project={project} />,
		);
		const emptyRunButton = buttonByLabel(screen.container, "LLMに依頼中");
		expect((emptyRunButton as HTMLButtonElement).disabled).toBe(true);

		module.controller.isLoading = false;
		module.controller.detail = {
			evaluation: evaluation("completed"),
			activityEvents: [],
			improvements: [],
			taskLinks: [],
		};
		module.controller.error = "Evaluation request failed";
		await screen.rerender(<module.ProjectEvaluationScreen project={project} />);
		expect(
			screen.container.querySelector('[role="alert"]')?.textContent,
		).toContain("Evaluation request failed");
		await clickDom(buttonByLabel(screen.container, "評価を実行"));
		expect(module.runEvaluation).toHaveBeenCalledOnce();

		module.controller.error = null;
		module.controller.isRunning = true;
		module.controller.isViewingRunningEvaluation = true;
		module.controller.detail = {
			evaluation: evaluation("running"),
			activityEvents: [
				{
					id: "event-1",
					seq: 1,
					evaluationId: "evaluation-1",
					phase: "judge",
					level: "info",
					source: "structured-llm",
					message: "Evaluating repository",
					createdAt: "2026-08-16T00:00:00.000Z",
				},
			],
			improvements: [],
			taskLinks: [],
		};
		module.controller.activityEvents = module.controller.detail.activityEvents;
		await screen.rerender(<module.ProjectEvaluationScreen project={project} />);
		await flushDom();
		expect(screen.container.textContent).toContain("LLM アクティビティ");

		module.controller.isRunning = false;
		module.controller.isViewingRunningEvaluation = false;
		module.controller.detail = {
			evaluation: evaluation("completed"),
			activityEvents: [],
			improvements: [],
			taskLinks: [],
		};
		module.controller.activityEvents = [];
		await screen.rerender(<module.ProjectEvaluationScreen project={project} />);
		await flushDom();
		expect(screen.container.textContent).toContain(
			"The repository is in good shape.",
		);
		await screen.unmount();
	});
});
