import { describe, expect, it } from "vitest";
import { evaluateTestCompletionGate } from "../api/modules/missionPilot/mission-pilot-post-queue-state";
import { resolvePersistedTestEvidence } from "../api/modules/missionPilot/mission-pilot-test-evidence";
import {
	completionCheckMatchesVerificationDocument,
	readLatestCompletionCheckResult,
} from "../api/services/run-events/completion-check-result";
import { missionPilotTestDecisionSchema } from "../shared/schemas/mission-pilot-test.schema";

const passingInput = {
	runStatus: "completed",
	verificationDocumentMatches: true,
	acceptedEvidenceCount: 2,
	latestFailedEvidenceCount: 0,
	unlinkedRequiredEvidenceCount: 0,
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
	it("does not require the LLM to select persisted evidence IDs", () => {
		expect(
			missionPilotTestDecisionSchema.safeParse({
				verdict: "pass",
				defectOwner: "test",
				failedConditionIds: [],
				affectedPaths: [],
				summary: "Managed checks passed.",
				implementationRework: null,
			}).success,
		).toBe(true);
	});

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
			acceptedEvidenceCount: 0,
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

	it("blocks Review while the latest persisted check is failed", () => {
		const result = evaluateTestCompletionGate({
			...passingInput,
			latestFailedEvidenceCount: 1,
		});
		expect(result.pass).toBe(false);
		expect(result.reasons).toContain("managed_evidence_failed");
	});

	it("blocks Review when required items are not linked to current evidence", () => {
		const result = evaluateTestCompletionGate({
			...passingInput,
			unlinkedRequiredEvidenceCount: 1,
		});
		expect(result.pass).toBe(false);
		expect(result.reasons).toContain("required_conditions_evidence_missing");
	});

	it("keeps historical failures while accepting persisted successes", () => {
		const selected = evidenceRow({
			id: "selected",
			exitCode: 0,
			finishedAt: new Date("2026-07-14T12:00:02.000Z"),
		});
		const historicalFailure = evidenceRow({
			id: "failed",
			exitCode: 1,
			finishedAt: new Date("2026-07-14T12:00:01.000Z"),
		});
		const incompleteArtifact = evidenceRow({
			id: "incomplete",
			rawStdoutArtifactId: null,
		});
		const result = resolvePersistedTestEvidence({
			historyRows: [historicalFailure, incompleteArtifact, selected],
		});

		expect(result.acceptedEvidence.map((item) => item.id)).toEqual([
			"selected",
		]);
		expect(result.historySummary).toEqual({
			totalCount: 3,
			acceptedCount: 1,
			historicalFailureCount: 1,
			latestFailureCount: 0,
		});
	});

	it("reports a failure that happened after an earlier success", () => {
		const result = resolvePersistedTestEvidence({
			historyRows: [
				evidenceRow({
					id: "passed-first",
					finishedAt: new Date("2026-07-14T12:00:01.000Z"),
				}),
				evidenceRow({
					id: "failed-last",
					exitCode: 1,
					finishedAt: new Date("2026-07-14T12:00:02.000Z"),
				}),
			],
		});

		expect(result.historySummary.latestFailureCount).toBe(1);
	});
});

function evidenceRow(
	overrides: Partial<{
		id: string;
		taskId: string;
		runId: string;
		verificationDocumentId: string;
		exitCode: number;
		rawStdoutArtifactId: string | null;
		rawStderrArtifactId: string | null;
		checkKind: string;
		finishedAt: Date;
	}> = {},
) {
	return {
		id: "evidence",
		taskId: "task",
		runId: "run",
		verificationDocumentId: "document",
		exitCode: 0,
		rawStdoutArtifactId: "stdout",
		rawStderrArtifactId: "stderr",
		checkKind: "verify",
		finishedAt: new Date("2026-07-14T12:00:00.000Z"),
		...overrides,
	};
}
