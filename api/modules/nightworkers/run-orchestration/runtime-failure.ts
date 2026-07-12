import { isRecord } from "./utils";

export function readRuntimeFailureTerminalReason(runtimeResult: {
	testResults?: unknown;
}): string | null {
	if (!isRecord(runtimeResult.testResults)) return null;
	const codexFailure = runtimeResult.testResults.codexFailure;
	if (!isRecord(codexFailure)) return null;
	return typeof codexFailure.terminalReason === "string" &&
		codexFailure.terminalReason.trim()
		? codexFailure.terminalReason.trim()
		: null;
}
