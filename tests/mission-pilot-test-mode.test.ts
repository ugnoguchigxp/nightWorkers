import { describe, expect, it } from "vitest";
import { evaluateTestCompletionGate } from "../api/modules/missionPilot/mission-pilot-post-queue-state";
import {
	completionCheckMatchesVerificationDocument,
	readLatestCompletionCheckResult,
} from "../api/services/run-events/completion-check-result";

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
	it("uses the successful completion event after the tool-start event", () => {
		const verificationDocumentId = "verification-document";
		const completionCheck = readLatestCompletionCheckResult([
			{
				id: "completion-finished",
				seq: 39,
				payloadJson: {
					runEvent: {
						type: "tool.call_finished",
						data: {
							mcpTool: "completion_check",
							status: "completed",
							arguments: { verificationDocumentId },
							result: {
								structured_content: {
									payload: {
										result: { ok: true, verificationDocumentId },
									},
								},
							},
						},
					},
				},
			},
			{
				id: "completion-started",
				seq: 38,
				payloadJson: {
					runEvent: {
						type: "tool.call_started",
						data: {
							mcpTool: "completion_check",
							status: "in_progress",
						},
					},
				},
			},
			{
				id: "older-completion-finished",
				seq: 20,
				payloadJson: {
					runEvent: {
						type: "tool.call_finished",
						data: {
							mcpTool: "completion_check",
							status: "failed",
							result: { ok: false },
						},
					},
				},
			},
		]);

		expect(completionCheck).toEqual({
			eventId: "completion-finished",
			ok: true,
			verificationDocumentIds: [verificationDocumentId],
		});
		expect(
			completionCheckMatchesVerificationDocument(
				completionCheck,
				verificationDocumentId,
			),
		).toBe(true);
		expect(
			evaluateTestCompletionGate({
				...passingInput,
				completionCheckEventId: completionCheck?.eventId ?? null,
				completionCheckOk: completionCheck?.ok ?? false,
			}),
		).toEqual({ pass: true, reasons: [] });
	});

	it("rejects completion evidence from another verification document", () => {
		const completionCheck = readLatestCompletionCheckResult([
			{
				id: "completion-finished",
				seq: 1,
				payloadJson: {
					runEvent: {
						type: "tool.call_finished",
						data: {
							mcpTool: "completion_check",
							status: "completed",
							arguments: { verificationDocumentId: "other-document" },
							result: { ok: true },
						},
					},
				},
			},
		]);

		expect(completionCheck?.ok).toBe(true);
		expect(
			completionCheckMatchesVerificationDocument(
				completionCheck,
				"expected-document",
			),
		).toBe(false);
	});

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
