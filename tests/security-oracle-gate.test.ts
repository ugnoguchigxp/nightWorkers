import { describe, expect, it } from "vitest";
import { isSecurityOracleFinalizationBlocked } from "../api/modules/nightworkers/run-orchestration/runtime-security-closeout";
import type { VulnWorkbenchSecurityResult } from "../api/modules/review";
import {
	blockingScopedSecurityFindings,
	compareSecurityFingerprints,
	hasSecurityFixIterationBudget,
	isCleanSecurityDiagnostic,
	nextSecurityGateIteration,
} from "../api/modules/review";
import type { SecurityGateResult } from "../shared/schemas/security-oracle.schema";

function diagnostic(
	overrides: Partial<VulnWorkbenchSecurityResult> = {},
): VulnWorkbenchSecurityResult {
	return {
		ok: true,
		status: "completed",
		projectId: "project-1",
		projectPath: "/tmp/project",
		scanRunId: "scan-1",
		profile: "agent-output",
		topFindings: [],
		findingsTruncated: false,
		blockingFingerprints: [],
		commandsRun: [],
		findingCount: 0,
		highOrCriticalCount: 0,
		improvementRequest: null,
		error: null,
		...overrides,
	};
}

function previous(fingerprints: string[]): SecurityGateResult {
	return {
		version: 1,
		status: "continue",
		allowFinalize: false,
		scanRunId: "scan-0",
		previousScanRunId: null,
		blockingFingerprints: fingerprints,
		previousBlockingFingerprints: [],
		comparison: "initial",
		iteration: 1,
		maxIterations: 3,
		message: "fix required",
		findingCount: fingerprints.length,
		highOrCriticalCount: fingerprints.length,
		securityFixTodoId: "todo-1",
	};
}

describe("Security Oracle closeout gate", () => {
	it("treats an intentional policy skip as non-blocking", () => {
		expect(
			isSecurityOracleFinalizationBlocked({
				outcomeStatus: "completed",
				executionMode: "implementation",
				usesE2eFixture: false,
				securityOracleSkipped: true,
				allowFinalize: null,
			}),
		).toBe(false);
		expect(
			isSecurityOracleFinalizationBlocked({
				outcomeStatus: "completed",
				executionMode: "implementation",
				usesE2eFixture: false,
				securityOracleSkipped: false,
				allowFinalize: null,
			}),
		).toBe(true);
	});

	it("only treats a complete scan without blocking findings as clean", () => {
		expect(isCleanSecurityDiagnostic(diagnostic())).toBe(true);
		expect(
			isCleanSecurityDiagnostic(
				diagnostic({ status: "inconclusive", highOrCriticalCount: 0 }),
			),
		).toBe(false);
		expect(
			isCleanSecurityDiagnostic(
				diagnostic({
					status: "security_action_required",
					highOrCriticalCount: 1,
					blockingFingerprints: ["fp-1"],
				}),
			),
		).toBe(false);
	});

	it.each([
		[["fp-1"], [], "resolved"],
		[["fp-1"], ["fp-1"], "still_present"],
		[["fp-1"], ["fp-2"], "changed"],
	] as const)("compares rerun fingerprints as %s", (before, after, expected) => {
		expect(
			compareSecurityFingerprints(
				previous([...before]),
				diagnostic({ blockingFingerprints: [...after] }),
			),
		).toBe(expected);
	});

	it("rejects absolute and parent traversal locations from automatic scope", () => {
		const result = diagnostic({
			blockingFingerprints: ["safe", "absolute", "traversal"],
			topFindings: [
				finding("safe", "src/safe.ts"),
				finding("absolute", "/tmp/outside.ts"),
				finding("traversal", "../outside.ts"),
			],
		});
		expect(
			blockingScopedSecurityFindings(result).map((item) => item.fingerprint),
		).toEqual(["safe"]);
	});

	it("allows exactly the configured number of security fix iterations", () => {
		expect(hasSecurityFixIterationBudget(1, 1)).toBe(true);
		expect(hasSecurityFixIterationBudget(3, 3)).toBe(true);
		expect(hasSecurityFixIterationBudget(4, 3)).toBe(false);
	});

	it("does not carry scanner failures into the remediation iteration count", () => {
		expect(
			nextSecurityGateIteration({
				...previous([]),
				status: "needs_human",
				comparison: "scanner_failed",
			}),
		).toBe(1);
		expect(nextSecurityGateIteration(previous(["fp-1"]))).toBe(2);
	});
});

function finding(fingerprint: string, path: string) {
	return {
		id: fingerprint,
		fingerprint,
		severity: "high",
		tool: "semgrep",
		ruleId: "rule",
		title: "finding",
		location: { path, line: 1 },
		recommendation: "fix it",
	};
}
