import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	getMissionGoalTemplatesForStack,
	missionGoalTemplates,
} from "../shared/mission-goal-templates";
import type { ProjectStackProfile } from "../shared/schemas/project-detail.schema";
import "../src/i18n/setup";
import {
	applyMissionGoalTemplate,
	buildExpandedTaskGenerationState,
	buildTaskGenerationTreeRows,
	buildUnifiedTaskCandidates,
	coverageAxesFromQualityRun,
	GoalEditorDialog,
	QualityReportPanel,
	TaskGenerationTreeTable,
	toggleMissionGoalTemplate,
} from "../src/modules/nightworkers/components/ProjectDetailScreen";
import { coverageRowsFromSummary } from "../src/modules/nightworkers/qualityRows";

const stackProfile = (
	technologies: ProjectStackProfile["technologies"],
): ProjectStackProfile => ({
	summary: technologies.map((technology) => technology.name).join(" + "),
	manifestStatus: "found",
	manifestPath: "/tmp/package.json",
	packageManager: "bun",
	technologies,
});

const fullTemplateStack = stackProfile([
	{
		name: "React",
		category: "frontend",
		packageName: "react",
		version: "19.2.4",
		source: "package_json",
		confidence: "high",
	},
	{
		name: "i18next",
		category: "tooling",
		packageName: "react-i18next",
		version: "17.0.8",
		source: "package_json",
		confidence: "high",
	},
	{
		name: "Tailwind CSS",
		category: "frontend",
		packageName: "tailwindcss",
		version: "4.0.0",
		source: "package_json",
		confidence: "high",
	},
]);

describe("TaskGenerationTreeTable", () => {
	const goal = {
		id: "11111111-1111-4111-8111-111111111111",
		repositoryId: "22222222-2222-4222-8222-222222222222",
		title: "品質を安定させる",
		goalText: "リリース前の品質を安定させる。",
		active: true,
		source: "user" as const,
		sortOrder: 0,
		interpretation: {
			scope: "unknown" as const,
			intent: "unknown" as const,
			source: "unknown" as const,
			confidencePercent: 0,
			reason: null,
		},
		createdAt: new Date("2026-07-04T00:00:00.000Z"),
		updatedAt: new Date("2026-07-04T00:00:00.000Z"),
	};
	const mission = {
		id: "33333333-3333-4333-8333-333333333333",
		repositoryId: goal.repositoryId,
		title: "品質ゲート整備",
		goalText: "品質ゲートを整備する。",
		nonGoals: [],
		status: "draft" as const,
		sourceGoalIds: [goal.id],
		latestPlanningResultId: null,
		statusReason: "複数タスクに分解する必要がある。",
		createdAt: new Date("2026-07-04T00:01:00.000Z"),
		updatedAt: new Date("2026-07-04T00:01:00.000Z"),
	};
	const candidate = {
		id: "44444444-4444-4444-8444-444444444444",
		batchId: "55555555-5555-4555-8555-555555555555",
		repositoryId: goal.repositoryId,
		goalId: goal.id,
		goalTitle: goal.title,
		candidateKind: "constraint_enablement" as const,
		moduleRouting: {
			primaryModule: "quality",
			secondaryModules: [] as string[],
			confidencePercent: 75,
			reason: "coverage capability が不足している。",
		},
		constraintGoalIds: [] as string[],
		planModeOpenQuestions: [] as string[],
		title: "coverage script を追加",
		summary: "coverage を実行できるようにする。",
		rationale: "品質ゲートに必要。",
		evidence: [
			{ source: "quality" as const, label: "missing", value: "coverage" },
		],
		evaluationContribution: 20,
		importancePercent: 80,
		confidencePercent: 70,
		tokenSize: "small" as const,
		complexity: "simple" as const,
		taskPrompt: "coverage script を追加してください。",
		acceptanceCriteria: "coverage が実行できる。",
		verificationPlan: "bun run test:coverage",
		status: "candidate" as const,
		taskId: null,
		createdAt: new Date("2026-07-04T00:02:00.000Z"),
		updatedAt: new Date("2026-07-04T00:02:00.000Z"),
	};
	const proposal = {
		id: "66666666-6666-4666-8666-666666666666",
		missionId: mission.id,
		planningResultId: "77777777-7777-4777-8777-777777777777",
		repositoryId: goal.repositoryId,
		workPackageId: "quality-gate",
		decompositionTaskId: "quality-gate-task",
		status: "proposed" as const,
		title: "verify gate を接続",
		summary: "verify gate を Mission から分解した候補。",
		initialPrompt: "verify gate を接続してください。",
		expectedOutcome: "verify gate が動く。",
		implementationFocus: ["api/modules/project-detail"],
		acceptanceCriteria: ["verify が通る"],
		verificationGate: ["bun run verify"],
		dependencies: [],
		targetFilesOrModules: ["api/modules/project-detail"],
		risk: "medium" as const,
		approvalRequired: false,
		scheduling: {
			executionType: "normal" as const,
			reason: "単独で実行できる。",
			sequenceGroupId: null,
			sequenceOrder: null,
			dependsOnTaskIds: [],
		},
		taskId: null,
		createdAt: new Date("2026-07-04T00:03:00.000Z"),
		updatedAt: new Date("2026-07-04T00:03:00.000Z"),
	};

	it("normalizes mission candidates and mission decomposition results into one candidate shape", () => {
		const unified = buildUnifiedTaskCandidates([candidate], [proposal]);

		expect(unified).toMatchObject([
			{
				id: `mission_task_candidate:${candidate.id}`,
				goalId: goal.id,
				missionId: null,
				origin: "goal_generation",
				importancePercent: 80,
			},
			{
				id: `mission_task_proposal:${proposal.id}`,
				goalId: null,
				missionId: mission.id,
				origin: "mission_decomposition",
				importancePercent: null,
			},
		]);
	});

	it("builds Goal -> Mission -> TaskCandidate rows with expansion state", () => {
		const unified = buildUnifiedTaskCandidates([candidate], [proposal]);
		const rows = buildTaskGenerationTreeRows({
			goals: [goal],
			missions: [mission],
			candidates: unified,
			expanded: {
				goalIds: new Set([goal.id]),
				missionIds: new Set([mission.id]),
			},
		});

		expect(rows.map((row) => `${row.kind}:${row.depth}:${row.id}`)).toEqual([
			`goal:0:${goal.id}`,
			`mission:1:${mission.id}`,
			`task_candidate:2:mission_task_proposal:${proposal.id}`,
			`task_candidate:1:mission_task_candidate:${candidate.id}`,
		]);
	});

	it("builds all-expanded state for task candidate tree parents", () => {
		const unified = buildUnifiedTaskCandidates([candidate], [proposal]);
		const expanded = buildExpandedTaskGenerationState({
			goals: [goal],
			missions: [mission],
			candidates: unified,
		});

		expect([...expanded.goalIds]).toEqual([goal.id]);
		expect([...expanded.missionIds]).toEqual([mission.id]);
	});

	it("renders the tree table without a Goal / Signal column", () => {
		const unified = buildUnifiedTaskCandidates([candidate], [proposal]);
		const rows = buildTaskGenerationTreeRows({
			goals: [goal],
			missions: [mission],
			candidates: unified,
			expanded: {
				goalIds: new Set([goal.id]),
				missionIds: new Set([mission.id]),
			},
		});
		const noop = vi.fn();
		const markup = renderToStaticMarkup(
			<TaskGenerationTreeTable
				rows={rows}
				expanded={{
					goalIds: new Set([goal.id]),
					missionIds: new Set([mission.id]),
				}}
				selectedIds={[]}
				selectedCount={0}
				busy={false}
				busyAction={null}
				onAddGoal={noop}
				onCreateSelected={noop}
				onGenerateTaskCandidates={noop}
				onGenerateMissionCandidates={noop}
				onExpandAll={noop}
				onCollapseAll={noop}
				onToggleGoal={noop}
				onToggleMission={noop}
				onToggleSelected={noop}
				onOpenGoal={noop}
				onOpenMission={noop}
				onOpenCandidate={noop}
				onEditGoal={noop}
				onToggleGoalActive={noop}
				onDeleteGoal={noop}
				onDecomposeMission={noop}
				onDeleteMission={noop}
				onCreateCandidate={noop}
				onDismissCandidate={noop}
			/>,
		);

		expect(markup).toContain("品質を安定させる");
		expect(markup).toContain("品質ゲート整備");
		expect(markup).toContain("verify gate を接続");
		expect(markup).toContain("制約整備");
		expect(markup).toContain("Mission候補生成");
		expect(markup).not.toContain("生成候補を作成");
		expect(markup).not.toContain("ゴール / シグナル");
		expect(markup.match(/type="checkbox"/g)).toHaveLength(2);
		expect(markup).toContain('aria-label="タスク化"');
		expect(markup).toContain('aria-label="全部閉じる"');
		expect(markup).toContain('aria-label="全展開"');
		expect(markup).toContain(
			'aria-label="配下にタスク候補があるため削除できません"',
		);
		expect(markup).toContain('aria-label="候補を削除"');
		expect(markup).toContain("overflow-x-hidden");
		expect(markup).toContain("table-fixed");
		expect(markup).toContain("w-[116px]");
		expect(markup).toContain("shrink-0");
		expect(markup).not.toContain("min-w-[1160px]");
	});

	it("sorts feature entrypoint candidates before follow-up candidates within the same Goal", () => {
		const featureEntrypoint = {
			...candidate,
			id: "88888888-8888-4888-8888-888888888888",
			candidateKind: "feature_entrypoint" as const,
			title: "todolist 本体を実装する",
			createdAt: new Date("2026-07-04T00:01:00.000Z"),
		};
		const featureFollowup = {
			...candidate,
			id: "99999999-9999-4999-8999-999999999999",
			candidateKind: "feature_followup" as const,
			title: "Todo一覧のフィルタ UI を改善する",
			createdAt: new Date("2026-07-04T00:03:00.000Z"),
		};
		const unified = buildUnifiedTaskCandidates(
			[featureFollowup, featureEntrypoint],
			[],
		);
		const rows = buildTaskGenerationTreeRows({
			goals: [goal],
			missions: [],
			candidates: unified,
			expanded: { goalIds: new Set([goal.id]), missionIds: new Set() },
		});

		expect(
			rows
				.filter((row) => row.kind === "task_candidate")
				.map((row) => row.candidate.title),
		).toEqual(["todolist 本体を実装する", "Todo一覧のフィルタ UI を改善する"]);
	});
});

describe("QualityReportPanel", () => {
	const allRun = {
		id: "11111111-1111-4111-8111-111111111111",
		repositoryId: "22222222-2222-4222-8222-222222222222",
		runType: "all" as const,
		status: "completed" as const,
		command: "bun run test && bun run test:coverage && bun run test:e2e",
		exitCode: 0,
		startedAt: new Date("2026-07-04T00:00:00.000Z"),
		completedAt: new Date("2026-07-04T00:00:02.000Z"),
		outputArtifactId: null,
		latestOutput: "unit\ncoverage\ne2e",
		coverageSummary: {
			total: {
				statements: { pct: 88.2 },
				branches: { pct: 81.4 },
				functions: { pct: 90 },
				lines: { pct: 87.5 },
			},
			"src/checkout.ts": {
				statements: { pct: 75 },
				branches: {},
				functions: { pct: 80 },
				lines: { pct: 72 },
				uncoveredLines: [12, 18],
			},
		},
		coverageGate: {
			enabled: true,
			passed: true,
			targetPercent: 80,
			metrics: [
				{
					metric: "lines" as const,
					actualPercent: 87.5,
					targetPercent: 80,
					deltaPercent: 7.5,
					passed: true,
				},
			],
			failedMetrics: [],
			measuredAt: "2026-07-04T00:00:02.000Z",
		},
		e2eSummary: {
			status: "passed" as const,
			total: 1,
			passed: 1,
			failed: 0,
			skipped: 0,
			durationMs: 120,
			suites: [
				{
					title: "checkout.spec.ts",
					status: "passed" as const,
					tests: 1,
					durationMs: 120,
					lastFailure: null,
				},
			],
		},
		errorMessage: null,
		createdAt: new Date("2026-07-04T00:00:00.000Z"),
		updatedAt: new Date("2026-07-04T00:00:02.000Z"),
	};

	const runnableCapability = {
		runnable: true,
		missingCapabilities: [],
		command: "bun run test",
	};

	it("renders all-run coverage and E2E data through explicit overview fields", () => {
		const markup = renderToStaticMarkup(
			<QualityReportPanel
				quality={{
					capabilities: {
						projectType: "typescript",
						unit: runnableCapability,
						coverage: {
							...runnableCapability,
							command: "bun run test:coverage",
						},
						e2e: { ...runnableCapability, command: "bun run test:e2e" },
						all: {
							...runnableCapability,
							command:
								"bun run test && bun run test:coverage && bun run test:e2e",
						},
					},
					latestUnitRun: null,
					latestE2eRun: null,
					latestCoverageRun: allRun,
					latestE2eResultRun: allRun,
					latestAllRun: allRun,
					recentRuns: [allRun],
					runningRuns: [],
				}}
				coverageRows={coverageRowsFromSummary(allRun.coverageSummary)}
				e2eRows={[
					{
						suite: "checkout.spec.ts",
						status: "PASS",
						tests: "1",
						duration: "0s",
						lastFailure: "—",
					},
				]}
				busy={false}
				onRun={vi.fn()}
			/>,
		);

		expect(markup).toContain("src/checkout.ts");
		expect(markup).toContain("72.0");
		expect(markup).toContain("—");
		expect(markup).toContain("checkout.spec.ts");
		expect(markup).toContain("bun run test &amp;&amp; bun run test:coverage");
		expect(markup).toContain("Coverage Gate: PASS / target 80%");
		expect(markup).toContain("コマンド出力");
	});

	it("builds overview coverage gate axes from coverage summary when the gate is disabled", () => {
		const axes = coverageAxesFromQualityRun({
			...allRun,
			coverageGate: {
				enabled: false,
				passed: true,
				targetPercent: 80,
				metrics: [],
				failedMetrics: [],
				measuredAt: "2026-07-04T00:00:02.000Z",
				reason: "coverage_gate_disabled",
			},
		});

		expect(axes).toEqual([
			{ labelKey: "projectDetail.coverage.statements", value: 88.2 },
			{ labelKey: "projectDetail.coverage.branches", value: 81.4 },
			{ labelKey: "projectDetail.coverage.functions", value: 90 },
			{ labelKey: "projectDetail.coverage.lines", value: 87.5 },
		]);
	});

	it("shows capability and run errors instead of an unqualified empty table", () => {
		const failedRun = {
			...allRun,
			status: "failed" as const,
			exitCode: 1,
			errorMessage: "boom",
		};
		const markup = renderToStaticMarkup(
			<QualityReportPanel
				quality={{
					capabilities: {
						projectType: "typescript",
						unit: runnableCapability,
						coverage: { runnable: false, missingCapabilities: ["coverage"] },
						e2e: runnableCapability,
						all: { runnable: false, missingCapabilities: ["coverage"] },
					},
					latestUnitRun: null,
					latestE2eRun: null,
					latestCoverageRun: null,
					latestE2eResultRun: failedRun,
					latestAllRun: failedRun,
					recentRuns: [failedRun],
					runningRuns: [],
				}}
				coverageRows={[]}
				e2eRows={[]}
				busy={false}
				onRun={vi.fn()}
			/>,
		);

		expect(markup).toContain("不足している capability: coverage");
		expect(markup).toContain("boom");
		expect(markup).toContain("exit 1");
	});
});

describe("coverageRowsFromSummary", () => {
	it("keeps total and file rows while preserving unknown metric values", () => {
		const rows = coverageRowsFromSummary({
			total: {
				statements: { pct: 90 },
				branches: { pct: 80 },
				functions: { pct: 85 },
				lines: { pct: 88 },
			},
			"src/b.ts": {
				statements: { pct: 70 },
				branches: { pct: 60 },
				functions: { pct: 75 },
				lines: { pct: 72 },
			},
			"src/a.ts": {
				statements: { pct: 71 },
				branches: {},
				functions: { pct: 76 },
				lines: { pct: 73 },
				uncoveredLines: [4, "8", { invalid: true }],
			},
		});

		expect(rows.map((row) => row.file)).toEqual([
			"total",
			"src/a.ts",
			"src/b.ts",
		]);
		expect(rows[1].branches).toBeNull();
		expect(rows[1].uncovered).toBe("4, 8");
	});

	it("displays coverage files relative to the project root", () => {
		const rows = coverageRowsFromSummary(
			{
				total: {
					statements: { pct: 90 },
					branches: { pct: 80 },
					functions: { pct: 85 },
					lines: { pct: 88 },
				},
				"/Users/y.noguchi/Code/todolist/api/app/env.ts": {
					statements: { pct: 70 },
					branches: { pct: 60 },
					functions: { pct: 75 },
					lines: { pct: 72 },
				},
				"/tmp/outside.ts": {
					statements: { pct: 71 },
					branches: { pct: 61 },
					functions: { pct: 76 },
					lines: { pct: 73 },
				},
			},
			"/Users/y.noguchi/Code/todolist",
		);

		expect(rows.map((row) => row.file)).toEqual([
			"total",
			"/tmp/outside.ts",
			"api/app/env.ts",
		]);
	});
});

describe("GoalEditorDialog", () => {
	it("renders compact single-select goal templates in the add dialog", () => {
		const markup = renderToStaticMarkup(
			<GoalEditorDialog
				draft={{ title: "", goalText: "", active: true }}
				busy={false}
				stackProfile={fullTemplateStack}
				onChange={vi.fn()}
				onClose={vi.fn()}
				onSave={vi.fn()}
			/>,
		);

		for (const template of missionGoalTemplates) {
			expect(markup).toContain(template.title);
		}
		expect(markup.indexOf("テンプレート")).toBeLessThan(
			markup.indexOf("タイトル"),
		);
		expect(markup).not.toContain("API Compatibility");
		expect(markup).not.toContain("Migration Safety");
		expect(markup).not.toContain("criteria");
	});

	it("shows a check icon for the selected template item", () => {
		const template = missionGoalTemplates[0];
		const markup = renderToStaticMarkup(
			<GoalEditorDialog
				draft={{
					title: template.title,
					goalText: template.goalText,
					active: true,
				}}
				busy={false}
				stackProfile={fullTemplateStack}
				onChange={vi.fn()}
				onClose={vi.fn()}
				onSave={vi.fn()}
			/>,
		);

		expect(markup).toContain('aria-pressed="true"');
		expect(markup).toContain("lucide-check");
	});

	it("filters templates that do not apply to the detected stack", () => {
		const backendOnlyStack = stackProfile([
			{
				name: "Hono",
				category: "backend",
				packageName: "hono",
				version: "4.12.21",
				source: "package_json",
				confidence: "high",
			},
		]);
		const templates = getMissionGoalTemplatesForStack(backendOnlyStack);

		expect(templates.map((template) => template.id)).toEqual([
			"coverage-budget",
			"performance-budget",
		]);
		expect(
			templates.find((template) => template.id === "performance-budget")
				?.goalText,
		).not.toContain("Web画面");
	});

	it("inserts one selected template body into the draft", () => {
		const performanceTemplate = missionGoalTemplates.find(
			(template) => template.id === "performance-budget",
		);
		const i18nTemplate = missionGoalTemplates.find(
			(template) => template.id === "i18n-dictionary-parity",
		);
		expect(performanceTemplate).toBeTruthy();
		expect(i18nTemplate).toBeTruthy();
		if (!performanceTemplate || !i18nTemplate) {
			throw new Error("Expected mission goal templates to exist.");
		}

		const firstDraft = applyMissionGoalTemplate(
			{ title: "", goalText: "", active: true },
			performanceTemplate,
		);
		expect(firstDraft).toMatchObject({
			title: "パフォーマンス維持",
			goalText: performanceTemplate.goalText,
		});

		const nextDraft = applyMissionGoalTemplate(firstDraft, i18nTemplate);
		expect(nextDraft).toMatchObject({
			title: "i18n辞書同期",
			goalText: i18nTemplate.goalText,
		});
	});

	it("preserves a custom title when a template body is inserted", () => {
		const template = missionGoalTemplates[0];
		const draft = applyMissionGoalTemplate(
			{ title: "Checkout Quality", goalText: "", active: true },
			template,
		);

		expect(draft.title).toBe("Checkout Quality");
		expect(draft.goalText).toBe(template.goalText);
	});

	it("unselects the selected template and clears its inserted body", () => {
		const template = missionGoalTemplates[0];
		const selectedDraft = applyMissionGoalTemplate(
			{ title: "", goalText: "", active: true },
			template,
		);
		const clearedDraft = toggleMissionGoalTemplate(selectedDraft, template);

		expect(clearedDraft).toMatchObject({ title: "", goalText: "" });
	});

	it("keeps a custom title when unselecting an inserted template body", () => {
		const template = missionGoalTemplates[0];
		const clearedDraft = toggleMissionGoalTemplate(
			{ title: "Checkout Quality", goalText: template.goalText, active: true },
			template,
		);

		expect(clearedDraft).toMatchObject({
			title: "Checkout Quality",
			goalText: "",
		});
	});
});
