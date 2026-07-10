import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	evaluateE2eScenarioCoverage,
	validateE2eScenarioCatalog,
} from "../scripts/e2e-scenario-coverage.mjs";

function catalog(
	scenarios: Array<{
		id: string;
		priority: "P0" | "P1" | "P2";
		gateStatus?: "required" | "planned" | "observational";
		suite?: "smoke" | "regression" | "accessibility" | "live";
	}>,
) {
	return {
		version: 1,
		thresholds: {
			p0CoverageMinimum: 100,
			weightedCoverageMinimum: 80,
			executedPassRateMinimum: 100,
			p0FlakeMaximum: 0,
		},
		weights: { P0: 5, P1: 3, P2: 1 },
		scenarios: scenarios.map((scenario) => ({
			id: scenario.id,
			title: scenario.id,
			priority: scenario.priority,
			suite: scenario.suite ?? "regression",
			gateStatus: scenario.gateStatus ?? "required",
			requiredEvidence: ["api"],
		})),
	};
}

function report(
	specs: Array<{
		id: string;
		priority: "P0" | "P1" | "P2";
		status?: "expected" | "unexpected" | "flaky" | "skipped";
		resultStatuses?: string[];
		extraTags?: string[];
	}>,
) {
	return {
		suites: [
			{
				specs: specs.map((spec, index) => ({
					title: spec.id,
					file: "fixture.spec.ts",
					line: index + 1,
					tags: [
						"deterministic",
						spec.priority.toLowerCase(),
						`scenario:${spec.id}`,
						...(spec.extraTags ?? []),
					],
					tests: [
						{
							status: spec.status ?? "expected",
							results: (spec.resultStatuses ?? ["passed"]).map((status) => ({
								status,
							})),
						},
					],
				})),
			},
		],
	};
}

describe("E2E scenario coverage", () => {
	it("keeps the tracked NightWorkers scenario catalog valid", () => {
		const trackedCatalog = JSON.parse(
			fs.readFileSync(path.resolve("tests/e2e/scenario-catalog.json"), "utf8"),
		);

		expect(validateE2eScenarioCatalog(trackedCatalog).errors).toEqual([]);
	});

	it("passes when all required scenarios are mapped and pass", () => {
		const result = evaluateE2eScenarioCoverage({
			catalog: catalog([
				{ id: "NW-E2E-RUN-001", priority: "P0" },
				{ id: "NW-E2E-UI-001", priority: "P1" },
				{
					id: "NW-E2E-RUN-PLANNED",
					priority: "P0",
					gateStatus: "planned",
				},
			]),
			report: report([
				{ id: "NW-E2E-RUN-001", priority: "P0" },
				{ id: "NW-E2E-UI-001", priority: "P1" },
			]),
			now: new Date("2026-07-10T00:00:00.000Z"),
		});

		expect(result.passed).toBe(true);
		expect(result.summary).toMatchObject({
			requiredScenarios: 2,
			automatedScenarios: 2,
			passedScenarios: 2,
			p0Coverage: 100,
			weightedCoverage: 100,
			executedPassRate: 100,
			plannedScenarios: 1,
		});
	});

	it("fails when a required P0 scenario is not automated", () => {
		const result = evaluateE2eScenarioCoverage({
			catalog: catalog([
				{ id: "NW-E2E-RUN-001", priority: "P0" },
				{ id: "NW-E2E-RUN-002", priority: "P0" },
			]),
			report: report([{ id: "NW-E2E-RUN-001", priority: "P0" }]),
		});

		expect(result.passed).toBe(false);
		expect(result.summary.p0Coverage).toBe(50);
		expect(result.uncovered).toEqual(["NW-E2E-RUN-002"]);
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "required_scenario_unmapped" }),
			]),
		);
	});

	it("fails a flaky P0 scenario even when the retry passes", () => {
		const result = evaluateE2eScenarioCoverage({
			catalog: catalog([{ id: "NW-E2E-RUN-001", priority: "P0" }]),
			report: report([
				{
					id: "NW-E2E-RUN-001",
					priority: "P0",
					status: "flaky",
					resultStatuses: ["failed", "passed"],
				},
			]),
		});

		expect(result.passed).toBe(false);
		expect(result.summary.executedPassRate).toBe(100);
		expect(result.summary.p0Flakes).toBe(1);
		expect(result.thresholdResults.p0Flake).toBe(false);
	});

	it("reports invalid catalogs and unknown scenario tags", () => {
		const invalidCatalog = catalog([
			{ id: "NW-E2E-RUN-001", priority: "P0" },
			{ id: "NW-E2E-RUN-001", priority: "P1" },
		]);
		expect(validateE2eScenarioCatalog(invalidCatalog).errors).toContain(
			"catalog.scenarios[1].id is duplicated: NW-E2E-RUN-001",
		);

		const result = evaluateE2eScenarioCoverage({
			catalog: catalog([{ id: "NW-E2E-RUN-001", priority: "P0" }]),
			report: report([{ id: "NW-E2E-UNKNOWN-001", priority: "P0" }]),
		});
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "unknown_scenario" }),
			]),
		);
		expect(result.passed).toBe(false);
	});
});
