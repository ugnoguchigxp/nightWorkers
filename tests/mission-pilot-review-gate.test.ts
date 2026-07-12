import { describe, expect, it } from "vitest";
import { evaluateReviewCompletionGate } from "../api/modules/missionPilot/mission-pilot-post-queue-state";

describe("Mission Pilot Review completion gate", () => {
	it("accepts a structured pass with no blocking findings", () => {
		const result = evaluateReviewCompletionGate({
			decision: { verdict: "pass", summary: "確認済み", findings: [] },
			contextDigestMatches: true,
			testSnapshotMatches: true,
			targetManifestMatches: true,
		});
		expect(result.pass).toBe(true);
	});

	it("rejects artifact done semantics without a structured verdict", () => {
		const result = evaluateReviewCompletionGate({
			decision: { status: "done" },
			contextDigestMatches: true,
			testSnapshotMatches: true,
			targetManifestMatches: true,
		});
		expect(result).toMatchObject({
			pass: false,
			reasons: ["structured_decision_invalid"],
		});
	});

	it("rejects pass with a blocking finding", () => {
		const result = evaluateReviewCompletionGate({
			decision: {
				verdict: "pass",
				summary: "問題あり",
				findings: [
					{
						severity: "blocking",
						category: "correctness",
						file: "src/a.ts",
						line: 1,
						evidence: "壊れる",
						recommendedAction: "修正する",
						blockingReason: "acceptance failure",
					},
				],
			},
			contextDigestMatches: true,
			testSnapshotMatches: true,
			targetManifestMatches: true,
		});
		expect(result.pass).toBe(false);
	});
});
