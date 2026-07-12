import { describe, expect, it } from "vitest";
import { coverageAxesFromQualityRun } from "../api/modules/overview/overview-coverage";
import { projectQualityRunSchema } from "../shared/schemas/quality.schema";

const baseRun = projectQualityRunSchema.parse({
	id: "9cd9bdf7-6460-4866-a3bf-fc7b18d46f49",
	repositoryId: "23d6c7d1-9780-4906-a074-0ea8a066f774",
	runType: "all",
	status: "completed",
	command: "bun run test:coverage",
	exitCode: 0,
	startedAt: "2026-07-10T00:00:00.000Z",
	completedAt: "2026-07-10T00:01:00.000Z",
	outputArtifactId: null,
	latestOutput: null,
	coverageSummary: null,
	e2eSummary: null,
	errorMessage: null,
	createdAt: "2026-07-10T00:00:00.000Z",
	updatedAt: "2026-07-10T00:01:00.000Z",
});

describe("Overview coverage snapshot", () => {
	it("falls back to the coverage summary total", () => {
		expect(
			coverageAxesFromQualityRun({
				...baseRun,
				coverageSummary: {
					total: {
						statements: { pct: 93.57 },
						branches: { pct: 82.44 },
						functions: { pct: 92.3 },
						lines: { pct: 95.04 },
					},
				},
			}),
		).toEqual([
			{ key: "statements", actualPercent: 93.57 },
			{ key: "branches", actualPercent: 82.44 },
			{ key: "functions", actualPercent: 92.3 },
			{ key: "lines", actualPercent: 95.04 },
		]);
	});
});
