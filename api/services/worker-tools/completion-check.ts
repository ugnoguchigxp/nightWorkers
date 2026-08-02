import { AppError } from "../../lib/errors";
import { runCompletionCheck } from "../../modules/codingAgent";
import type { WorkerToolResult } from "./types";

export type CompletionCheckOutput = {
	llmSummary: string;
	result: Awaited<ReturnType<typeof runCompletionCheck>>;
};

export async function completionCheckTool(
	input: {
		taskId: string;
		runId: string;
		verificationDocumentId?: string;
		repoRoot?: string;
	},
	dependencies: { runCompletionCheck: typeof runCompletionCheck } = {
		runCompletionCheck,
	},
): Promise<WorkerToolResult<CompletionCheckOutput | null>> {
	const startedAt = new Date().toISOString();
	let result: Awaited<ReturnType<typeof runCompletionCheck>>;
	try {
		result = await dependencies.runCompletionCheck({
			...input,
			confirmEvidenceCheck: true,
		});
	} catch (error) {
		return completionCheckFailure(startedAt, error);
	}
	const llmSummary = result.ok
		? [
				"READY completion_check",
				`assurance=${result.assurance.status}`,
				`mapping=${result.mapping.status}`,
				`verify=${result.verify.status}`,
				`confirmation=${result.confirmation.status}`,
				"next=write_final_report",
			].join("\n")
		: [
				"NOT_READY completion_check",
				`reason=${result.reason || "unknown"}`,
				`assurance=${result.assurance.status}`,
				`mapping=${result.mapping.status} (${result.mapping.matched}/${result.mapping.total})`,
				`verify=${result.verify.status}`,
				`confirmation=${result.confirmation.status}`,
				`next=${result.suggestedAction}`,
			].join("\n");
	return {
		ok: true,
		toolName: "completion_check",
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: { llmSummary, result },
	};
}

function completionCheckFailure(
	startedAt: string,
	error: unknown,
): WorkerToolResult<null> {
	const appError = error instanceof AppError ? error : null;
	const retryable = appError?.details?.retryable === true;
	return {
		ok: false,
		toolName: "completion_check",
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: null,
		error: {
			code: appError?.code ?? "COMPLETION_CHECK_EXECUTION_FAILED",
			message: error instanceof Error ? error.message : String(error),
			retryable,
			...(retryable
				? { recoveryAction: "同じcompletion_checkを再実行してください。" }
				: {}),
		},
	};
}
