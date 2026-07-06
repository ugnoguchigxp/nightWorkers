import { describe, expect, it } from "vitest";
import { buildReviewResult } from "../api/services/review-results/build-review-result";
import { collectDefaultReviewEvidence } from "../api/services/review-results/evidence-collector";

describe("review-results builder", () => {
	it("maps actions to review verdicts", () => {
		const result = buildReviewResult({
			run: {
				id: "run-1",
				taskId: "task-1",
				status: "needs_review",
				summary: "ready for review",
			},
			request: {
				action: "cancel",
				note: "This result was not useful",
			},
			outcome: {
				status: "cancelled",
				reason: "human_review",
				summary: "Human review cancelled run.",
			},
			evidenceRefs: [],
			createdAt: "2026-06-02T00:00:00.000Z",
		});

		expect(result.verdict).toBe("cancelled");
		expect(result.statusBefore).toBe("needs_review");
		expect(result.statusAfter).toBe("cancelled");
	});
});

describe("review-results evidence collector", () => {
	it("collects diff, final report, verification, and policy evidence", () => {
		const refs = collectDefaultReviewEvidence(
			{
				id: "run-1",
				diffPatch: "diff --git a/a b/a",
				finalReport: "finished",
			},
			[
				{
					id: "evt-1",
					seq: 1,
					type: "verification.finished",
					eventType: "checkpoint",
					payloadJson: {
						runEvent: {
							type: "verification.finished",
							data: { passed: true, command: "pnpm test" },
						},
					},
				} as never,
				{
					id: "evt-2",
					seq: 2,
					type: "tool.policy_blocked",
					eventType: "error",
					message: "blocked",
					payloadJson: {
						runEvent: {
							type: "tool.policy_blocked",
							data: { code: "DENY", message: "blocked" },
						},
					},
				} as never,
			],
		);

		expect(refs.some((ref) => ref.kind === "diff")).toBe(true);
		expect(refs.some((ref) => ref.kind === "final_report")).toBe(true);
		expect(refs.some((ref) => ref.kind === "verification")).toBe(true);
		expect(refs.some((ref) => ref.kind === "policy")).toBe(true);
	});
});
