import {
	callStructuredLlmResult,
	type StructuredLlmAttemptValidation,
	type StructuredLlmIssue,
	type StructuredLlmResult,
	type StructuredLlmResultOptions,
	validateStructuredLlmFacts,
} from "../structured-llm";
import { StructuredLlmResponseError } from "../structured-llm/contract";
import { buildStructuredOutputRepairPrompt } from "./prompts/structured-output-repair";

export const STRUCTURED_OUTPUT_REPAIR_MAX_ATTEMPTS = 2;

export async function callStructuredOutputWithRepair<T>(input: {
	systemPrompt: string;
	userPrompt: string;
	options: StructuredLlmResultOptions<T>;
	validateFacts?: (value: T) => StructuredLlmIssue[];
	onInitialResult?: (result: StructuredLlmResult<T>) => Promise<void> | void;
	beforeRepair?: (
		result: Extract<StructuredLlmResult<T>, { ok: false }>,
	) => Promise<void> | void;
	onRepairResult?: (result: StructuredLlmResult<T>) => Promise<void> | void;
}) {
	const response = await callStructuredLlmResult(
		input.systemPrompt,
		input.userPrompt,
		input.options,
	);
	const initialResult = input.validateFacts
		? validateStructuredLlmFacts(response, input.validateFacts)
		: response;
	await input.onInitialResult?.(initialResult);
	return repairStructuredOutputOnce({
		initialResult,
		options: input.options,
		validateFacts: input.validateFacts,
		beforeRepair: input.beforeRepair,
		onRepairResult: input.onRepairResult,
	});
}

export async function repairStructuredOutputOnce<T>(input: {
	initialResult: StructuredLlmResult<T>;
	options: StructuredLlmResultOptions<T>;
	validateFacts?: (value: T) => StructuredLlmIssue[];
	beforeRepair?: (
		result: Extract<StructuredLlmResult<T>, { ok: false }>,
	) => Promise<void> | void;
	onRepairResult?: (result: StructuredLlmResult<T>) => Promise<void> | void;
}): Promise<{
	value: T;
	attempts: StructuredLlmResult<T>["attempt"][];
	validationByAttempt: StructuredLlmAttemptValidation[];
}> {
	if (input.initialResult.ok) {
		return {
			value: input.initialResult.value,
			attempts: [input.initialResult.attempt],
			validationByAttempt: [
				{ attempt: input.initialResult.attempt.attempt, issues: [] },
			],
		};
	}
	if (
		input.initialResult.attempt.attempt >= STRUCTURED_OUTPUT_REPAIR_MAX_ATTEMPTS
	) {
		throw new StructuredLlmResponseError({
			rawText: input.initialResult.attempt.rawText,
			issues: input.initialResult.issues,
			attempts: [input.initialResult.attempt],
			validationByAttempt: [
				{
					attempt: input.initialResult.attempt.attempt,
					issues: input.initialResult.issues,
				},
			],
		});
	}
	await input.beforeRepair?.(input.initialResult);

	const prompt = buildStructuredOutputRepairPrompt({
		contract: input.options.contract,
		rawText: input.initialResult.attempt.rawText,
		issues: input.initialResult.issues,
		systemContextBinding: input.options.systemContextBinding,
	});
	const repairedResponse = await callStructuredLlmResult(
		prompt.systemPrompt,
		prompt.userPrompt,
		{
			...input.options,
			attempt: input.initialResult.attempt.attempt + 1,
			systemContextAudit: prompt.systemContextAudit,
		},
	);
	const repaired = input.validateFacts
		? validateStructuredLlmFacts(repairedResponse, input.validateFacts)
		: repairedResponse;
	await input.onRepairResult?.(repaired);
	if (repaired.ok) {
		return {
			value: repaired.value,
			attempts: [input.initialResult.attempt, repaired.attempt],
			validationByAttempt: [
				{
					attempt: input.initialResult.attempt.attempt,
					issues: input.initialResult.issues,
				},
				{ attempt: repaired.attempt.attempt, issues: [] },
			],
		};
	}

	throw new StructuredLlmResponseError({
		rawText: repaired.attempt.rawText,
		issues: repaired.issues,
		attempts: [input.initialResult.attempt, repaired.attempt],
		validationByAttempt: [
			{
				attempt: input.initialResult.attempt.attempt,
				issues: input.initialResult.issues,
			},
			{ attempt: repaired.attempt.attempt, issues: repaired.issues },
		],
	});
}
