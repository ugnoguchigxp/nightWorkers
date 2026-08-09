import { beforeEach, describe, expect, it, vi } from "vitest";

const ontologyService = vi.hoisted(() => ({
	compileOntologyModuleContext: vi.fn(),
	checkOntologyBoundary: vi.fn(),
}));

vi.mock("../api/modules/ontology/core/ontology.service", () => ontologyService);

import {
	boundaryAuditEventSeverity,
	buildOntologyBoundaryAuditSnapshot,
	buildOntologyRuntimeContextDisabledSnapshot,
	buildOntologyRuntimeContextSnapshot,
	formatOntologyCloseoutRequirementsForPrompt,
	formatOntologyRuntimeContextForPrompt,
	ontologySnapshotEventSeverity,
} from "../api/modules/ontology/runtime/ontology-runtime-context";

const runtimeInput = {
	repoRoot: "/repo",
	goal: "Implement ontology support",
	taskId: "task-1",
	runId: "run-1",
	runtimeLane: "coding_agent",
};

function storedOntology(overrides: Record<string, unknown> = {}) {
	return {
		version: 1,
		available: true,
		source: "compile_module_context",
		runId: "run-1",
		taskId: "task-1",
		runtimeLane: "coding_agent",
		summaryType: "task_scoped",
		primaryModule: "ontology",
		secondaryModules: ["coding-agent"],
		taskCandidateId: "candidate-1",
		taskGenerationEvidence: true,
		memoryEvidence: true,
		ownedPaths: ["api/modules/ontology/**"],
		likelyFiles: ["api/modules/ontology/runtime.ts"],
		boundaryWarnings: ["crossing warning"],
		invariants: ["Keep module boundary"],
		focusedVerification: ["bun test ontology"],
		warnings: ["context warning"],
		...overrides,
	};
}

beforeEach(() => {
	ontologyService.compileOntologyModuleContext.mockReset();
	ontologyService.checkOntologyBoundary.mockReset();
});

describe("ontology runtime context coverage", () => {
	it("normalizes a complete compiled runtime context and preserves run metadata", async () => {
		ontologyService.compileOntologyModuleContext.mockResolvedValue({
			summaryType: " task_scoped ",
			module: " ",
			moduleManifest: {
				ownedPaths: [" api/modules/ontology/** ", 42, ""],
			},
			routing: {
				secondaryModules: [" coding-agent ", "shared", "shared", null],
			},
			taskGenerationEvidence: { taskCandidateId: "" },
			evidenceSources: {
				taskGenerationEvidence: { id: "evidence" },
				memoryEvidence: 1,
			},
			telemetry: {
				primaryModule: " ontology ",
				secondaryModules: ["shared", "mission-pilot"],
				taskCandidateId: " candidate-telemetry ",
				focusedVerificationCommands: ["bun test ontology", " bun lint "],
			},
			likelyFiles: [" api/modules/ontology/runtime.ts ", false],
			boundaryWarnings: [" warning one "],
			relevantInvariants: [" keep boundary "],
			verificationPlan: [" bun test ontology ", "bun test ontology"],
			warnings: [" context warning ", {}],
		});

		const result = await buildOntologyRuntimeContextSnapshot(runtimeInput);

		expect(ontologyService.compileOntologyModuleContext).toHaveBeenCalledWith({
			repoPath: "/repo",
			goal: "Implement ontology support",
			taskId: "task-1",
			summaryType: "task_scoped",
		});
		expect(result).toMatchObject({
			version: 1,
			available: true,
			source: "compile_module_context",
			runId: "run-1",
			taskId: "task-1",
			runtimeLane: "coding_agent",
			summaryType: "task_scoped",
			primaryModule: "ontology",
			secondaryModules: ["coding-agent", "shared", "mission-pilot"],
			taskCandidateId: "candidate-telemetry",
			taskGenerationEvidence: true,
			memoryEvidence: true,
			ownedPaths: ["api/modules/ontology/**"],
			likelyFiles: ["api/modules/ontology/runtime.ts"],
			boundaryWarnings: ["warning one"],
			invariants: ["keep boundary"],
			focusedVerification: ["bun test ontology", "bun lint"],
			warnings: ["context warning"],
		});
		expect(result.llmSummaryPreparation).toMatchObject({
			status: "deterministic_fallback",
			unsupportedClaimsPolicy: "warn_or_downgrade",
		});
	});

	it("prefers direct module and task evidence identifiers", async () => {
		ontologyService.compileOntologyModuleContext.mockResolvedValue({
			module: "direct-module",
			taskGenerationEvidence: { taskCandidateId: "direct-candidate" },
			telemetry: {
				primaryModule: "telemetry-module",
				taskCandidateId: "telemetry-candidate",
			},
		});

		await expect(
			buildOntologyRuntimeContextSnapshot(runtimeInput),
		).resolves.toMatchObject({
			primaryModule: "direct-module",
			taskCandidateId: "direct-candidate",
			secondaryModules: [],
			focusedVerification: [],
		});
	});

	it("returns unavailable snapshots for Error and non-Error compile failures", async () => {
		ontologyService.compileOntologyModuleContext.mockRejectedValueOnce(
			new Error("compile exploded"),
		);
		await expect(
			buildOntologyRuntimeContextSnapshot(runtimeInput),
		).resolves.toMatchObject({
			available: false,
			runId: "run-1",
			taskId: "task-1",
			runtimeLane: "coding_agent",
			warnings: ["compile exploded"],
		});

		ontologyService.compileOntologyModuleContext.mockRejectedValueOnce(
			"offline",
		);
		await expect(
			buildOntologyRuntimeContextSnapshot(runtimeInput),
		).resolves.toMatchObject({
			available: false,
			warnings: ["offline"],
		});
	});

	it("builds disabled snapshots for unavailable and measured source sizes", () => {
		const standard = buildOntologyRuntimeContextDisabledSnapshot({
			taskId: "task-1",
			runId: "run-1",
			runtimeLane: "coding_agent",
			toolProfile: "standard",
			reason: "repository is small",
			measuredSourceLoc: null,
			thresholdSourceLoc: 10_000,
		});
		expect(standard.warnings[0]).toContain("source LOC unavailable");
		expect(ontologySnapshotEventSeverity(standard)).toBe("info");

		const extended = buildOntologyRuntimeContextDisabledSnapshot({
			taskId: "task-2",
			runId: "run-2",
			runtimeLane: "mission_pilot",
			toolProfile: "ontology_extended",
			reason: "manual disable",
			measuredSourceLoc: 12_345,
			thresholdSourceLoc: 20_000,
		});
		expect(extended.warnings[0]).toContain("source LOC 12345");
		expect(ontologySnapshotEventSeverity(extended)).toBe("warning");
		expect(ontologySnapshotEventSeverity(storedOntology() as never)).toBe(
			"info",
		);
	});

	it("short-circuits boundary audits without files or a usable primary module", async () => {
		const noFiles = await buildOntologyBoundaryAuditSnapshot({
			repoRoot: "/repo",
			ontologyContext: storedOntology(),
			touchedFiles: ["", "  "],
		});
		expect(noFiles).toMatchObject({
			available: false,
			primaryModule: "ontology",
			touchedFiles: [],
			warnings: [
				"No touched files were available for ontology boundary audit.",
			],
		});

		for (const ontologyContext of [
			undefined,
			null,
			[],
			storedOntology({ available: false }),
			storedOntology({ primaryModule: " " }),
		]) {
			const noModule = await buildOntologyBoundaryAuditSnapshot({
				repoRoot: "/repo",
				ontologyContext,
				touchedFiles: [" src/a.ts ", "src/a.ts"],
			});
			expect(noModule.available).toBe(false);
			expect(noModule.touchedFiles).toEqual(["src/a.ts"]);
			expect(noModule.warnings).toEqual([
				"No primary module was available for ontology boundary audit.",
			]);
		}
		expect(ontologyService.checkOntologyBoundary).not.toHaveBeenCalled();
	});

	it("normalizes allowed paths, crossings, confirmations, and forbidden audit results", async () => {
		ontologyService.checkOntologyBoundary.mockResolvedValue({
			decision: " reject ",
			allowed: [
				{ path: "api/modules/ontology/a.ts", reason: "owned path" },
				{ path: "api/shared.ts", reason: "secondary module" },
				null,
			],
			needsConfirmation: [
				{ path: " src/unknown.ts ", reason: " read mostly " },
				{ path: "", reason: "ignored" },
			],
			forbiddenTouched: [
				{ path: " secrets.env ", reason: " forbidden " },
				{ reason: "missing path" },
			],
			crossings: [
				{
					module: " shared ",
					paths: [" shared/a.ts ", "", 4],
					declaredSecondary: 1,
					reason: " declared ",
				},
				{ module: "empty", paths: [] },
				"invalid",
			],
			warnings: [" audit warning ", false],
		});

		const result = await buildOntologyBoundaryAuditSnapshot({
			repoRoot: "/repo",
			ontologyContext: storedOntology(),
			touchedFiles: [
				" api/modules/ontology/a.ts ",
				"src/unknown.ts",
				"src/unknown.ts",
			],
		});

		expect(ontologyService.checkOntologyBoundary).toHaveBeenCalledWith({
			repoPath: "/repo",
			primaryModule: "ontology",
			secondaryModules: ["coding-agent"],
			plannedFiles: ["api/modules/ontology/a.ts", "src/unknown.ts"],
		});
		expect(result).toMatchObject({
			available: true,
			source: "check_boundary",
			decision: "reject",
			ownedPathsTouched: ["api/modules/ontology/a.ts"],
			boundaryCrossings: [
				{
					module: "shared",
					paths: ["shared/a.ts"],
					declaredSecondary: true,
					reason: "declared",
				},
			],
			forbiddenTouched: [{ path: "secrets.env", reason: "forbidden" }],
			needsConfirmation: [{ path: "src/unknown.ts", reason: "read mostly" }],
			verificationSelection: {
				focused: ["bun test ontology"],
				warnings: [
					"Unknown crossing requires explicit skipped reason or broader verification.",
				],
			},
		});
		expect(result.warnings).toEqual([
			"context warning",
			"audit warning",
			"Unknown or read-mostly paths require crossing reason or confirmation evidence.",
			"Forbidden paths were touched.",
		]);
		expect(boundaryAuditEventSeverity(result)).toBe("warning");
	});

	it("normalizes a clean accepted audit without warning additions", async () => {
		ontologyService.checkOntologyBoundary.mockResolvedValue({
			decision: "accept",
			allowed: null,
			needsConfirmation: {},
			forbiddenTouched: "invalid",
			crossings: undefined,
			warnings: [],
		});
		const result = await buildOntologyBoundaryAuditSnapshot({
			repoRoot: "/repo",
			ontologyContext: storedOntology({ warnings: [] }),
			touchedFiles: ["api/modules/ontology/a.ts"],
		});
		expect(result.available).toBe(true);
		expect(result.verificationSelection.warnings).toEqual([]);
		expect(result.warnings).toEqual([]);
		expect(boundaryAuditEventSeverity(result)).toBe("info");
	});

	it("returns unavailable audits for Error and non-Error boundary failures", async () => {
		ontologyService.checkOntologyBoundary.mockRejectedValueOnce(
			new Error("boundary exploded"),
		);
		const errorResult = await buildOntologyBoundaryAuditSnapshot({
			repoRoot: "/repo",
			ontologyContext: storedOntology(),
			touchedFiles: ["src/a.ts"],
		});
		expect(errorResult.warnings).toEqual([
			"Ontology boundary audit failed: boundary exploded",
		]);
		expect(boundaryAuditEventSeverity(errorResult)).toBe("warning");

		ontologyService.checkOntologyBoundary.mockRejectedValueOnce(503);
		const rawResult = await buildOntologyBoundaryAuditSnapshot({
			repoRoot: "/repo",
			ontologyContext: storedOntology(),
			touchedFiles: ["src/a.ts"],
		});
		expect(rawResult.warnings).toEqual(["Ontology boundary audit failed: 503"]);
		expect(boundaryAuditEventSeverity({ ...rawResult, touchedFiles: [] })).toBe(
			"info",
		);
	});

	it("formats absent, minimal, and complete runtime prompt snapshots", () => {
		expect(formatOntologyRuntimeContextForPrompt(undefined)).toContain(
			"available: false (Ontology runtime snapshot is absent.)",
		);
		expect(
			formatOntologyRuntimeContextForPrompt(
				storedOntology({ available: false, warnings: [] }),
			),
		).toContain("available: false\n");

		const complete = formatOntologyRuntimeContextForPrompt(storedOntology());
		for (const expected of [
			"primary module: ontology",
			"secondary modules: coding-agent",
			"summary type: task_scoped",
			"task generation evidence: present",
			"task candidate id: candidate-1",
			"owned paths: api/modules/ontology/**",
			"invariants: Keep module boundary",
			"focused verification candidates: bun test ontology",
			"boundary warnings: crossing warning",
			"warnings: context warning",
		]) {
			expect(complete).toContain(expected);
		}

		const minimal = formatOntologyRuntimeContextForPrompt(
			storedOntology({
				primaryModule: null,
				secondaryModules: [],
				summaryType: null,
				taskGenerationEvidence: false,
				taskCandidateId: null,
				ownedPaths: [],
				invariants: [],
				focusedVerification: [],
				boundaryWarnings: [],
				warnings: [],
			}),
		);
		expect(minimal).toContain("primary module: unknown");
		expect(minimal).toContain("secondary modules: none");
		expect(minimal).toContain("summary type: unknown");
		expect(minimal).toContain("task generation evidence: absent");
		expect(minimal).toContain("focused verification candidates: none");
		expect(minimal).not.toContain("task candidate id:");
	});

	it("formats stable closeout requirements and covers remaining severities", () => {
		const prompt = formatOntologyCloseoutRequirementsForPrompt();
		expect(prompt).toContain("Ontology closeout requirements:");
		expect(prompt).toContain("Before finalReport");
		expect(prompt).toContain("record the crossing reason");

		expect(
			boundaryAuditEventSeverity({
				version: 1,
				available: true,
				source: "check_boundary",
				decision: "reject",
				primaryModule: "ontology",
				touchedFiles: ["a.ts"],
				ownedPathsTouched: [],
				boundaryCrossings: [],
				forbiddenTouched: [],
				needsConfirmation: [],
				verificationSelection: { focused: [], warnings: [] },
				warnings: [],
			}),
		).toBe("warning");
		expect(
			boundaryAuditEventSeverity({
				version: 1,
				available: true,
				source: "check_boundary",
				decision: "accept",
				primaryModule: "ontology",
				touchedFiles: ["a.ts"],
				ownedPathsTouched: [],
				boundaryCrossings: [],
				forbiddenTouched: [],
				needsConfirmation: [{ path: "a.ts", reason: null }],
				verificationSelection: { focused: [], warnings: [] },
				warnings: [],
			}),
		).toBe("warning");
	});
});
