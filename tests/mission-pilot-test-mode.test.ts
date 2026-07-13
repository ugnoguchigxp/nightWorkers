import { describe, expect, it } from "vitest";
import { evaluateTestCompletionGate } from "../api/modules/missionPilot/mission-pilot-post-queue-state";
import { resolveAcceptedTestEvidence } from "../api/modules/missionPilot/mission-pilot-test-evidence";
import {
	completionCheckMatchesVerificationDocument,
	readLatestCompletionCheckResult,
} from "../api/services/run-events/completion-check-result";
import { missionPilotTestDecisionSchema } from "../shared/schemas/mission-pilot-test.schema";

const passingInput = {
	runStatus: "completed",
	verificationDocumentMatches: true,
	acceptedEvidenceCount: 2,
	evidenceValidationReasons: [],
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
	it("accepts the deterministic hash IDs used by managed evidence rows", () => {
		const evidenceRunId = "a".repeat(64);
		expect(
			missionPilotTestDecisionSchema.safeParse({
				verdict: "pass",
				defectOwner: "test",
				failedConditionIds: [],
				evidenceRunIds: [evidenceRunId],
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

	it("keeps historical failures while accepting explicitly selected successes", () => {
		const selected = evidenceRow({ id: "selected", exitCode: 0 });
		const historicalFailure = evidenceRow({ id: "failed", exitCode: 1 });
		const result = resolveAcceptedTestEvidence({
			selectedEvidenceRunIds: [selected.id],
			taskId: selected.taskId,
			runId: selected.runId,
			verificationDocumentId: selected.verificationDocumentId,
			selectedRows: [selected],
			historyRows: [historicalFailure, selected],
		});

		expect(result.reasons).toEqual([]);
		expect(result.acceptedEvidence.map((item) => item.id)).toEqual([
			"selected",
		]);
		expect(result.historySummary).toEqual({
			totalCount: 2,
			acceptedCount: 1,
			historicalFailureCount: 1,
		});
	});

	it.each([
		["missing", [], [], "selected_evidence_missing"],
		[
			"duplicate",
			["selected", "selected"],
			[evidenceRow({ id: "selected" })],
			"selected_evidence_duplicate",
		],
		["not found", ["missing"], [], "selected_evidence_not_found"],
		[
			"wrong scope",
			["selected"],
			[evidenceRow({ id: "selected", runId: "other-run" })],
			"selected_evidence_scope_mismatch",
		],
		[
			"failed",
			["selected"],
			[evidenceRow({ id: "selected", exitCode: 1 })],
			"selected_evidence_failed",
		],
		[
			"raw artifact missing",
			["selected"],
			[evidenceRow({ id: "selected", rawStdoutArtifactId: null })],
			"selected_evidence_raw_artifact_missing",
		],
	] as const)("rejects %s selected evidence", (_name, ids, rows, reason) => {
		const result = resolveAcceptedTestEvidence({
			selectedEvidenceRunIds: [...ids],
			taskId: "task",
			runId: "run",
			verificationDocumentId: "document",
			selectedRows: [...rows],
			historyRows: [...rows],
		});
		expect(result.reasons).toContain(reason);
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
		...overrides,
	};
}
