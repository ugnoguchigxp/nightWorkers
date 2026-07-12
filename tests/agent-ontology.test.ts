import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type CoreModule = {
	validateAllManifests: (repoRoot: string) => {
		ok: boolean;
		modules: Array<{ id: string }>;
		errors: string[];
	};
	listModules: (repoRoot: string) => {
		modules: Array<{ id: string; label: string; manifestDigest: string }>;
		indexMissing?: boolean;
	};
	classifyGoal: (input: { repoRoot: string; goal: string }) => {
		primaryModule: string;
		secondaryModules: string[];
	};
	compileModuleContext: (input: {
		repoRoot: string;
		goal: string;
		primaryModule?: string;
		secondaryModules?: string[];
		taskGenerationEvidence?: unknown;
	}) => {
		module: string;
		summaryType: string;
		evidenceSources: {
			manifestDigest: string;
			taskGenerationEvidence: boolean;
		};
		moduleManifest: {
			available: boolean;
			module: string | null;
			digest: string | null;
		};
		codeEvidence: { source: string; likelyFiles: string[] };
		taskGenerationEvidence: {
			available: boolean;
			taskCandidate?: { primaryModule: string | null; kind: string } | null;
			projectWideConstraints?: Array<{ goalId: string; title: string }>;
		};
		summary: {
			canonicalDomainSummary: string | null;
			taskScopedSummary: string | null;
		};
		relevantInvariants: string[];
		warnings: string[];
	};
	checkBoundary: (input: {
		repoRoot: string;
		primaryModule: string;
		secondaryModules?: string[];
		plannedFiles: string[];
	}) => {
		decision: string;
		crossings: Array<{ module: string; declaredSecondary: boolean }>;
		needsConfirmation?: Array<{ path: string; reason: string }>;
	};
	getVerificationPlan: (input: { repoRoot: string; primaryModule: string }) => {
		focused: Array<{ command: string }>;
	};
};

let tempDir = "";

afterEach(() => {
	if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
	tempDir = "";
});

async function loadCore(): Promise<CoreModule> {
	return (await import("../scripts/agent-ontology/core.mjs")) as CoreModule;
}

describe("agent ontology helpers", () => {
	it("validates bundled manifests and lists pilot modules", async () => {
		const core = await loadCore();

		const validation = core.validateAllManifests(process.cwd());
		expect(validation.ok).toBe(true);
		expect(validation.modules.map((module) => module.id).sort()).toEqual([
			"artifact",
			"blueprint",
			"gitworktree",
			"implementation-queue",
			"llm-gateway",
			"mission-pilot",
			"mission-planner",
			"overview",
			"plan-mode",
			"project-detail",
			"project-registry",
			"quality",
			"review",
			"settings",
			"task-execution",
			"task-generation",
			"workbench",
		]);

		const modules = core.listModules(process.cwd());
		expect(
			modules.modules.find((module) => module.id === "project-detail"),
		).toMatchObject({
			label: "Project Detail",
			manifestDigest: expect.stringMatching(/^sha256:/),
		});
		expect(
			modules.modules.find((module) => module.id === "task-generation"),
		).toMatchObject({
			label: "Task Generation",
			manifestDigest: expect.stringMatching(/^sha256:/),
		});
	});

	it("classifies goals, compiles context, checks boundaries, and returns verification", async () => {
		const core = await loadCore();

		const classification = core.classifyGoal({
			repoRoot: process.cwd(),
			goal: "Project Detail Mission task candidate UI",
		});
		expect(classification).toMatchObject({
			primaryModule: "project-detail",
			secondaryModules: expect.arrayContaining(["mission-planner"]),
		});

		const context = core.compileModuleContext({
			repoRoot: process.cwd(),
			goal: "Project Detail Mission task candidate UI",
			primaryModule: "project-detail",
			secondaryModules: ["mission-planner"],
			taskGenerationEvidence: {
				taskCandidate: { kind: "feature_entrypoint" },
				acceptanceCriteria: ["TaskCandidate evidence is preserved."],
				verificationHints: ["Run focused ontology tests."],
			},
		});
		const taskScopedSummary = context.summary.taskScopedSummary;
		expect(context).toMatchObject({
			module: "project-detail",
			summaryType: "task_scoped",
			evidenceSources: {
				manifestDigest: expect.stringMatching(/^sha256:/),
				taskGenerationEvidence: true,
			},
			moduleManifest: {
				available: true,
				module: "project-detail",
				digest: expect.stringMatching(/^sha256:/),
			},
			codeEvidence: {
				source: "repository",
				likelyFiles: expect.arrayContaining([
					"api/modules/project-detail/project-detail.service.ts",
				]),
			},
			taskGenerationEvidence: {
				available: true,
				taskCandidate: expect.objectContaining({
					kind: "feature_entrypoint",
				}),
			},
			summary: {
				canonicalDomainSummary: expect.stringContaining("Project Detail"),
				taskScopedSummary: expect.stringContaining(
					"Candidate kind: feature_entrypoint",
				),
			},
			relevantInvariants: expect.arrayContaining([
				"goal-mission-taskcandidate-tree",
			]),
		});
		expect(taskScopedSummary).toContain(
			"Acceptance criteria: TaskCandidate evidence is preserved.",
		);
		expect(taskScopedSummary).toContain(
			"Task verification hints: Run focused ontology tests.",
		);

		const boundary = core.checkBoundary({
			repoRoot: process.cwd(),
			primaryModule: "project-detail",
			secondaryModules: ["mission-planner"],
			plannedFiles: [
				"api/modules/project-detail/project-detail.service.ts",
				"api/modules/mission-planner/mission-planner.service.ts",
				"src/modules/settings/SettingsGeneralPanel.tsx",
			],
		});
		expect(boundary.decision).toBe("allow_with_crossing");
		expect(boundary.crossings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					module: "mission-planner",
					declaredSecondary: true,
				}),
				expect.objectContaining({
					module: "settings",
					declaredSecondary: false,
				}),
			]),
		);

		const verification = core.getVerificationPlan({
			repoRoot: process.cwd(),
			primaryModule: "project-detail",
		});
		expect(verification.focused[0]?.command).toContain(
			"tests/project-detail-backend.test.ts",
		);
	});

	it("does not allow unrelated test files as implicit verification paths", async () => {
		const core = await loadCore();

		const boundary = core.checkBoundary({
			repoRoot: process.cwd(),
			primaryModule: "project-detail",
			plannedFiles: ["tests/routes.settings-general.test.ts"],
		});

		expect(boundary.decision).toBe("needs_user_confirmation");
		expect(boundary.crossings).toEqual([]);
	});

	it("keeps manifest ownership when task generation routing conflicts", async () => {
		const core = await loadCore();

		const context = core.compileModuleContext({
			repoRoot: process.cwd(),
			goal: "Project Detail Mission task candidate UI",
			primaryModule: "project-detail",
			taskGenerationEvidence: {
				source: "nightworkers_project_detail",
				taskCandidate: {
					id: crypto.randomUUID(),
					title: "Settings の候補",
					kind: "feature_entrypoint",
					primaryModule: "settings",
					secondaryModules: ["missing-module"],
					routingConfidencePercent: 80,
					routingReason: "fixture conflict",
					planModeOpenQuestions: ["境界を確認する。"],
				},
				projectWideConstraints: [
					{
						goalId: crypto.randomUUID(),
						title: "Coverage",
						intent: "maintain_threshold",
					},
				],
			},
		});

		expect(context.module).toBe("project-detail");
		expect(context.taskGenerationEvidence.taskCandidate).toMatchObject({
			primaryModule: "settings",
			kind: "feature_entrypoint",
		});
		expect(context.summary.taskScopedSummary).toContain(
			"Project-wide constraints: Coverage",
		);
		expect(context.summary.taskScopedSummary).toContain(
			"Plan mode open questions",
		);
		expect(context.warnings).toEqual(
			expect.arrayContaining([
				expect.stringContaining(
					"differs from manifest-selected module project-detail",
				),
				expect.stringContaining("unknown module missing-module"),
			]),
		);
	});

	it("fails validation deterministically for missing manifest paths", async () => {
		const core = await loadCore();
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-ontology-invalid-"));
		fs.mkdirSync(path.join(tempDir, ".agent-ontology"), { recursive: true });
		fs.writeFileSync(
			path.join(tempDir, ".agent-ontology/modules.yaml"),
			JSON.stringify({
				version: 1,
				modules: [
					{ id: "missing", label: "Missing", manifest: "modules/missing.yaml" },
				],
			}),
		);

		const validation = core.validateAllManifests(tempDir);
		expect(validation.ok).toBe(false);
		expect(validation.errors).toEqual(
			expect.arrayContaining([
				"module missing manifest missing: modules/missing.yaml",
			]),
		);
	});

	it("falls back safely when a repository has no ontology index", async () => {
		const core = await loadCore();
		tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "agent-ontology-missing-index-"),
		);

		const modules = core.listModules(tempDir);
		expect(modules).toMatchObject({
			indexMissing: true,
			modules: [],
		});

		const classification = core.classifyGoal({
			repoRoot: tempDir,
			goal: "todolist を作る",
		});
		expect(classification).toMatchObject({
			primaryModule: "emerging",
			confidence: 0.2,
		});

		const context = core.compileModuleContext({
			repoRoot: tempDir,
			goal: "todolist を作る",
			primaryModule: "todolist",
		});
		expect(context).toMatchObject({
			module: "emerging",
			evidenceSources: { manifestDigest: null },
			moduleManifest: { available: false },
		});

		const boundary = core.checkBoundary({
			repoRoot: tempDir,
			primaryModule: "todolist",
			plannedFiles: ["src/todos.ts"],
		});
		expect(boundary).toMatchObject({
			decision: "needs_user_confirmation",
			needsConfirmation: [
				{ path: "src/todos.ts", reason: "module ontology index not found" },
			],
		});
	});
});
