import { describe, expect, it } from "vitest";
import {
	compareRunControlMetrics,
	parseRunControlComparisonArgs,
} from "../scripts/run-control-db-comparison.mjs";

describe("run control DB comparison", () => {
	it("parses explicit baseline and bounded run limit", () => {
		expect(
			parseRunControlComparisonArgs([
				"--baseline",
				"backup/before.db",
				"--current",
				"sqlite.db",
				"--limit",
				"40",
				"--json",
			]),
		).toEqual({
			baseline: "backup/before.db",
			current: "sqlite.db",
			limit: 40,
			json: true,
		});
		expect(() => parseRunControlComparisonArgs([])).toThrow("--baseline");
	});

	it("keeps absolute deltas separate from percentage changes", () => {
		const comparison = compareRunControlMetrics(
			{ inputTokens: 100, modelSteps: 10 },
			{ inputTokens: 75, modelSteps: 12 },
		);

		expect(comparison.inputTokens).toEqual({
			baseline: 100,
			current: 75,
			delta: -25,
			deltaPercent: -25,
		});
		expect(comparison.modelSteps).toEqual({
			baseline: 10,
			current: 12,
			delta: 2,
			deltaPercent: 20,
		});
	});
});
