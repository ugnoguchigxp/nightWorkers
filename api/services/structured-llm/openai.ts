import { toDeepRecord } from "../../../shared/json-record";
import { logger } from "../../lib/logger";
import { buildResponseJsonSchema as buildSchemaFirstResponseJsonSchema } from "../supervisor/schema-first";
import {
	createSupervisorResponseDeltaEmitter,
	rejectProviderActivity,
} from "./events";
import {
	MAX_PROVIDER_RESPONSE_BYTES,
	providerInvalidResponseError,
	providerResponseTooLargeError,
} from "./provider-failure";
import type {
	CallSupervisorOptions,
	NormalizedSupervisorLlmRequest,
} from "./types";

export function buildOpenAIChatCompletionBody(input: {
	model: string;
	systemPrompt: string;
	userPrompt: string;
	round?: 1 | 2;
	schemaFirst?: boolean;
	jsonSchema?: { name: string; schema: unknown };
	responseFormat: "json_schema" | "json_object";
	stream: boolean;
	reasoningEffort?: "low" | "medium" | "high";
}) {
	const jsonSchema =
		input.jsonSchema ||
		buildSchemaFirstResponseJsonSchema(input.round === 1 ? 1 : 2);
	return {
		model: input.model,
		messages: [
			{ role: "system", content: input.systemPrompt },
			{ role: "user", content: input.userPrompt },
		],
		stream: input.stream,
		...(input.stream ? { stream_options: { include_usage: true } } : {}),
		...(input.reasoningEffort
			? { reasoning_effort: input.reasoningEffort }
			: {}),
		response_format:
			input.responseFormat === "json_schema"
				? {
						type: "json_schema",
						json_schema: jsonSchema,
					}
				: { type: "json_object" },
	};
}

export async function readOpenAIChatCompletionStream(input: {
	response: Response;
	options: CallSupervisorOptions;
	normalizedRequest?: NormalizedSupervisorLlmRequest;
	provider: string;
	round?: 1 | 2;
}): Promise<{ content: string; usage: unknown | null }> {
	if (!input.response.body) {
		throw new Error(
			"OpenAI streaming response did not include a readable body.",
		);
	}

	const decoder = new TextDecoder();
	const reader = input.response.body.getReader();
	const deltaEmitter = createSupervisorResponseDeltaEmitter({
		options: input.options,
		provider: input.provider,
		round: input.round,
	});
	let buffer = "";
	let content = "";
	let usage: unknown | null = null;
	let responseBytes = 0;

	const processStreamRecord = async (record: string) => {
		const dataLines = record
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"));
		if (dataLines.length === 0) return;
		const payload = dataLines
			.map((line) => line.slice("data:".length).replace(/^ /, ""))
			.join("\n");
		if (!payload || payload === "[DONE]") return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(payload);
		} catch (cause) {
			logger.warn(
				{ payloadPreview: payload.slice(0, 200) },
				"OpenAI stream chunk parse failed",
			);
			throw providerInvalidResponseError({
				provider: input.provider,
				body: payload,
				cause,
			});
		}
		const parsedRecord = toDeepRecord(parsed);
		if (parsedRecord.usage) usage = parsedRecord.usage;
		const firstChoice = Array.isArray(parsedRecord.choices)
			? toDeepRecord(parsedRecord.choices[0])
			: toDeepRecord(null);
		const deltaRecord = toDeepRecord(firstChoice.delta);
		const toolCalls = deltaRecord.tool_calls;
		if (toolCalls && input.normalizedRequest) {
			const firstToolCall = Array.isArray(toolCalls)
				? toDeepRecord(toolCalls[0])
				: toDeepRecord(null);
			const toolFunction = toDeepRecord(firstToolCall.function);
			const toolName =
				typeof (toolFunction.name as unknown) === "string"
					? String(toolFunction.name)
					: null;
			await rejectProviderActivity({
				options: input.options,
				request: input.normalizedRequest,
				activityType: "tool_call",
				toolName,
				preview: JSON.stringify(toolCalls),
			});
		}
		const delta = deltaRecord.content;
		if (typeof delta === "string" && delta) {
			content += delta;
			await deltaEmitter.push(delta);
		}
	};

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		responseBytes += value.byteLength;
		if (responseBytes > MAX_PROVIDER_RESPONSE_BYTES) {
			await reader.cancel().catch(() => undefined);
			throw providerResponseTooLargeError();
		}
		buffer += decoder.decode(value, { stream: true });

		const records = buffer.split(/\r?\n\r?\n/);
		buffer = records.pop() ?? "";
		for (const record of records) {
			await processStreamRecord(record);
		}
	}

	buffer += decoder.decode();
	if (buffer.trim()) await processStreamRecord(buffer);
	await deltaEmitter.flush();
	return { content, usage };
}
