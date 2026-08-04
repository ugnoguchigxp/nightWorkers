export const CODING_AGENT_EXECUTION_LEASE_TTL_MS = 3 * 60 * 1_000;

export const CODING_AGENT_INTERRUPTIBLE_RUN_STATUSES = [
	"running",
	"context_compiling",
	"finalizing",
] as const;

export type CodingAgentInterruptedRunCandidate = {
	runId: string;
	taskId: string;
	agentModeSessionId: string;
	interruptionRevision: number;
	executionLeaseVersion: number;
	todoId: string | null;
	todoKey: string | null;
	todoRevision: number | null;
	workspaceId: string | null;
	workspaceAllocationVersion: number | null;
	repositoryIdentityRevision: number | null;
	attestationDigest: string | null;
	routingSnapshotDigest: string;
};
