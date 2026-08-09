import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import {
	buildMissionTaskCandidatesResponseJsonSchema,
	selectMissionGoalsForGeneration,
} from "../api/modules/taskGeneration/task-generation.service";
import {
	buildTaskGenerationPromptSignal,
	buildTaskGenerationSystemContext,
} from "../api/modules/taskGeneration/task-generation-prompt-context";
import {
	buildProjectSignalSnapshot,
	resolveTaskGenerationImplementationContext,
} from "../api/modules/taskGeneration/task-generation-signal.service";
import {
	type MissionGoal,
	type MissionGoalInterpretation,
	missionTaskCandidatesResultSchema,
} from "../shared/schemas/task-generation.schema";
import { requireVitestWorkspaceRoot } from "./vitest-db-env";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("Mission task candidate generation helpers", () => {
	it("rejects unknown requested Goal ids instead of silently using a partial selection", () => {
		const knownGoal = missionGoalFixture({
			id: crypto.randomUUID(),
			title: "Known Goal",
			scope: "unknown",
			source: "unknown",
		});
		const unknownGoalId = crypto.randomUUID();

		expect(() =>
			selectMissionGoalsForGeneration([knownGoal], {
				goalIds: [knownGoal.id, unknownGoalId],
			}),
		).toThrow("Mission goal not found");
	});

	it("builds a structured-output compatible mission task candidate response schema", () => {
		const schema = buildMissionTaskCandidatesResponseJsonSchema();
		expect(JSON.stringify(schema)).not.toContain('"$schema"');
		expect(JSON.stringify(schema)).not.toContain('"default"');
		expectAllObjectPropertiesRequired(schema);

		const root = asRecord(schema);
		const candidates = asRecord(asRecord(root.properties).candidates);
		const candidate = asRecord(candidates.items);
		expect(candidate.required).toEqual([
			"title",
			"summary",
			"rationale",
			"goalId",
			"candidateKind",
			"moduleRouting",
			"constraintGoalIds",
			"planModeOpenQuestions",
			"evidence",
			"evaluationContribution",
			"importancePercent",
			"confidencePercent",
			"tokenSize",
			"complexity",
			"taskPrompt",
			"acceptanceCriteria",
			"verificationPlan",
		]);
		expect(JSON.stringify(asRecord(candidate.properties).goalId)).toContain(
			'"null"',
		);
		expect(
			JSON.stringify(asRecord(candidate.properties).evaluationContribution),
		).toContain('"null"');
		expect(candidates.maxItems).toBe(5);
	});

	it("accepts null evaluationContribution when project evaluation is absent", () => {
		const parsed = missionTaskCandidatesResultSchema.parse({
			schemaVersion: "nightworkers.mission-task-candidates/v1",
			candidates: [
				{
					title: "候補",
					summary: "要約",
					rationale: "理由",
					goalId: null,
					candidateKind: "feature_followup",
					moduleRouting: {
						primaryModule: null,
						secondaryModules: [],
						confidencePercent: 0,
						reason: null,
					},
					constraintGoalIds: [],
					planModeOpenQuestions: [],
					evidence: [],
					evaluationContribution: null,
					importancePercent: 50,
					confidencePercent: 80,
					tokenSize: "small",
					complexity: "simple",
					taskPrompt: "実装してください。",
					acceptanceCriteria: "完了していること。",
					verificationPlan: "テストする。",
				},
			],
		});

		expect(parsed.candidates[0]?.goalId).toBeNull();
		expect(parsed.candidates[0]?.evaluationContribution).toBeNull();
	});

	it("uses LLM_CONTEXT without invoking stack detection", () => {
		const detectStack = vi.fn();
		const context = resolveTaskGenerationImplementationContext(
			{
				repoRoot: "/repo",
				llmContextFiles: [
					{ path: "LLM_CONTEXT.md", excerpt: "既存実装の正本" },
				],
			},
			detectStack as never,
		);

		expect(context).toEqual({
			source: "llm_context",
			files: [{ path: "LLM_CONTEXT.md", excerpt: "既存実装の正本" }],
		});
		expect(detectStack).not.toHaveBeenCalled();
	});

	it("detects the existing stack only when LLM_CONTEXT is absent", () => {
		const stackProfile = {
			summary: "TypeScript + Hono",
			manifestStatus: "found" as const,
			manifestPath: "/repo/package.json",
			packageManager: "bun",
			technologies: [],
		};
		const detectStack = vi.fn(() => stackProfile);
		const context = resolveTaskGenerationImplementationContext(
			{ repoRoot: "/repo", llmContextFiles: [] },
			detectStack,
		);

		expect(context).toEqual({ source: "detected_stack", stackProfile });
		expect(detectStack).toHaveBeenCalledWith("/repo");
	});

	it("does not reorder or fold LLM-selected candidates", () => {
		const featureGoalId = crypto.randomUUID();
		const projectWideGoalId = crypto.randomUUID();
		const candidates = missionTaskCandidatesResultSchema.parse({
			schemaVersion: "nightworkers.mission-task-candidates/v1",
			candidates: [
				{
					title: "Todo一覧のフィルタ UI を改善する",
					summary: "UI 詳細。",
					rationale: "後続で検討する。",
					goalId: null,
					candidateKind: "feature_followup",
					moduleRouting: {
						primaryModule: null,
						secondaryModules: [],
						confidencePercent: 20,
						reason: "本体未実装のため詳細は未確定。",
					},
					constraintGoalIds: [],
					planModeOpenQuestions: [],
					evidence: [],
					evaluationContribution: 20,
					importancePercent: 70,
					confidencePercent: 70,
					tokenSize: "small",
					complexity: "simple",
					taskPrompt: "Todo一覧のフィルタ UI を改善してください。",
					acceptanceCriteria: "フィルタ UI がある。",
					verificationPlan: "UI テストを行う。",
				},
				{
					title: "todolist 本体を実装する",
					summary: "todolist 機能を Plan Mode で定義する。",
					rationale: "本体機能が未実装。",
					goalId: featureGoalId,
					candidateKind: "feature_entrypoint",
					moduleRouting: {
						primaryModule: null,
						secondaryModules: [],
						confidencePercent: 30,
						reason: "ontology 未判定。",
					},
					constraintGoalIds: [],
					planModeOpenQuestions: ["保存方式を決める。"],
					evidence: [],
					evaluationContribution: 60,
					importancePercent: 95,
					confidencePercent: 85,
					tokenSize: "medium",
					complexity: "moderate",
					taskPrompt: "Plan Mode で todolist 本体の実装方針を決めてください。",
					acceptanceCriteria: "本体実装方針が決まる。",
					verificationPlan: "計画をレビューする。",
				},
				{
					title: "todolist の coverage gate を確認する",
					summary: "project-wide constraint の検証詳細。",
					rationale: "本体計画内で扱う。",
					goalId: projectWideGoalId,
					candidateKind: "constraint_verification",
					moduleRouting: {
						primaryModule: null,
						secondaryModules: [],
						confidencePercent: 20,
						reason: "project-wide Goal は本流候補の制約として扱う。",
					},
					constraintGoalIds: [],
					planModeOpenQuestions: [],
					evidence: [],
					evaluationContribution: 15,
					importancePercent: 80,
					confidencePercent: 70,
					tokenSize: "small",
					complexity: "simple",
					taskPrompt: "coverage gate を確認してください。",
					acceptanceCriteria: "coverage gate が確認される。",
					verificationPlan: "coverage を確認する。",
				},
			],
		}).candidates;

		expect(candidates).toHaveLength(3);
		expect(candidates[0]).toMatchObject({
			candidateKind: "feature_followup",
			title: "Todo一覧のフィルタ UI を改善する",
		});
		expect(candidates[1]).toMatchObject({
			candidateKind: "feature_entrypoint",
			title: "todolist 本体を実装する",
			constraintGoalIds: [],
			planModeOpenQuestions: ["保存方式を決める。"],
		});
	});

	it("adds compact repository implementation context to mission signals", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(requireVitestWorkspaceRoot(), "nightworkers-mission-signal-"),
		);
		try {
			fs.mkdirSync(path.join(repoRoot, "web/src/routes"), { recursive: true });
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					name: "hono-standard",
					description: "Template app",
					scripts: { test: "vitest run", verify: "bun run test" },
				}),
				"utf8",
			);
			fs.writeFileSync(
				path.join(repoRoot, "README.md"),
				"# Hono Standard\nTemplate app",
				"utf8",
			);
			fs.writeFileSync(
				path.join(repoRoot, "LLM_CONTEXT.md"),
				"LLM CONTEXT: todo workflow is already implemented in routes.",
				"utf8",
			);
			fs.writeFileSync(
				path.join(repoRoot, "web/src/routes/home-route.tsx"),
				"export {}",
				"utf8",
			);
			execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
			execFileSync("git", ["config", "user.email", "test@example.com"], {
				cwd: repoRoot,
			});
			execFileSync("git", ["config", "user.name", "NightWorkers Test"], {
				cwd: repoRoot,
			});
			execFileSync("git", ["add", "package.json"], { cwd: repoRoot });
			execFileSync("git", ["commit", "-m", "initial template"], {
				cwd: repoRoot,
				stdio: "ignore",
			});
			fs.writeFileSync(
				path.join(repoRoot, "web/src/routes/home-route.tsx"),
				'export const route = "todo";',
				"utf8",
			);
			execFileSync("git", ["add", "web/src/routes/home-route.tsx"], {
				cwd: repoRoot,
			});
			execFileSync("git", ["commit", "-m", "add todo route"], {
				cwd: repoRoot,
				stdio: "ignore",
			});
			fs.writeFileSync(
				path.join(repoRoot, "web/src/routes/home-route.tsx"),
				'export const route = "todo-list";',
				"utf8",
			);
			execFileSync("git", ["add", "web/src/routes/home-route.tsx"], {
				cwd: repoRoot,
			});
			execFileSync("git", ["commit", "-m", "refine todo route"], {
				cwd: repoRoot,
				stdio: "ignore",
			});

			const snapshot = await buildProjectSignalSnapshot({
				repository: {
					id: crypto.randomUUID(),
					name: "todo",
					localPath: repoRoot,
					branch: "main",
				},
				goals: [
					{
						id: crypto.randomUUID(),
						repositoryId: crypto.randomUUID(),
						title: "todo listを作る",
						goalText: "使いやすい todo list を作る",
						active: true,
						source: "user",
						sortOrder: 0,
						interpretation: {
							scope: "unknown",
							intent: "unknown",
							source: "unknown",
							confidencePercent: 0,
							reason: null,
						},
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				],
			});

			expect(snapshot.repositorySnapshot).toMatchObject({
				packageName: "hono-standard",
				description: "Template app",
			});
			expect(snapshot.repositorySnapshot?.readmeExcerpt).toContain(
				"Hono Standard",
			);
			expect(snapshot.repositorySnapshot?.sourceFiles).toContain(
				"web/src/routes/home-route.tsx",
			);
			expect(snapshot.repositorySnapshot?.sourceExcerpts).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						path: "README.md",
						excerpt: expect.stringContaining("Hono Standard"),
					}),
					expect.objectContaining({ path: "web/src/routes/home-route.tsx" }),
				]),
			);
			expect(snapshot.repositorySnapshot?.llmContextFiles).toEqual([
				expect.objectContaining({
					path: "LLM_CONTEXT.md",
					excerpt: expect.stringContaining(
						"todo workflow is already implemented",
					),
				}),
			]);
			expect(snapshot.repositorySnapshot?.recentCommitDiffs).toHaveLength(0);
			expect(snapshot.repositorySnapshot?.packageScripts).toEqual(
				expect.arrayContaining([expect.objectContaining({ name: "verify" })]),
			);
			expect(snapshot.implementationContext).toMatchObject({
				source: "llm_context",
			});
			expect(
				JSON.stringify(buildTaskGenerationSystemContext(snapshot)),
			).toContain("todo workflow is already implemented");
			expect(
				JSON.stringify(
					buildTaskGenerationPromptSignal(snapshot, "task_candidates"),
				),
			).not.toContain("todo workflow is already implemented");
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("adds recent non-initial commit diffs only when LLM context is absent", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(requireVitestWorkspaceRoot(), "nightworkers-mission-diff-"),
		);
		try {
			fs.mkdirSync(path.join(repoRoot, "web/src/routes"), { recursive: true });
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					name: "hono-standard",
					scripts: { test: "vitest run" },
				}),
				"utf8",
			);
			fs.writeFileSync(
				path.join(repoRoot, "web/src/routes/home-route.tsx"),
				"export {}",
				"utf8",
			);
			execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
			execFileSync("git", ["config", "user.email", "test@example.com"], {
				cwd: repoRoot,
			});
			execFileSync("git", ["config", "user.name", "NightWorkers Test"], {
				cwd: repoRoot,
			});
			execFileSync("git", ["add", "."], { cwd: repoRoot });
			execFileSync("git", ["commit", "-m", "initial template"], {
				cwd: repoRoot,
				stdio: "ignore",
			});
			fs.writeFileSync(
				path.join(repoRoot, "web/src/routes/home-route.tsx"),
				'export const route = "todo";',
				"utf8",
			);
			execFileSync("git", ["add", "web/src/routes/home-route.tsx"], {
				cwd: repoRoot,
			});
			execFileSync("git", ["commit", "-m", "add todo route"], {
				cwd: repoRoot,
				stdio: "ignore",
			});
			fs.writeFileSync(
				path.join(repoRoot, "web/src/routes/home-route.tsx"),
				'export const route = "todo-list";',
				"utf8",
			);
			execFileSync("git", ["add", "web/src/routes/home-route.tsx"], {
				cwd: repoRoot,
			});
			execFileSync("git", ["commit", "-m", "refine todo route"], {
				cwd: repoRoot,
				stdio: "ignore",
			});

			const snapshot = await buildProjectSignalSnapshot({
				repository: {
					id: crypto.randomUUID(),
					name: "todo",
					localPath: repoRoot,
					branch: "main",
				},
				goals: [
					{
						id: crypto.randomUUID(),
						repositoryId: crypto.randomUUID(),
						title: "todo listを作る",
						goalText: "使いやすい todo list を作る",
						active: true,
						source: "user",
						sortOrder: 0,
						interpretation: {
							scope: "unknown",
							intent: "unknown",
							source: "unknown",
							confidencePercent: 0,
							reason: null,
						},
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				],
			});

			expect(snapshot.repositorySnapshot?.llmContextFiles).toHaveLength(0);
			expect(snapshot.repositorySnapshot?.recentCommitDiffs).toHaveLength(2);
			expect(
				snapshot.repositorySnapshot?.recentCommitDiffs.map(
					(item) => item.subject,
				),
			).toEqual(["refine todo route", "add todo route"]);
			expect(
				JSON.stringify(snapshot.repositorySnapshot?.recentCommitDiffs),
			).not.toContain("initial template");
			expect(snapshot.implementationContext).toMatchObject({
				source: "detected_stack",
				stackProfile: { manifestStatus: "found" },
			});
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});
});

function expectAllObjectPropertiesRequired(schema: unknown) {
	if (!schema || typeof schema !== "object") return;
	const record = schema as Record<string, unknown>;
	if (
		record.type === "object" &&
		record.properties &&
		typeof record.properties === "object"
	) {
		expect(record.required).toEqual(
			Object.keys(record.properties as Record<string, unknown>),
		);
		expect(record.additionalProperties).toBe(false);
	}
	for (const value of Object.values(record)) {
		if (Array.isArray(value)) {
			for (const item of value) expectAllObjectPropertiesRequired(item);
		} else {
			expectAllObjectPropertiesRequired(value);
		}
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	expect(value).toBeTruthy();
	expect(typeof value).toBe("object");
	expect(Array.isArray(value)).toBe(false);
	return value as Record<string, unknown>;
}

function missionGoalFixture(input: {
	id: string;
	title: string;
	scope: MissionGoalInterpretation["scope"];
	source: MissionGoalInterpretation["source"];
}): MissionGoal {
	return {
		id: input.id,
		repositoryId: crypto.randomUUID(),
		title: input.title,
		goalText: input.title,
		active: true,
		source: input.source === "preset" ? "preset" : "user",
		sortOrder: 0,
		interpretation: {
			scope: input.scope,
			intent: input.scope === "project_wide" ? "maintain_threshold" : "unknown",
			source: input.source,
			confidencePercent: input.source === "preset" ? 100 : 0,
			reason:
				input.source === "preset"
					? "Preset Goal はプロジェクト横断制約として扱う"
					: null,
		},
		createdAt: new Date("2026-07-04T00:00:00.000Z"),
		updatedAt: new Date("2026-07-04T00:00:00.000Z"),
	};
}
