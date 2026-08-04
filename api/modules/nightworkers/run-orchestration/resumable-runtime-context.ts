import type { RuntimePromptSnapshot } from "../../../services/todo-context";
import {
	readProcessInterruptionSnapshot,
	renderProcessInterruptionRecoveryGuidance,
} from "../../codingAgent";
import { carryRuntimePauseSnapshot } from "./runtime-outcome-guard";
import type { StartTaskRunOptions } from "./start-task-run-types";

export function carryResumableRuntimeContext(input: {
	context: RuntimePromptSnapshot;
	previousContext: unknown;
	resumeKind: StartTaskRunOptions["resumeCommand"] extends
		| { kind: infer TKind }
		| undefined
		? TKind | undefined
		: never;
}) {
	if (input.resumeKind === "runtime_pause") {
		return carryRuntimePauseSnapshot(
			input.context as Record<string, unknown>,
			input.previousContext,
		) as RuntimePromptSnapshot;
	}
	if (input.resumeKind !== "process_interruption") return input.context;
	const pause = readProcessInterruptionSnapshot(input.previousContext);
	return pause
		? ({ ...input.context, runtimePause: pause } as RuntimePromptSnapshot)
		: input.context;
}

export function composeRuntimeStateCards(...cards: Array<string | null>) {
	return cards
		.filter((card): card is string => Boolean(card?.trim()))
		.join("\n\n");
}

export function composeResumableRuntimeStateCards(input: {
	conversationStateCard: string | null;
	todoRecoveryStateCard: string | null;
	previousContext: unknown | null;
}) {
	return composeRuntimeStateCards(
		input.conversationStateCard,
		input.todoRecoveryStateCard,
		input.previousContext
			? renderProcessInterruptionRecoveryGuidance(input.previousContext)
			: null,
	);
}
