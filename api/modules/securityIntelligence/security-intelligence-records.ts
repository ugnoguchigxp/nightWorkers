export type SecurityAssessmentAttemptRecord = {
	attemptRef: string;
	requestDigest: string;
	phase: "pre_implementation" | "post_implementation";
	repositoryId: string;
	taskId: string;
	taskRevisionSnapshotId: string;
	implementationRunId?: string;
	status: "completed" | "not_applicable" | "unavailable";
	reasonCode?: string;
	retryable: boolean;
	executionContextJson?: unknown;
	scanBindingId?: string;
	assessmentReceiptId?: string;
};
