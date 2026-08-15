import type { AgentRuntimeResult } from "../../codingAgent";
import * as repo from "../nightworkers.repository";
import { updateCommitOwnershipEvidence } from "./git-ownership";

export async function recordRuntimeFinishedCheckpoint(input: {
	runId: string;
	taskId: string;
	runtimeResult: AgentRuntimeResult;
	contractWarningSummary: unknown;
	contractWarnings: unknown[];
}) {
	await repo.createRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "run.runtime_finished",
		severity: "checkpoint",
		actor: "runtime",
		message: `Runtime execution finished with terminal status: ${input.runtimeResult.terminalState}.`,
		data: {
			terminalState: input.runtimeResult.terminalState,
			stoppedBy: input.runtimeResult.stoppedBy,
			riskLevel: input.runtimeResult.riskLevel,
			contractWarningSummary: input.contractWarningSummary,
			contractWarnings: input.contractWarnings,
		},
	});
	await updateCommitOwnershipEvidence({
		runId: input.runId,
		diffPatch: input.runtimeResult.diffPatch ?? "",
		testResults: input.runtimeResult.testResults,
	});
}
