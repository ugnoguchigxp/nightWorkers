import { describe, expect, it } from "vitest";
import { evaluateDependencyAudit } from "../scripts/dependency-audit-policy.mjs";

const highFinding = {
	id: 42,
	severity: "high",
	title: "reachable vulnerability",
	url: "https://example.com/advisory",
};

describe("dependency audit policy", () => {
	it("blocks unallowlisted High and Critical findings but not Moderate findings", () => {
		const result = evaluateDependencyAudit(
			{
				runtime: [highFinding],
				development: [{ ...highFinding, id: 43, severity: "moderate" }],
			},
			{ exceptions: [] },
		);

		expect(result.unallowlisted).toHaveLength(1);
		expect(result.unallowlisted[0]?.packageName).toBe("runtime");
	});

	it("requires advisory, owner, reason, mitigation, and a future expiry", () => {
		const result = evaluateDependencyAudit(
			{ runtime: [highFinding] },
			{
				exceptions: [
					{
						advisoryId: 42,
						package: "runtime",
						owner: "security-team",
						reason: "not reachable",
						mitigation: "feature remains disabled",
						expiresAt: "2026-08-01T00:00:00.000Z",
					},
				],
			},
			new Date("2026-07-10T00:00:00.000Z"),
		);

		expect(result.unallowlisted).toEqual([]);
		expect(result.staleExceptions).toEqual([]);
		expect(result.activeExceptions).toHaveLength(1);
	});

	it("does not apply an advisory exception to a different package", () => {
		const result = evaluateDependencyAudit(
			{ otherRuntime: [highFinding] },
			{
				exceptions: [
					{
						advisoryId: 42,
						package: "runtime",
						owner: "security-team",
						reason: "not reachable",
						mitigation: "feature remains disabled",
						expiresAt: "2026-08-01T00:00:00.000Z",
					},
				],
			},
			new Date("2026-07-10T00:00:00.000Z"),
		);

		expect(result.unallowlisted).toHaveLength(1);
		expect(result.staleExceptions).toHaveLength(1);
	});

	it("honors minimumSeverity and reports unsupported policy values", () => {
		const criticalOnly = evaluateDependencyAudit(
			{
				runtime: [
					highFinding,
					{ ...highFinding, id: 44, severity: "critical" },
				],
			},
			{ minimumSeverity: "critical", exceptions: [] },
		);
		expect(criticalOnly.findings.map((finding) => finding.id)).toEqual([44]);
		expect(criticalOnly.configurationErrors).toEqual([]);

		const invalid = evaluateDependencyAudit(
			{ runtime: [highFinding] },
			{ minimumSeverity: "urgent", exceptions: [] },
		);
		expect(invalid.configurationErrors).toEqual([
			"Unsupported minimumSeverity: urgent",
		]);
	});

	it("rejects an exception without an accountable owner", () => {
		const result = evaluateDependencyAudit(
			{ runtime: [highFinding] },
			{
				exceptions: [
					{
						advisoryId: 42,
						package: "runtime",
						reason: "not reachable",
						mitigation: "feature remains disabled",
						expiresAt: "2026-08-01T00:00:00.000Z",
					},
				],
			},
			new Date("2026-07-10T00:00:00.000Z"),
		);
		expect(result.unallowlisted).toHaveLength(1);
		expect(result.staleExceptions).toHaveLength(1);
	});
});
