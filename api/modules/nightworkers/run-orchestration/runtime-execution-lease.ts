import {
	claimCodingAgentRunExecution,
	heartbeatCodingAgentRunExecution,
	releaseCodingAgentRunExecution,
} from "../../codingAgent";
import * as repo from "../nightworkers.repository";

export async function acquireRuntimeExecutionLease(input: {
	runId: string;
	taskId: string;
	agentModeSessionId: string | null;
}) {
	const execution = await claimCodingAgentRunExecution({
		runId: input.runId,
		agentModeSessionId: input.agentModeSessionId,
	});
	await repo
		.createRunEvent({
			version: 1,
			runId: input.runId,
			taskId: input.taskId,
			timestamp: new Date().toISOString(),
			type: "run.execution_owner_claimed",
			severity: "info",
			actor: "system",
			message: "Coding Agent runtime execution owner claimed.",
			data: {
				ownerKind: execution.ownerKind,
				ownerInstanceId: execution.ownerInstanceId,
				leaseVersion: execution.leaseVersion,
			},
		})
		.catch(() => undefined);
	return {
		heartbeat: () =>
			heartbeatCodingAgentRunExecution({
				runId: input.runId,
				leaseVersion: execution.leaseVersion,
			}),
		async release() {
			const released = await releaseCodingAgentRunExecution({
				runId: input.runId,
				leaseVersion: execution.leaseVersion,
			}).catch(() => null);
			if (!released) return;
			await repo
				.createRunEvent({
					version: 1,
					runId: input.runId,
					taskId: input.taskId,
					timestamp: new Date().toISOString(),
					type: "run.execution_owner_released",
					severity: "info",
					actor: "system",
					message: "Coding Agent runtime execution owner released.",
					data: { leaseVersion: execution.leaseVersion },
				})
				.catch(() => undefined);
		},
	};
}
