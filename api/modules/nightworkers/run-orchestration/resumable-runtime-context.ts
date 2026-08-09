import { AppError } from "../../../lib/errors";
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
	let carried: RuntimePromptSnapshot;
	if (input.resumeKind === "runtime_pause") {
		carried = carryRuntimePauseSnapshot(
			input.context as Record<string, unknown>,
			input.previousContext,
		) as RuntimePromptSnapshot;
	} else if (input.resumeKind === "process_interruption") {
		const pause = readProcessInterruptionSnapshot(input.previousContext);
		carried = pause
			? ({ ...input.context, runtimePause: pause } as RuntimePromptSnapshot)
			: input.context;
	} else {
		carried = input.context;
	}
	const previous = toRecord(input.previousContext);
	return {
		...carried,
		...(previous.effectiveLlmRouting !== undefined
			? { effectiveLlmRouting: previous.effectiveLlmRouting }
			: {}),
		...(typeof previous.runtimeLane === "string"
			? { runtimeLane: previous.runtimeLane }
			: {}),
		...(previous.runtimeLaneResolution !== undefined
			? { runtimeLaneResolution: previous.runtimeLaneResolution }
			: {}),
	} as RuntimePromptSnapshot;
}

export function assertResumableLlmRoutingUnchanged(input: {
	previousContext: unknown;
	currentEffectiveLlmRouting: unknown;
	currentRuntimeLane: string;
}) {
	const previousContext = toRecord(input.previousContext);
	const previousRouting = toRecord(previousContext.effectiveLlmRouting);
	if (Object.keys(previousRouting).length === 0) return;
	const currentRouting = toRecord(input.currentEffectiveLlmRouting);
	const expected = resumableRoutingIdentity({
		routing: previousRouting,
		runtimeLane:
			typeof previousContext.runtimeLane === "string"
				? previousContext.runtimeLane
				: null,
	});
	const actual = resumableRoutingIdentity({
		routing: currentRouting,
		runtimeLane: input.currentRuntimeLane,
	});
	if (!hasResumableRoutingMismatch(expected, actual)) return;
	throw new AppError(
		409,
		"RUN_LLM_ROUTING_SNAPSHOT_CONFLICT",
		"LLM routing changed after this Run started. Start a new Run to use the new role or provider settings.",
		{ expected, actual },
	);
}

function hasResumableRoutingMismatch(
	expected: ReturnType<typeof resumableRoutingIdentity>,
	actual: ReturnType<typeof resumableRoutingIdentity>,
) {
	const alwaysCompared = [
		"activeRole",
		"settingsRevision",
		"routePolicyDigest",
		"runtimeLane",
	] as const;
	if (
		alwaysCompared.some(
			(key) => expected[key] !== null && expected[key] !== actual[key],
		)
	) {
		return true;
	}
	const routeKeys = [
		"routeKey",
		"providerId",
		"providerEndpointId",
		"model",
		"thinkingDepth",
	] as const;
	return routeKeys.some((key) =>
		expected.routePolicyDigest !== null
			? expected[key] !== actual[key]
			: expected[key] !== null && expected[key] !== actual[key],
	);
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

function resumableRoutingIdentity(input: {
	routing: Record<string, unknown>;
	runtimeLane: string | null;
}) {
	const active = toRecord(input.routing.active);
	return {
		activeRole:
			typeof input.routing.activeRole === "string"
				? input.routing.activeRole
				: null,
		settingsRevision:
			typeof input.routing.settingsRevision === "string"
				? input.routing.settingsRevision
				: null,
		routePolicyDigest:
			typeof input.routing.routePolicyDigest === "string"
				? input.routing.routePolicyDigest
				: null,
		routeKey: typeof active.routeKey === "string" ? active.routeKey : null,
		providerId:
			typeof active.providerId === "string" ? active.providerId : null,
		providerEndpointId:
			typeof active.providerEndpointId === "string"
				? active.providerEndpointId
				: null,
		model: typeof active.model === "string" ? active.model : null,
		thinkingDepth:
			typeof active.thinkingDepth === "string" ? active.thinkingDepth : null,
		runtimeLane: input.runtimeLane,
	};
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
