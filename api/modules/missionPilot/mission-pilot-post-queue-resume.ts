export function resolvePostQueueResumePhase(input: {
	activeTestSnapshotId: string | null;
	activePhaseRunId: string | null;
	resumePhase: string;
}) {
	if (input.activeTestSnapshotId) return "review_preparing" as const;
	if (input.activePhaseRunId) return "attention" as const;
	return input.resumePhase;
}
