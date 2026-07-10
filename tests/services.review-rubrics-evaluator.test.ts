import { describe, expect, it } from "vitest";
import { evaluateDeterministicRubric } from "../api/modules/review/rubrics/deterministic-evaluator";
import { loadRubric } from "../api/modules/review/rubrics/loader";
import type { ReviewEvidencePack } from "../api/modules/review/rubrics/types";

const basePack: ReviewEvidencePack = {
	version: 1,
	runId: "11111111-1111-4111-8111-111111111111",
	taskId: "22222222-2222-4222-8222-222222222222",
	status: "needs_review",
	finalReport: "Finished",
	diff: { hasChanges: true, bytes: 42, changedFiles: ["src/a.ts"] },
	verification: [
		{ eventId: "33333333-3333-4333-8333-333333333333", passed: true },
	],
	policy: [],
	reviewResults: [],
	selectedEvents: [],
	eventTypes: [],
	diagnostics: [],
};

describe("deterministic rubric evaluator", () => {
	it("approves the same complete input deterministically", () => {
		const rubric = loadRubric("basic-coding-run").rubric;
		const first = evaluateDeterministicRubric(rubric, basePack);
		const second = evaluateDeterministicRubric(rubric, basePack);

		expect(first).toEqual(second);
		expect(first.verdict).toBe("approved");
		expect(first.findings).toHaveLength(0);
	});

	it("creates blocking findings for missing diff, missing verification, and policy violations", () => {
		const rubric = loadRubric("basic-coding-run").rubric;
		const result = evaluateDeterministicRubric(rubric, {
			...basePack,
			finalReport: "Finished",
			diff: { hasChanges: false, bytes: 0, changedFiles: [] },
			verification: [],
			policy: [
				{
					eventId: "33333333-3333-4333-8333-333333333334",
					code: "DENY",
					message: "blocked",
				},
			],
		});

		expect(result.verdict).toBe("changes_requested");
		expect(
			result.findings.filter((finding) => finding.severity === "blocking"),
		).toHaveLength(3);
		expect(
			result.findings.flatMap((finding) => finding.evidenceRefs ?? []),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "diff" }),
				expect.objectContaining({ kind: "policy" }),
			]),
		);
	});

	it("does not treat verification.started as a completed verification result", () => {
		const rubric = loadRubric("basic-coding-run").rubric;
		const result = evaluateDeterministicRubric(rubric, {
			...basePack,
			verification: [],
			selectedEvents: [
				{
					id: "33333333-3333-4333-8333-333333333333",
					seq: 1,
					type: "verification.started",
					severity: "checkpoint",
					message: "Verification started",
				},
			],
			eventTypes: ["verification.started"],
		});

		expect(result.verdict).toBe("changes_requested");
		expect(result.findings.map((finding) => finding.title)).toContain(
			"Verification result is present",
		);
	});

	it("evaluates run_event_type criteria against all event types, not selected timeline events only", () => {
		const rubric = loadRubric("review-ready-run").rubric;
		const result = evaluateDeterministicRubric(rubric, {
			...basePack,
			selectedEvents: [],
			eventTypes: ["verification.finished"],
		});

		expect(result.findings.map((finding) => finding.title)).not.toContain(
			"Verification result is present",
		);
	});

	it("requires blocking review findings to have follow-up instructions", () => {
		const rubric = loadRubric("review-ready-run").rubric;
		const result = evaluateDeterministicRubric(rubric, {
			...basePack,
			reviewResults: [
				{
					findings: [
						{ severity: "blocking", title: "Fix this before completion" },
					],
					humanCallouts: [],
					agentFollowUps: [],
				},
			],
		});

		expect(result.findings.map((finding) => finding.title)).toContain(
			"Blocking review findings have follow-up instructions",
		);
	});

	it("rejects blocking findings duplicated into human callouts", () => {
		const rubric = loadRubric("review-ready-run").rubric;
		const result = evaluateDeterministicRubric(rubric, {
			...basePack,
			reviewResults: [
				{
					findings: [
						{ severity: "blocking", title: "Fix this before completion" },
					],
					humanCallouts: [
						{ severity: "blocking", title: "Fix this before completion" },
					],
					agentFollowUps: ["Fix this before completion."],
				},
			],
		});

		expect(result.findings.map((finding) => finding.title)).toContain(
			"Human callouts are separated from blocking findings",
		);
	});
});
