import { describe, expect, it } from "vitest";
import { evaluateTestCompletionGate } from "../api/modules/missionPilot/mission-pilot-post-queue-state";

const passingInput = {
	runStatus: "completed",
	verificationDocumentMatches: true,
	managedEvidenceCount: 2,
	failedManagedEvidenceCount: 0,
	rawArtifactsComplete: true,
	completionCheckEventId: "event-1",
	completionCheckOk: true,
	requiredTotal: 3,
	requiredComplete: 3,
	failedRequired: 0,
	unknownRequired: 0,
	contextDigestMatches: true,
	sourceChangedAfterTest: false,
};

describe("Mission Pilot Test completion gate", () => {
	it("passes only managed evidence plus completion_check", () => {
		expect(evaluateTestCompletionGate(passingInput)).toEqual({
			pass: true,
			reasons: [],
		});
	});

	it("does not promote raw command execution to formal pass", () => {
		const result = evaluateTestCompletionGate({
			...passingInput,
			managedEvidenceCount: 0,
			completionCheckEventId: null,
		});
		expect(result.pass).toBe(false);
		expect(result.reasons).toContain("managed_evidence_missing");
		expect(result.reasons).toContain("completion_check_missing_or_failed");
	});

	it("blocks Review while required evidence is failed or unknown", () => {
		const result = evaluateTestCompletionGate({
			...passingInput,
			requiredComplete: 1,
			failedRequired: 1,
			unknownRequired: 1,
		});
		expect(result.pass).toBe(false);
		expect(result.reasons).toEqual(
			expect.arrayContaining([
				"required_conditions_incomplete",
				"required_conditions_failed",
				"required_conditions_unknown",
			]),
		);
	});
});
