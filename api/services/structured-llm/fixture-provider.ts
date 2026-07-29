import { estimateLlmUsage } from "../llm-usage";
import { readSchemaFirstFixtureOutput } from "./fixture";
import {
	hasFixtureProviderTextOutputs,
	takeFixtureProviderTextOutput,
} from "./fixture-text-provider";
import type { RawLlmCallOptions } from "./providers";
import type { ProviderCallResult } from "./types";

export type FixtureProviderInput = {
	provider: string;
	systemPrompt: string;
	userPrompt: string;
	options: RawLlmCallOptions;
	setProviderDebug: (value: Record<string, unknown>) => void;
};

export function callFixtureProvider(
	input: FixtureProviderInput,
): ProviderCallResult {
	if (process.env.NODE_ENV === "production") {
		throw new Error("Fixture/test provider is not available in production.");
	}
	const providerDebug = {
		provider: input.provider,
		round: input.options.round ?? null,
	};
	input.setProviderDebug(providerDebug);
	const taskId = input.options.taskId;
	if (taskId && hasFixtureProviderTextOutputs(taskId)) {
		return buildFixtureProviderResult(
			takeFixtureProviderTextOutput(taskId),
			input,
			providerDebug,
		);
	}
	if (input.options.schemaFirst) {
		return buildFixtureProviderResult(
			readSchemaFirstFixtureOutput(input.options.round),
			input,
			providerDebug,
		);
	}

	const output = process.env.SUPERVISOR_FIXTURE_OUTPUT;
	if (!output?.trim()) {
		throw new Error(
			"Fixture provider requires SUPERVISOR_FIXTURE_OUTPUT to be set.",
		);
	}
	return buildFixtureProviderResult(output, input, providerDebug);
}

function buildFixtureProviderResult(
	content: string,
	input: FixtureProviderInput,
	providerDebug: Record<string, unknown>,
): ProviderCallResult {
	return {
		content,
		usage: estimateLlmUsage({
			systemPrompt: input.systemPrompt,
			userPrompt: input.userPrompt,
			responseText: content,
		}),
		model: null,
		providerDebug,
	};
}
