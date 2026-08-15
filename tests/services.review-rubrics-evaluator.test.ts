import { describe, expect, it } from "vitest";
import { evaluateDeterministicRubric } from "../api/modules/review/rubrics/deterministic-evaluator";
import { loadRubric } from "../api/modules/review/rubrics/loader";
import type {
	ReviewEvidencePack,
	RubricDefinition,
} from "../api/modules/review/rubrics/types";

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

	it("evaluates event references, failure streaks, limits, and non-deterministic criteria independently", () => {
		const rubric: RubricDefinition = {
			version: 1,
			id: "critical-branches",
			title: "Critical branches",
			scope: {},
			criteria: [
				{
					id: "event",
					title: "Completion event",
					severity: "warning",
					evaluationMode: "deterministic",
					evidenceSelectors: [
						{ kind: "run_event_type", type: "verification.finished" },
					],
				},
				{
					id: "tool-failures",
					title: "Tool failure streak",
					severity: "blocking",
					evaluationMode: "deterministic",
					evidenceSelectors: [{ kind: "tool_failure", maxConsecutive: 2 }],
				},
				{
					id: "diff-budget",
					title: "Diff budget",
					severity: "warning",
					evaluationMode: "deterministic",
					evidenceSelectors: [{ kind: "diff", maxBytes: 10 }],
				},
				{
					id: "optional-report",
					title: "Optional report",
					severity: "warning",
					evaluationMode: "deterministic",
					evidenceSelectors: [{ kind: "final_report", required: false }],
					rule: { required: false, failWhenPresent: true },
				},
				{
					id: "llm-only",
					title: "LLM criterion",
					severity: "warning",
					evaluationMode: "llm",
					evidenceSelectors: [],
				},
			],
		};
		const result = evaluateDeterministicRubric(rubric, {
			...basePack,
			selectedEvents: [
				{
					id: "event-1",
					seq: 1,
					type: "verification.finished",
					severity: "info",
					message: "done",
				},
				{
					id: "failure-1",
					seq: 2,
					type: "tool.call_finished",
					severity: "error",
					message: "failed",
				},
				{
					id: "failure-2",
					seq: 3,
					type: "tool.call_finished",
					severity: "error",
					message: "failed again",
				},
				{
					seq: 4,
					type: "tool.call_finished",
					severity: "info",
					message: "recovered",
				},
			],
			eventTypes: ["verification.finished", "tool.call_finished"],
		});

		expect(
			Object.fromEntries(
				result.criterionResults.map((criterion) => [
					criterion.criterionId,
					criterion.passed,
				]),
			),
		).toEqual({
			event: true,
			"tool-failures": false,
			"diff-budget": false,
			"optional-report": true,
		});
		expect(result.findings.map((finding) => finding.title)).toEqual([
			"Tool failure streak",
			"Diff budget",
		]);
		expect(result.evidenceRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "run_event", eventId: "failure-1" }),
				expect.objectContaining({ kind: "diff", bytes: 42 }),
			]),
		);
		expect(result.verdict).toBe("changes_requested");
	});
});
