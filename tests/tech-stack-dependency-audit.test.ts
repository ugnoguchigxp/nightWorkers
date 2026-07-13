import { describe, expect, it } from "vitest";
import { parseBunDependencyAuditReport } from "../api/modules/techStack/dependency-audit.service";

describe("Bun dependency audit normalization", () => {
	it("normalizes and sorts Bun advisories with severity totals", () => {
		const result = parseBunDependencyAuditReport(
			{
				"low-package": [
					{
						id: 10,
						title: "Low issue",
						severity: "low",
						vulnerable_versions: "<2.0.0",
						url: "https://example.com/low",
					},
				],
				"high-package": [
					{
						id: 20,
						title: "High issue",
						severity: "high",
						vulnerable_versions: "<=1.0.0",
						url: "https://example.com/high",
					},
				],
			},
			new Date("2026-07-13T00:00:00.000Z"),
		);

		expect(result).toMatchObject({
			packageManager: "bun",
			auditedAt: new Date("2026-07-13T00:00:00.000Z"),
			counts: { total: 2, low: 1, moderate: 0, high: 1, critical: 0 },
		});
		expect(result.findings.map((finding) => finding.packageName)).toEqual([
			"high-package",
			"low-package",
		]);
	});

	it("rejects a non-object audit report", () => {
		expect(() => parseBunDependencyAuditReport([])).toThrow(
			"bun audit returned an invalid JSON report",
		);
	});
});
