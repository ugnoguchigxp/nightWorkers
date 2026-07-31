/**
 * Agent-neutral execution contract.
 *
 * The application lifecycle owns this port. A role module may provide an
 * adapter, but the shared contract never names either agent role.
 */
export type RunTerminalOutcome = {
	eventId: string;
	taskId: string;
	taskRevision: number;
	runId: string;
	status: string;
	sourceRef: { kind: string; id: string } | null;
	occurredAt: string;
};

const failureLikeTaskRunStatuses = new Set([
	"failed",
	"timed_out",
	"cancelled",
	"blocked",
	"needs_human",
]);

export function isFailureLikeTaskRunStatus(status: string) {
	return failureLikeTaskRunStatuses.has(status);
}

export type TaskRunExecutionPort = {
	start(input: {
		taskId: string;
		runId?: string;
		request: string;
	}): Promise<{ runId: string }>;
	stop(input: { taskId: string; runId: string }): Promise<void>;
};
