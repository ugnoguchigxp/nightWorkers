import type {
	AgentRuntimeResult,
	AgentRuntimeSink,
	AgentSafetyPolicy,
} from "../runtime/types";

type CompletionBoundaryDependencies = {
	executeVerificationCloseout: typeof import("./codex-verification-closeout.service").executeCodexVerificationCloseout;
};

const defaultDependencies: CompletionBoundaryDependencies = {
	executeVerificationCloseout: async (input) => {
		const { executeCodexVerificationCloseout } = await import(
			"./codex-verification-closeout.service"
		);
		return executeCodexVerificationCloseout(input);
	},
};

export async function reconcileCodexCompletionBoundary(
	input: {
		result: AgentRuntimeResult;
		taskId: string;
		runId: string;
		repositoryRoot: string;
		safetyPolicy?: AgentSafetyPolicy;
		sink: AgentRuntimeSink;
	},
	dependencies: CompletionBoundaryDependencies = defaultDependencies,
) {
	if (input.result.terminalState !== "completed") return input.result;
	await input.sink.emit({
		type: "verification_started",
		message:
			"[Codex] Structured verification closeout started from the active Verification Document.",
		payload: { provider: "codex", source: "verification_document" },
	});
	try {
		const verificationCloseout = await dependencies.executeVerificationCloseout(
			{
				taskId: input.taskId,
				runId: input.runId,
				repositoryRoot: input.repositoryRoot,
				safetyPolicy: input.safetyPolicy,
			},
		);
		const completionReady =
			verificationCloseout.applicability !== "active" ||
			verificationCloseout.completionCheck?.ok === true;
		const ready = completionReady;
		await input.sink.emit({
			type: "verification_finished",
			message: ready
				? "[Codex] Structured verification closeout passed."
				: "[Codex] Structured verification closeout requires review.",
			payload: {
				provider: "codex",
				verificationCloseout,
				completionReady,
			},
		});
		return {
			...input.result,
			...(ready
				? {}
				: {
						terminalState: "needs_review" as const,
						riskLevel: "high" as const,
					}),
			testResults: {
				verificationCloseout,
				completionReady,
			},
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		await input.sink.emit({
			type: "runtime_warning",
			message:
				"[Codex] Structured verification closeout failed; the run requires review.",
			payload: {
				provider: "codex",
				severity: "warning",
				code: "CODEX_VERIFICATION_CLOSEOUT_FAILED",
				error: errorMessage,
			},
		});
		return {
			...input.result,
			terminalState: "needs_review" as const,
			riskLevel: "high" as const,
			testResults: {
				status: "unknown",
				reason: "verification_closeout_failed",
				error: errorMessage,
			},
		};
	}
}
