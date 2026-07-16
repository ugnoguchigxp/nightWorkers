import { estimateLlmUsage } from "../llm-usage";
import type {
	ProviderToolCall,
	ProviderToolMessage,
	ProviderToolTurnResult,
} from "./tool-calls";

type FixtureTurn = { content: string; toolCalls: ProviderToolCall[] };
const turnsByTaskId = new Map<string, FixtureTurn[]>();

export function hasFixtureProviderToolTurns(taskId: string) {
	return (
		process.env.NIGHTWORKERS_E2E_ISOLATED === "1" && turnsByTaskId.has(taskId)
	);
}

export function registerFixtureProviderToolTurns(
	taskId: string,
	turns: FixtureTurn[],
) {
	if (
		process.env.NODE_ENV === "production" ||
		process.env.NIGHTWORKERS_E2E_ISOLATED !== "1"
	) {
		throw new Error("Fixture tool turns are available only in isolated E2E.");
	}
	turnsByTaskId.set(taskId, structuredClone(turns));
}

export function callFixtureProviderToolTurn(input: {
	taskId: string;
	systemPrompt: string;
	userPrompt: string;
	messages: ProviderToolMessage[];
	setProviderDebug: (value: Record<string, unknown>) => void;
}): ProviderToolTurnResult {
	if (
		process.env.NODE_ENV === "production" ||
		process.env.NIGHTWORKERS_E2E_ISOLATED !== "1"
	) {
		throw new Error("Fixture tool provider is available only in isolated E2E.");
	}
	const turns = turnsByTaskId.get(input.taskId) ?? [];
	const turn = turns.shift() ?? {
		content: "Fixture provider has no remaining scripted turn.",
		toolCalls: [],
	};
	turnsByTaskId.set(input.taskId, turns);
	const providerDebug = {
		provider: "fixture",
		mode: "provider_native_tools",
		remainingTurns: turns.length,
		toolCallCount: turn.toolCalls.length,
	};
	input.setProviderDebug(providerDebug);
	return {
		type: "supported",
		content: turn.content,
		toolCalls: turn.toolCalls,
		usage: estimateLlmUsage({
			systemPrompt: input.systemPrompt,
			userPrompt: input.userPrompt,
			responseText: turn.content,
		}),
		model: "fixture-native-tools",
		providerDebug,
	};
}
