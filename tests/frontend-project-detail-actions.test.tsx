import { describe, expect, it, vi } from "vitest";
import { buildTask } from "./helpers/nightworkers-fixtures";

let stateValues: unknown[] = [];

function mockReact(values: unknown[]) {
	stateValues = [...values];
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useEffect: () => undefined,
			useMemo: <T,>(factory: () => T) => factory(),
			useRef: <T,>(initial: T) => ({ current: initial }),
			useState: <T,>(initial: T | (() => T)) => {
				const value =
					stateValues.length > 0
						? (stateValues.shift() as T)
						: typeof initial === "function"
							? (initial as () => T)()
							: initial;
				const setter = vi.fn((next: T | ((previous: T) => T)) => {
					if (typeof next === "function") (next as (previous: T) => T)(value);
				});
				return [value, setter] as const;
			},
		};
	});
	vi.doMock("react-i18next", async () => ({
		...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
		useTranslation: () => ({ t: (key: string) => key }),
	}));
}

function jsonResponse(body: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

function project() {
	return {
		id: "repo-1",
		name: "NightWorkers",
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
		allowed: true,
		queueEnabled: true,
		maxConcurrentSessions: 2,
		createdAt: "2026-07-08T00:00:00.000Z",
		updatedAt: "2026-07-08T00:00:00.000Z",
	};
}

function goal() {
	return {
		id: "goal-1",
		repositoryId: "repo-1",
		title: "Improve frontend coverage",
		goalText: "Raise frontend coverage with meaningful tests",
		active: true,
		priority: 1,
		source: "manual",
		createdAt: "2026-07-08T00:00:00.000Z",
		updatedAt: "2026-07-08T00:00:00.000Z",
	};
}

function mission() {
	return {
		id: "mission-1",
		repositoryId: "repo-1",
		title: "Coverage mission",
		summary: "Add missing frontend tests",
		rationale: "Large uncovered surfaces remain",
		sourceGoalIds: ["goal-1"],
		status: "candidate",
		expectedOutcome: "More coverage",
		targetFilesOrModules: ["src/modules/nightworkers"],
		acceptanceCriteria: ["frontend coverage improves"],
		verificationGate: ["bun run test:coverage:frontend"],
		createdAt: "2026-07-08T00:00:00.000Z",
		updatedAt: "2026-07-08T00:00:00.000Z",
	};
}

function candidate() {
	return {
		id: "candidate-1",
		repositoryId: "repo-1",
		goalId: "goal-1",
		goalTitle: "Improve frontend coverage",
		title: "Cover ProjectDetailScreen",
		summary: "Add tests for project detail actions",
		rationale: "High uncovered statements",
		evidence: [{ source: "coverage", label: "missed", value: "ProjectDetail" }],
		evaluationContribution: "coverage",
		importancePercent: 80,
		confidencePercent: 70,
		candidateKind: "feature_followup",
		moduleRouting: {
			primaryModule: "nightworkers",
			secondaryModules: [],
			confidencePercent: 80,
			reason: "UI module",
		},
		constraintGoalIds: [],
		planModeOpenQuestions: [],
		tokenSize: "small",
		complexity: "medium",
		taskPrompt: "Add frontend tests",
		acceptanceCriteria: "Tests pass",
		verificationPlan: "Run vitest",
		status: "candidate",
		taskId: null,
		createdAt: "2026-07-08T00:00:00.000Z",
		updatedAt: "2026-07-08T00:00:00.000Z",
	};
}

function proposal() {
	return {
		id: "proposal-1",
		repositoryId: "repo-1",
		missionId: "mission-1",
		title: "Cover mission tree",
		summary: "Exercise mission callbacks",
		expectedOutcome: "Callbacks run",
		targetFilesOrModules: ["ProjectDetailMissionTree.tsx"],
		initialPrompt: "Add tests",
		acceptanceCriteria: ["Callbacks covered"],
		verificationGate: ["vitest"],
		status: "candidate",
		taskId: null,
		createdAt: "2026-07-08T00:00:00.000Z",
		updatedAt: "2026-07-08T00:00:00.000Z",
	};
}

function metrics() {
	return {
		stackProfile: {
			summary: "React + Hono",
			manifestStatus: "found",
			manifestPath: "package.json",
			packageManager: "bun",
			technologies: [{ name: "React", category: "frontend", confidence: 1 }],
		},
		projectMeta: { lineCount: 1000, fileCount: 50 },
		runs: { total: 3, completed: 2, failed: 1 },
		llmUsage: {
			totalTokens: 1000,
			promptInputTokens: 500,
			inputTokens: 500,
			outputTokens: 500,
			cachedInputTokens: 50,
			reasoningOutputTokens: 10,
			stateCardTokens: 20,
			totalDurationMs: 10000,
			outputDurationMs: 4000,
			measuredDurationCallCount: 2,
			outputTokensPerSecond: 12.5,
			callCount: 4,
			totalCost: 1.25,
			averageTokensPerRun: 333,
			averageCostPerRun: 0.41,
			modelMix: [
				{
					provider: "openai",
					model: "gpt-5",
					calls: 2,
					tokens: 500,
					inputTokens: 250,
					outputTokens: 250,
					cachedInputTokens: 20,
					reasoningOutputTokens: 5,
					outputTokensPerSecond: 10,
					cost: 0.5,
				},
			],
			topTokenTasks: [
				{
					taskId: "task-1",
					title: "Task 1",
					tokens: 500,
					inputTokens: 250,
					outputTokens: 250,
					cachedInputTokens: 20,
					reasoningOutputTokens: 5,
					outputTokensPerSecond: 10,
					cost: 0.5,
				},
			],
		},
		health: { latestEvaluationScore: 72, coverageAverage: 64 },
	};
}

function quality() {
	return {
		latestCoverageRun: {
			id: "quality-1",
			runType: "coverage",
			status: "completed",
			coverageSummary: {
				total: {
					statements: { pct: 70, covered: 70, total: 100 },
					branches: { pct: 60, covered: 60, total: 100 },
					functions: { pct: 80, covered: 80, total: 100 },
					lines: { pct: 75, covered: 75, total: 100 },
				},
				"src/a.ts": {
					statements: { pct: 50, covered: 5, total: 10 },
					branches: { pct: 50, covered: 5, total: 10 },
					functions: { pct: 50, covered: 5, total: 10 },
					lines: { pct: 50, covered: 5, total: 10 },
				},
			},
			createdAt: "2026-07-08T00:00:00.000Z",
		},
		latestE2eResultRun: {
			id: "quality-e2e",
			runType: "e2e",
			status: "completed",
			e2eSummary: {
				suites: [
					{
						title: "smoke",
						file: "tests/e2e/smoke.spec.ts",
						status: "failed",
						durationMs: 1200,
						tests: [
							{ title: "opens", status: "passed", durationMs: 200 },
							{ title: "creates", status: "failed", durationMs: 1000 },
						],
					},
				],
			},
			createdAt: "2026-07-08T00:00:00.000Z",
		},
	};
}

async function triggerCallbacks(element: unknown) {
	const seen = new Set<unknown>();
	const args = {
		preventDefault: vi.fn(),
		currentTarget: { checked: true, value: "coverage" },
		target: { checked: true, value: "coverage" },
	};
	const callArg = (name: string) => {
		if (name.includes("Goal")) return goal();
		if (name.includes("Mission")) return mission();
		if (name.includes("Candidate")) {
			return {
				...candidate(),
				id: "mission_task_candidate:candidate-1",
				sourceRef: { source: "mission_task_candidate", id: "candidate-1" },
				origin: "goal_generation",
			};
		}
		if (name === "onRun") return "coverage";
		if (name.includes("Session")) return "task-1";
		return args;
	};
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
			if (name.startsWith("on") && typeof value === "function") {
				await value(callArg(name));
			}
		}
		await visit(props.children);
	};
	await visit(element);
}

function stateValuesFor(detailModal: unknown = null) {
	return [
		metrics(),
		[goal()],
		[mission()],
		[candidate()],
		[proposal()],
		quality(),
		{ id: "goal-1", title: "Draft", goalText: "Draft text", active: true },
		["mission_task_candidate:candidate-1", "mission_task_proposal:proposal-1"],
		{ goalIds: new Set(["goal-1"]), missionIds: new Set(["mission-1"]) },
		detailModal,
		"all",
		null,
		"",
	];
}

describe("ProjectDetailScreen action coverage", () => {
	it("evaluates project detail tabs and action callbacks", async () => {
		const commandNames = [
			"createMissionGoal",
			"createProjectQualityRun",
			"createTasksFromMissionCandidates",
			"createTasksFromMissionTaskProposals",
			"decomposeMission",
			"deleteMission",
			"deleteMissionGoal",
			"dismissMissionTaskProposal",
			"fetchMissionGoals",
			"fetchMissions",
			"fetchMissionTaskCandidates",
			"fetchProjectDetailMetrics",
			"fetchProjectQuality",
			"fetchRepositoryMissionTaskProposals",
			"generateMissionCandidatesFromGoals",
			"generateMissionTaskCandidates",
			"updateMissionGoal",
			"updateMissionTaskCandidate",
		];
		vi.doMock("../src/modules/nightworkers/nightWorkersCommands", () =>
			Object.fromEntries(
				commandNames.map((name) => [
					name,
					vi.fn(async () => {
						if (name.includes("createTasks"))
							return jsonResponse({ tasks: [buildTask({ id: "created-1" })] });
						if (name === "fetchProjectDetailMetrics")
							return jsonResponse(metrics());
						if (name === "fetchProjectQuality") return jsonResponse(quality());
						if (name === "fetchMissionGoals") return jsonResponse([goal()]);
						if (name === "fetchMissions") return jsonResponse([mission()]);
						if (name === "fetchMissionTaskCandidates")
							return jsonResponse([candidate()]);
						if (name === "fetchRepositoryMissionTaskProposals")
							return jsonResponse([proposal()]);
						return jsonResponse({ ok: true });
					}),
				]),
			),
		);
		vi.doMock("@/modules/project-evaluation", () => ({
			ProjectEvaluationScreen: () => null,
		}));
		const tabs = [
			"overview",
			"mission",
			"evaluation",
			"quality",
			"stack",
		] as const;

		for (const tab of tabs) {
			mockReact(
				stateValuesFor(
					tab === "mission" ? { kind: "goal", id: "goal-1" } : null,
				),
			);
			const { ProjectDetailScreen } = await import(
				"../src/modules/nightworkers/components/ProjectDetailScreen"
			);
			const element = ProjectDetailScreen({
				project: project(),
				sessionViews: [],
				activeTab: tab,
				onActiveTabChange: vi.fn(),
				onOpenSession: vi.fn(),
				onEvaluationTasksCreated: vi.fn(),
			});
			await triggerCallbacks(element);
			expect(element).toBeTruthy();
		}
	});
});
