import { estimateLlmUsage } from "../llm-usage";
import type {
	ProviderToolCall,
	ProviderToolMessage,
	ProviderToolTurnResult,
} from "./tool-calls";

type FixturePlaceholder = {
	$fixture: "taskRevision" | "latestRunId";
};
type FixtureTurn = {
	content: string;
	toolCalls: ProviderToolCall[];
	condition?: "previous_tool_failed";
};
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
	let turn = turns.shift() ?? {
		content: "Fixture provider has no remaining scripted turn.",
		toolCalls: [],
	};
	if (
		turn.condition === "previous_tool_failed" &&
		!hasPreviousToolFailure(input.messages)
	)
		turn = turns.shift() ?? {
			content: "Fixture provider has no remaining scripted turn.",
			toolCalls: [],
		};
	turnsByTaskId.set(input.taskId, turns);
	const toolCalls = turn.toolCalls.map((call) => ({
		...call,
		arguments: resolveFixtureArguments(
			call.arguments,
			input.messages,
			extractCurrentTaskRevision(input.systemPrompt),
		),
	}));
	const providerDebug = {
		provider: "fixture",
		mode: "provider_native_tools",
		remainingTurns: turns.length,
		toolCallCount: toolCalls.length,
	};
	input.setProviderDebug(providerDebug);
	return {
		type: "supported",
		content: turn.content,
		toolCalls,
		usage: estimateLlmUsage({
			systemPrompt: input.systemPrompt,
			userPrompt: input.userPrompt,
			responseText: turn.content,
		}),
		model: "fixture-native-tools",
		providerDebug,
	};
}

function hasPreviousToolFailure(messages: ProviderToolMessage[]) {
	return messages.some((message) => {
		if (message.role !== "tool" || typeof message.content !== "string")
			return false;
		try {
			const body = message.content
				? (JSON.parse(message.content) as Record<string, unknown>)
				: {};
			return body.ok === false || Boolean(body.failure);
		} catch {
			return false;
		}
	});
}

function resolveFixtureArguments(
	value: Record<string, unknown>,
	messages: ProviderToolMessage[],
	currentTaskRevision: number | null,
): Record<string, unknown> {
	return resolveFixtureValue(value, messages, currentTaskRevision) as Record<
		string,
		unknown
	>;
}

function resolveFixtureValue(
	value: unknown,
	messages: ProviderToolMessage[],
	currentTaskRevision: number | null,
): unknown {
	if (isFixturePlaceholder(value)) {
		if (value.$fixture === "taskRevision" && currentTaskRevision !== null)
			return currentTaskRevision;
		const facts = messages
			.slice()
			.reverse()
			.flatMap((message) => {
				if (message.role !== "tool" || typeof message.content !== "string")
					return [];
				try {
					return [JSON.parse(message.content) as unknown];
				} catch {
					return [];
				}
			});
		const resolved =
			value.$fixture === "taskRevision"
				? latestTaskRevision(facts)
				: latestRunId(facts);
		if (resolved === null)
			throw new Error(`Fixture value ${value.$fixture} was not observed yet.`);
		return resolved;
	}
	if (Array.isArray(value))
		return value.map((item) =>
			resolveFixtureValue(item, messages, currentTaskRevision),
		);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				resolveFixtureValue(item, messages, currentTaskRevision),
			]),
		);
	return value;
}

function isFixturePlaceholder(value: unknown): value is FixturePlaceholder {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return false;
	const fixture = (value as Record<string, unknown>).$fixture;
	return fixture === "taskRevision" || fixture === "latestRunId";
}

function extractCurrentTaskRevision(systemPrompt: string) {
	const marker = "[Mission Pilot 現在のStep文脈]\n";
	const markerIndex = systemPrompt.lastIndexOf(marker);
	if (markerIndex < 0) return null;
	try {
		const context = JSON.parse(
			systemPrompt.slice(markerIndex + marker.length),
		) as Record<string, unknown>;
		const taskRef = asRecord(context.taskRef);
		return typeof taskRef.revision === "number" &&
			Number.isInteger(taskRef.revision)
			? taskRef.revision
			: null;
	} catch {
		return null;
	}
}

function latestTaskRevision(facts: unknown[]) {
	for (const fact of facts) {
		const taskRevision = findTaskRevision(fact);
		if (taskRevision !== null) return taskRevision;
	}
	return null;
}

function latestRunId(facts: unknown[]) {
	for (const fact of facts) {
		const runId = findRunId(fact);
		if (runId !== null) return runId;
	}
	return null;
}

function findTaskRevision(value: unknown): number | null {
	const record = asRecord(value);
	const taskRevision = findNumber(record.task, "revision");
	if (taskRevision !== null) return taskRevision;
	for (const child of Object.values(record)) {
		const nested = findTaskRevision(child);
		if (nested !== null) return nested;
	}
	if (Array.isArray(value)) {
		for (const child of value) {
			const nested = findTaskRevision(child);
			if (nested !== null) return nested;
		}
	}
	return null;
}

function findRunId(value: unknown): string | null {
	const record = asRecord(value);
	const activeRun = asRecord(record.activeRun);
	if (typeof activeRun.id === "string") return activeRun.id;
	if (Array.isArray(record.terminalRuns)) {
		const terminalRun = record.terminalRuns.find(
			(run) => typeof asRecord(run).id === "string",
		);
		if (terminalRun) return asRecord(terminalRun).id as string;
	}
	const runStatuses = new Set([
		"queued",
		"running",
		"context_compiling",
		"finalizing",
		"completed",
		"failed",
		"cancelled",
		"needs_review",
		"blocked",
		"timed_out",
		"needs_human",
	]);
	if (
		typeof record.id === "string" &&
		typeof record.status === "string" &&
		runStatuses.has(record.status)
	)
		return record.id;
	for (const child of Object.values(record)) {
		const nested = findRunId(child);
		if (nested !== null) return nested;
	}
	if (Array.isArray(value)) {
		for (const child of value) {
			const nested = findRunId(child);
			if (nested !== null) return nested;
		}
	}
	return null;
}

function findNumber(value: unknown, key: string) {
	const record = asRecord(value);
	const candidate = record[key];
	return typeof candidate === "number" && Number.isInteger(candidate)
		? candidate
		: null;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
