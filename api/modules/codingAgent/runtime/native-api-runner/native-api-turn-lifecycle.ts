import type { AgentRuntimeSink } from "../types";
import type { NativeApiSessionStore } from "./native-api-session-store";

export function createNativeApiTurnFinisher(input: {
	store: NativeApiSessionStore;
	sink: AgentRuntimeSink;
	turnId: string;
	turnIndex: number;
	executionMode: string;
}) {
	return async (
		finishInput: Parameters<NativeApiSessionStore["finishTurn"]>[0],
	) => {
		await input.store.finishTurn(finishInput);
		await input.sink.emit({
			type: "turn_finished",
			message: `[NativeApiRunner] provider-native turn ${input.turnIndex} ${finishInput.status}.`,
			payload: {
				runtime: "native_api_runner",
				executionMode: input.executionMode,
				turnId: input.turnId,
				turnIndex: input.turnIndex,
				status: finishInput.status,
			},
		});
	};
}
