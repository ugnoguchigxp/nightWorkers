export function resolvePostQueueResumePhase(input: {
	activeVerificationSnapshotId: string | null;
	activePhaseRunId: string | null;
	resumePhase: string;
}) {
	if (input.activeVerificationSnapshotId) return "review_preparing" as const;
	if (input.activePhaseRunId) return "attention" as const;
	return input.resumePhase;
}
