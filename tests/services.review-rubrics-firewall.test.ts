import { describe, expect, it } from "vitest";
import { evaluateDeterministicRubric } from "../api/services/review-rubrics/deterministic-evaluator";
import { applyReviewerFirewall } from "../api/services/review-rubrics/firewall";
import { loadRubric } from "../api/services/review-rubrics/loader";
import type { ReviewEvidencePack } from "../api/services/review-rubrics/types";

const pack: ReviewEvidencePack = {
	version: 1,
	runId: "11111111-1111-4111-8111-111111111111",
	taskId: "22222222-2222-4222-8222-222222222222",
	status: "needs_review",
	finalReport: "Finished",
	diff: { hasChanges: false, bytes: 0, changedFiles: [] },
	verification: [],
	policy: [],
	reviewResults: [],
	selectedEvents: [],
	eventTypes: [],
	diagnostics: [],
};

describe("reviewer firewall", () => {
	it("rejects unsupported draft schema and secret-like output", () => {
		const deterministic = evaluateDeterministicRubric(
			loadRubric("basic-coding-run").rubric,
			pack,
		);

		expect(
			applyReviewerFirewall({
				rawOutput: { version: 1, verdict: "ship_it", summary: "ok" },
				evidencePack: pack,
				deterministic,
			}).status,
		).toBe("failed");

		expect(
			applyReviewerFirewall({
				rawOutput: {
					version: 1,
					verdict: "changes_requested",
					summary: "token=raw-secret",
					findings: [],
					humanCallouts: [],
					agentFollowUps: [],
					suggestedNextTasks: [],
				},
				evidencePack: pack,
				deterministic,
			}).errorCode,
		).toBe("LLM_OUTPUT_SECRET_LIKE_TEXT");
	});

	it("degrades unknown evidence refs and deterministic blocking override", () => {
		const deterministic = evaluateDeterministicRubric(
			loadRubric("basic-coding-run").rubric,
			pack,
		);
		const result = applyReviewerFirewall({
			rawOutput: {
				version: 1,
				verdict: "approved",
				summary: "approved",
				findings: [
					{
						severity: "info",
						title: "unknown evidence",
						evidenceRefs: [
							{
								kind: "run_event",
								eventId: "33333333-3333-4333-8333-333333333333",
							},
						],
					},
				],
				humanCallouts: [],
				agentFollowUps: [],
				suggestedNextTasks: [],
			},
			evidencePack: pack,
			deterministic,
		});

		expect(result.status).toBe("degraded");
		expect(result.degradedReasons).toEqual(
			expect.arrayContaining([
				"llm_output_unknown_evidence_ref",
				"llm_approved_despite_deterministic_blocking",
			]),
		);
		expect(result.draft?.findings[0].title).toContain(
			"Unsupported evidence reference",
		);
	});

	it("requires changed_file and artifact refs to exist in the evidence pack", () => {
		const deterministic = evaluateDeterministicRubric(
			loadRubric("basic-coding-run").rubric,
			{
				...pack,
				diff: { hasChanges: true, bytes: 10, changedFiles: ["src/known.ts"] },
				verification: [
					{ eventId: "33333333-3333-4333-8333-333333333333", passed: true },
				],
			},
		);
		const result = applyReviewerFirewall({
			rawOutput: {
				version: 1,
				verdict: "approved",
				summary: "approved",
				findings: [
					{
						severity: "info",
						title: "mixed refs",
						evidenceRefs: [
							{ kind: "changed_file", path: "src/known.ts" },
							{ kind: "changed_file", path: "src/missing.ts" },
							{ kind: "artifact", artifactId: "missing-artifact" },
						],
					},
				],
				humanCallouts: [],
				agentFollowUps: [],
				suggestedNextTasks: [],
			},
			evidencePack: {
				...pack,
				diff: { hasChanges: true, bytes: 10, changedFiles: ["src/known.ts"] },
				verification: [
					{ eventId: "33333333-3333-4333-8333-333333333333", passed: true },
				],
			},
			deterministic,
		});

		expect(result.status).toBe("degraded");
		expect(result.degradedReasons).toContain("llm_output_unknown_evidence_ref");
		expect(result.draft?.findings[0].evidenceRefs).toEqual([
			{ kind: "changed_file", path: "src/known.ts" },
		]);
	});
});
