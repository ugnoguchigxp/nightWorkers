import type {
	NativeApiDispatchResult,
	NativeApiDispatchState,
} from "./native-api-dispatch-types";
import type { NativeApiToolResult } from "./native-api-tool-history";
import { capNativeApiToolResultContent } from "./native-api-tool-result-projector";

export function continueWith(
	toolResult: NativeApiToolResult,
	state: NativeApiDispatchState,
): NativeApiDispatchResult {
	return { kind: "continue", toolResult, state };
}

export function failedToolResult(
	code: string,
	message: string,
	payload?: unknown,
): NativeApiToolResult {
	return capNativeApiToolResultContent({
		ok: false,
		content: JSON.stringify({ ok: false, error: { code, message }, payload }),
		...(payload !== undefined ? { payload } : {}),
		error: { code, message },
	});
}
