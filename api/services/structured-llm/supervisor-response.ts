import { z } from "zod";
import { appendSupervisorTrace } from "../../lib/logger";
import {
	type AgentToolCallEnvelope,
	type JobTypeSelection,
	parseSupervisorOutput,
} from "../supervisor/schema-first";
import {
	StructuredLlmResponseError,
	zodIssuesToStructuredLlmIssues,
} from "./contract";
import { emitSupervisorLlmDebugEvent } from "./events";
import { jsonFixWrapper } from "./json";
import type { CallSupervisorOptions } from "./types";

export async function parseSupervisorLlmResponse(
	rawContent: string,
	options: CallSupervisorOptions & { schemaFirst: true; round: 1 | 2 },
): Promise<JobTypeSelection | AgentToolCallEnvelope> {
	const parsedJson = await parseSupervisorJsonContent(
		rawContent,
		options,
		"Supervisor LLM",
	);
	try {
		return parseSupervisorOutput(parsedJson.parsedJson, options.round);
	} catch (error) {
		await emitSupervisorLlmDebugEvent(options, {
			type: "model.response_parse_failed",
			severity: "error",
			message: "Schema-first LLM response failed schema validation.",
			data: {
				round: options.round,
				errorMessage: error instanceof Error ? error.message : String(error),
				rawContentPreview: rawContent.slice(0, 500),
			},
		});
		const issues =
			error instanceof z.ZodError
				? zodIssuesToStructuredLlmIssues(error.issues)
				: [
						{
							stage: "schema" as const,
							path: [],
							code: "invalid_supervisor_response",
							message: error instanceof Error ? error.message : String(error),
						},
					];
		throw new StructuredLlmResponseError({
			rawText: rawContent,
			issues,
			attempts: [
				{
					attempt: 1,
					rawText: rawContent,
					extractedText: parsedJson.candidateText,
					repairedText:
						parsedJson.sourceText !== parsedJson.candidateText
							? parsedJson.sourceText
							: null,
					repairKind: parsedJson.repairKind,
				},
			],
			validationByAttempt: [{ attempt: 1, issues }],
		});
	}
}

async function parseSupervisorJsonContent(
	rawContent: string,
	options: CallSupervisorOptions,
	label: string,
) {
	const jsonFix = jsonFixWrapper(rawContent);
	if (!jsonFix) {
		await emitSupervisorLlmDebugEvent(options, {
			type: "model.response_parse_failed",
			severity: "error",
			message: `${label} JSON parse failed and automatic repair did not produce JSON.`,
			data: {
				round: options.round ?? null,
				rawContentPreview: rawContent.slice(0, 500),
			},
		});
		appendSupervisorTrace("json_parse_failed", {
			round: options.round,
			errorMessage:
				"JSON parse failed and automatic repair did not produce JSON",
			rawContentPreview: rawContent.slice(0, 1000),
		});
		const issues = [
			{
				stage: "parse" as const,
				path: [],
				code: "invalid_json",
				message: `${label} response JSON parse failed.`,
			},
		];
		throw new StructuredLlmResponseError({
			rawText: rawContent,
			issues,
			attempts: [
				{
					attempt: 1,
					rawText: rawContent,
					extractedText: null,
					repairedText: null,
					repairKind: null,
				},
			],
			validationByAttempt: [{ attempt: 1, issues }],
		});
	}
	if (jsonFix.repaired) {
		await emitSupervisorLlmDebugEvent(options, {
			type: "model.response_repaired",
			severity: "warning",
			message: `${label} response JSON was repaired before schema validation.`,
			data: {
				round: options.round ?? null,
				repairKind: jsonFix.repairKind,
				rawContentLength: rawContent.length,
				repairedContentLength: jsonFix.sourceText.length,
			},
		});
	}
	return jsonFix;
}
