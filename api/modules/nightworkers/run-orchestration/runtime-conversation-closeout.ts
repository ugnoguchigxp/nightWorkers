import type { RuntimeLaneResolution } from "../../../services/agent-runtime/runtime-lane";
import { safelyRefreshConversationContext } from "./runtime-routing";

export async function refreshConversationContextForRuntimeLane(input: {
	runtimeLaneResolution: RuntimeLaneResolution;
	taskId: string;
	runId: string;
}) {
	if (input.runtimeLaneResolution.lane === "codex-sdk") return;
	await safelyRefreshConversationContext({
		taskId: input.taskId,
		runId: input.runId,
		reason: "run_finished",
	});
}
