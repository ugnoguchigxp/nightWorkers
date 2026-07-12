import type {
	AgentRuntimeResult,
	AgentRuntimeSink,
	AgentSafetyPolicy,
} from "../../../services/agent-runtime/types";
import {
	type CoverageAutonomyGateResult,
	evaluateCoverageAutonomyGate,
	formatCoverageAutonomyFinalReport,
} from "../../../services/quality/coverage-autonomy-gate";
import { isRecord } from "./utils";

export async function applyCoverageAutonomyFallback(input: {
	runtimeResult: AgentRuntimeResult;
	repoRoot: string;
	safetyPolicy?: AgentSafetyPolicy;
	sink: AgentRuntimeSink;
}): Promise<AgentRuntimeResult> {
	if (readCoverageAutonomyResult(input.runtimeResult.testResults))
		return input.runtimeResult;
	if (
		!["completed", "needs_review"].includes(input.runtimeResult.terminalState)
	) {
		return input.runtimeResult;
	}

	const gate = await evaluateCoverageAutonomyGate({
		repoRoot: input.repoRoot,
		safetyPolicy: input.safetyPolicy,
	});
	await input.sink.emit({
		type: "verification_finished",
		message: `[NightWorkers] coverage autonomy fallback gate ${gate.result.status}.`,
		payload: gate.result,
	});
	if (gate.result.status === "disabled") return input.runtimeResult;

	const normalizedGate =
		gate.result.status === "continue"
			? ({
					...gate.result,
					status: "needs_human",
					shouldContinue: false,
					allowFinalize: true,
				} as CoverageAutonomyGateResult)
			: gate.result;
	const coverageReport = formatCoverageAutonomyFinalReport(normalizedGate);
	return {
		...input.runtimeResult,
		finalReport: [input.runtimeResult.finalReport, coverageReport]
			.filter(Boolean)
			.join("\n\n"),
		summary:
			normalizedGate.status === "passed"
				? input.runtimeResult.summary
				: "Coverage autonomy gate did not pass.",
		testResults: {
			...(isRecord(input.runtimeResult.testResults)
				? input.runtimeResult.testResults
				: {}),
			coverageAutonomy: normalizedGate,
		},
	};
}

function readCoverageAutonomyResult(testResults: unknown) {
	if (!isRecord(testResults)) return null;
	return isRecord(testResults.coverageAutonomy)
		? testResults.coverageAutonomy
		: null;
}

export function readRuntimeFailureTerminalReason(
	runtimeResult: AgentRuntimeResult,
): string | null {
	if (!isRecord(runtimeResult.testResults)) return null;
	const codexFailure = runtimeResult.testResults.codexFailure;
	if (!isRecord(codexFailure)) return null;
	return typeof codexFailure.terminalReason === "string" &&
		codexFailure.terminalReason.trim()
		? codexFailure.terminalReason.trim()
		: null;
}

