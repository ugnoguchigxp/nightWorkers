import type { MissionPilotPostQueuePhase } from "../../../shared/schemas/mission-pilot-execution.schema";
import { missionPilotReviewDecisionPayloadSchema } from "../../../shared/schemas/mission-pilot-review.schema";

export const MISSION_PILOT_CORRECTION_LIMITS = {
	implementation: 3,
	review: 2,
	total: 5,
} as const;

const transitions: Partial<
	Record<MissionPilotPostQueuePhase, readonly MissionPilotPostQueuePhase[]>
> = {
	queued: [
		"repository_bootstrapping",
		"implementation_starting",
		"paused",
		"attention",
	],
	repository_bootstrapping: ["queued", "paused", "attention"],
	implementation_starting: ["implementing", "paused", "attention"],
	implementing: ["implementation_evaluating", "paused", "attention"],
	implementation_evaluating: ["test_preparing", "attention"],
	test_preparing: ["testing", "paused", "attention"],
	testing: ["test_evaluating", "paused", "attention"],
	test_evaluating: [
		"review_preparing",
		"test_preparing",
		"implementation_rework",
		"attention",
	],
	implementation_rework: ["implementation_starting", "paused", "attention"],
	review_preparing: ["reviewing", "paused", "attention"],
	reviewing: ["review_evaluating", "paused", "attention"],
	review_evaluating: ["closeout_preparing", "review_rework", "attention"],
	review_rework: ["implementation_starting", "paused", "attention"],
	closeout_preparing: ["committing", "completing", "attention"],
	committing: ["pushing", "completing", "attention"],
	pushing: ["completing", "attention"],
	completing: ["completed", "attention"],
	completed: ["archiving", "attention"],
	archiving: ["archived", "attention"],
	paused: [
		"implementation_starting",
		"implementing",
		"test_preparing",
		"testing",
		"review_preparing",
		"reviewing",
		"closeout_preparing",
		"committing",
		"pushing",
		"completing",
		"archiving",
		"attention",
	],
};

export function assertMissionPilotPhaseTransition(
	from: MissionPilotPostQueuePhase,
	to: MissionPilotPostQueuePhase,
) {
	if (!transitions[from]?.includes(to)) {
		throw new Error(`Invalid Mission Pilot phase transition: ${from} -> ${to}`);
	}
}

export type ImplementationGateInput = {
	runStatus: string;
	terminalReason?: string | null;
	openTodoCount: number;
	securityAllowed: boolean;
	hasOwnershipEvidence: boolean;
	hasDiffOrNoopEvidence: boolean;
	hasFinalReport: boolean;
	contextDigestMatches: boolean;
};

export function evaluateImplementationCompletionGate(
	input: ImplementationGateInput,
) {
	const reasons: string[] = [];
	if (!["completed", "needs_review"].includes(input.runStatus))
		reasons.push("run_not_accepted");
	if (input.terminalReason) reasons.push("terminal_reason_present");
	if (input.openTodoCount > 0) reasons.push("open_todos");
	if (!input.securityAllowed) reasons.push("security_gate");
	if (!input.hasOwnershipEvidence) reasons.push("ownership_missing");
	if (!input.hasDiffOrNoopEvidence) reasons.push("diff_evidence_missing");
	if (!input.hasFinalReport) reasons.push("final_report_missing");
	if (!input.contextDigestMatches) reasons.push("stale_context");
	return { pass: reasons.length === 0, reasons };
}

export type TestGateInput = {
	runStatus: string;
	verificationDocumentMatches: boolean;
	acceptedEvidenceCount: number;
	latestFailedEvidenceCount: number;
	unlinkedRequiredEvidenceCount: number;
	completionCheckEventId: string | null;
	completionCheckOk: boolean;
	requiredTotal: number;
	requiredComplete: number;
	failedRequired: number;
	unknownRequired: number;
	contextDigestMatches: boolean;
	sourceChangedAfterTest: boolean;
};

export function evaluateTestCompletionGate(input: TestGateInput) {
	const reasons: string[] = [];
	if (input.runStatus !== "completed") reasons.push("run_not_completed");
	if (!input.verificationDocumentMatches)
		reasons.push("verification_document_mismatch");
	if (input.acceptedEvidenceCount === 0)
		reasons.push("managed_evidence_missing");
	if (input.latestFailedEvidenceCount > 0)
		reasons.push("managed_evidence_failed");
	if (!input.completionCheckEventId || !input.completionCheckOk)
		reasons.push("completion_check_missing_or_failed");
	if (input.requiredTotal === 0) reasons.push("required_conditions_empty");
	if (input.requiredComplete !== input.requiredTotal)
		reasons.push("required_conditions_incomplete");
	if (input.failedRequired > 0) reasons.push("required_conditions_failed");
	if (input.unknownRequired > 0) reasons.push("required_conditions_unknown");
	if (input.unlinkedRequiredEvidenceCount > 0)
		reasons.push("required_conditions_evidence_missing");
	if (!input.contextDigestMatches) reasons.push("stale_context");
	if (input.sourceChangedAfterTest) reasons.push("source_changed_after_test");
	return { pass: reasons.length === 0, reasons };
}

export function evaluateReviewCompletionGate(input: {
	decision: unknown;
	contextDigestMatches: boolean;
	testSnapshotMatches: boolean;
	targetManifestMatches: boolean;
}) {
	const parsed = missionPilotReviewDecisionPayloadSchema.safeParse(
		input.decision,
	);
	const reasons: string[] = [];
	if (!parsed.success) reasons.push("structured_decision_invalid");
	if (parsed.success && parsed.data.verdict !== "pass")
		reasons.push(`review_${parsed.data.verdict}`);
	if (!input.contextDigestMatches) reasons.push("stale_context");
	if (!input.testSnapshotMatches) reasons.push("test_snapshot_mismatch");
	if (!input.targetManifestMatches) reasons.push("target_manifest_mismatch");
	return {
		pass: reasons.length === 0,
		reasons,
		decision: parsed.success ? parsed.data : null,
	};
}

export function evaluateCompletionAdmission(input: {
	testPass: boolean;
	reviewPass: boolean;
	closeoutStatus: string;
	pushPolicy: "never" | "allowed" | "required";
	pushStatus: string;
	hasOwnedChanges: boolean;
	commitSha: string | null;
}) {
	const reasons: string[] = [];
	if (!input.testPass) reasons.push("test_pass_missing");
	if (!input.reviewPass) reasons.push("review_pass_missing");
	if (input.hasOwnedChanges && !input.commitSha)
		reasons.push("local_commit_missing");
	if (
		!input.hasOwnedChanges &&
		!["skipped", "committed", "pushed"].includes(input.closeoutStatus)
	)
		reasons.push("noop_closeout_missing");
	if (
		input.hasOwnedChanges &&
		!["committed", "pushed"].includes(input.closeoutStatus)
	)
		reasons.push("closeout_incomplete");
	if (input.pushPolicy === "required" && input.pushStatus !== "pushed")
		reasons.push("required_push_incomplete");
	return { pass: reasons.length === 0, reasons };
}
