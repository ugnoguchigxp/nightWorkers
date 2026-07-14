import { z } from "zod";
import type { JsonFixWrapperResult } from "./json";
import { normalizeStructuredOutputJsonSchema } from "./json-schema";
import type { CallSupervisorOptions } from "./types";

export type StructuredOutputContract<T> = {
	name: string;
	runtimeSchema: z.ZodType<T>;
	providerJsonSchema: unknown;
	renderOutputRequirements: () => string;
};

export type StructuredLlmIssue = {
	stage: "parse" | "schema" | "fact";
	path: Array<string | number>;
	code: string;
	message: string;
};

export type StructuredLlmAttempt = {
	attempt: number;
	rawText: string;
	extractedText: string | null;
	repairedText: string | null;
	repairKind: JsonFixWrapperResult["repairKind"] | null;
};

export function structuredLlmAttemptValueText(
	attempt: StructuredLlmAttempt,
): string {
	return attempt.repairedText ?? attempt.extractedText ?? attempt.rawText;
}

export type StructuredLlmAttemptValidation = {
	attempt: number;
	issues: StructuredLlmIssue[];
};

export type StructuredLlmResult<T> =
	| {
			ok: true;
			value: T;
			attempt: StructuredLlmAttempt;
			issues: [];
	  }
	| {
			ok: false;
			value: null;
			attempt: StructuredLlmAttempt;
			issues: StructuredLlmIssue[];
	  };

export type StructuredLlmResultOptions<T> = Omit<
	CallSupervisorOptions,
	"schemaFirst" | "round"
> & {
	contract: StructuredOutputContract<T>;
	attempt?: number;
};

export class StructuredLlmResponseError extends Error {
	readonly rawText: string;
	readonly issues: StructuredLlmIssue[];
	readonly attempts: StructuredLlmAttempt[];
	readonly validationByAttempt: StructuredLlmAttemptValidation[];

	constructor(input: {
		rawText: string;
		issues: StructuredLlmIssue[];
		attempts: StructuredLlmAttempt[];
		validationByAttempt?: StructuredLlmAttemptValidation[];
	}) {
		// A non-empty model response remains the user-facing error text. The issue
		// list is diagnostic metadata, not replacement prose.
		super(input.rawText.trim() || "LLM response was empty.");
		this.name = "StructuredLlmResponseError";
		this.rawText = input.rawText;
		this.issues = input.issues;
		this.attempts = input.attempts;
		this.validationByAttempt = input.validationByAttempt ?? [];
	}
}

export function createStructuredOutputContract<T>(input: {
	name: string;
	runtimeSchema: z.ZodType<T>;
	providerJsonSchema?: unknown;
	renderOutputRequirements?: (providerJsonSchema: unknown) => string;
}): StructuredOutputContract<T> {
	const providerJsonSchema = normalizeStructuredOutputJsonSchema(
		input.providerJsonSchema ?? z.toJSONSchema(input.runtimeSchema),
	);
	return {
		name: input.name,
		runtimeSchema: input.runtimeSchema,
		providerJsonSchema,
		renderOutputRequirements: () =>
			input.renderOutputRequirements?.(providerJsonSchema) ??
			renderStructuredOutputRequirements(providerJsonSchema),
	};
}

export function renderStructuredOutputRequirements(jsonSchema: unknown) {
	return [
		"JSON object だけを返してください。markdown、説明文、コードフェンスは不要です。",
		"次の JSON Schema に従ってください。",
		JSON.stringify(jsonSchema, null, 2),
	].join("\n");
}

export function zodIssuesToStructuredLlmIssues(
	issues: z.core.$ZodIssue[],
): StructuredLlmIssue[] {
	return issues.map((issue) => ({
		stage: "schema",
		path: issue.path.map((part) =>
			typeof part === "symbol" ? String(part) : part,
		),
		code: issue.code,
		message: issue.message,
	}));
}

export function validateStructuredLlmFacts<T>(
	result: StructuredLlmResult<T>,
	validate: (value: T) => StructuredLlmIssue[],
): StructuredLlmResult<T> {
	if (!result.ok) return result;
	const issues = validate(result.value);
	return issues.length === 0
		? result
		: { ok: false, value: null, attempt: result.attempt, issues };
}
