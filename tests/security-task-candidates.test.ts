import { describe, expect, it } from "vitest";
import {
	sanitizeSecurityFindingForTaskGeneration,
	securityFindingFingerprint,
} from "../api/modules/securityScan/security-scan-evidence.service";
import {
	buildSecurityTaskCandidatesResponseJsonSchema,
	validateSecurityTaskCandidateFacts,
} from "../api/modules/taskGeneration/security-task-candidate.service";
import { securityScanTaskCandidatesResultSchema } from "../shared/schemas/security-task-generation.schema";

function generatedResult() {
	return securityScanTaskCandidatesResultSchema.parse({
		schemaVersion: "nightworkers.security-task-candidates/v1",
		candidates: [
			{
				title: "依存パッケージの脆弱性を修正する",
				candidateKind: "security_remediation",
				findingRefs: ["finding-1"],
				summary: "安全なversionへ更新する。",
				rationale: "既知の脆弱性が検出された。",
				moduleRouting: {
					primaryModule: null,
					secondaryModules: [],
					confidencePercent: 20,
					reason: "module情報が不足している。",
				},
				planModeOpenQuestions: [],
				importancePercent: 90,
				confidencePercent: 80,
				tokenSize: "small",
				complexity: "simple",
				taskPrompt: "依存パッケージを安全なversionへ更新してください。",
				acceptanceCriteria: "対象Findingが解消されること。",
				verificationPlan: "テストと再スキャンを実行する。",
			},
		],
		needsHuman: [{ findingRef: "finding-2", reason: "仕様確認が必要。" }],
	});
}

describe("security task candidate generation", () => {
	it("builds a structured-output compatible response schema", () => {
		const schema = buildSecurityTaskCandidatesResponseJsonSchema();
		const serialized = JSON.stringify(schema);
		expect(serialized).not.toContain('"$schema"');
		expect(serialized).not.toContain('"default"');
		expect(serialized).toContain("nightworkers.security-task-candidates/v1");
	});

	it("rejects unknown fields and whitespace-only task instructions", () => {
		expect(
			securityScanTaskCandidatesResultSchema.safeParse({
				...generatedResult(),
				unexpected: true,
			}).success,
		).toBe(false);
		const value = generatedResult();
		const [candidate] = value.candidates;
		expect(candidate).toBeDefined();
		if (!candidate) return;
		candidate.taskPrompt = "   ";
		expect(
			securityScanTaskCandidatesResultSchema.safeParse(value).success,
		).toBe(false);
	});

	it("accepts an exact candidate and human-review partition", () => {
		expect(
			validateSecurityTaskCandidateFacts(
				generatedResult(),
				new Set(["finding-1", "finding-2"]),
			),
		).toEqual([]);
	});

	it("rejects missing, duplicate, and hallucinated Finding references", () => {
		const value = generatedResult();
		const [candidate] = value.candidates;
		expect(candidate).toBeDefined();
		if (!candidate) return;
		candidate.findingRefs.push("finding-2", "finding-unknown");
		const issues = validateSecurityTaskCandidateFacts(
			value,
			new Set(["finding-1", "finding-2", "finding-3"]),
		);
		expect(issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"duplicate_finding_assignment",
				"unknown_finding_reference",
				"missing_finding_assignment",
			]),
		);
	});

	it("rejects duplicate candidate titles", () => {
		const value = generatedResult();
		const [candidate] = value.candidates;
		expect(candidate).toBeDefined();
		if (!candidate) return;
		value.candidates.push({
			...candidate,
			findingRefs: ["finding-2"],
			title: candidate.title.toUpperCase(),
		});
		value.needsHuman = [];
		expect(
			validateSecurityTaskCandidateFacts(
				value,
				new Set(["finding-1", "finding-2"]),
			).map((issue) => issue.code),
		).toContain("duplicate_candidate_title");
	});

	it("uses stable semantic Finding fingerprints without evidence content", () => {
		const finding = {
			ref: "finding-1",
			severity: "high" as const,
			title: "Unsafe dependency",
			category: "dependency",
			tool: "osv",
			ruleId: "CVE-TEST",
			location: { path: "package.json", startLine: 10, endLine: 10 },
			description: "description",
			evidence: "token=should-not-affect-fingerprint",
			recommendation: "upgrade",
			references: [],
		};
		const fingerprint = securityFindingFingerprint(finding);
		expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(
			securityFindingFingerprint({
				...finding,
				ref: "finding-from-another-scan",
				evidence: "different secret evidence",
			}),
		).toBe(fingerprint);
		expect(
			securityFindingFingerprint({
				...finding,
				location: { ...finding.location, startLine: 11 },
			}),
		).not.toBe(fingerprint);
	});

	it("excludes raw evidence and redacts secret-like values before LLM input", () => {
		const safe = sanitizeSecurityFindingForTaskGeneration("/repo", {
			ref: "finding-1",
			severity: "critical",
			title: "Leaked token",
			category: "secret",
			tool: "gitleaks",
			ruleId: "secret-rule",
			location: {
				path: "/repo/src/config.ts",
				startLine: 1,
				endLine: 1,
			},
			description: "token=super-secret-value",
			evidence: "super-secret-value",
			recommendation: "Rotate token=super-secret-value",
			references: ["https://user:pass@example.com/advisory?token=secret#raw"],
		});

		expect(safe.location.path).toBe("src/config.ts");
		expect(safe.description).toContain("[REDACTED]");
		expect(safe.recommendation).toContain("[REDACTED]");
		expect(safe.references).toEqual(["https://example.com/advisory"]);
		expect(JSON.stringify(safe)).not.toContain("super-secret-value");
		expect(JSON.stringify(safe)).not.toContain("evidence");
	});
});
