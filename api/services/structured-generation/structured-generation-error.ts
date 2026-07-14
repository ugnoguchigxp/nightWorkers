import { AppError } from "../../lib/errors";
import { StructuredLlmResponseError } from "../structured-llm";

export function createStructuredGenerationAppError(input: {
	code: string;
	fallbackMessage: string;
	error: unknown;
	lastRawText?: string | null;
}): AppError {
	const rawText = resolveRawLlmText(input.error, input.lastRawText);
	if (rawText !== null) {
		const details: Record<string, unknown> = {
			responseTextOrigin: "llm",
			diagnostic: describeStructuredGenerationError(
				input.error,
				input.fallbackMessage,
			),
		};
		if (input.error instanceof StructuredLlmResponseError) {
			details.issues = input.error.issues;
			details.attempts = input.error.attempts;
			details.validationByAttempt = input.error.validationByAttempt;
		}
		return new AppError(502, input.code, rawText, details);
	}

	if (input.error instanceof AppError) return input.error;
	return new AppError(
		502,
		input.code,
		describeStructuredGenerationError(input.error, input.fallbackMessage),
		{ responseTextOrigin: "application" },
	);
}

function resolveRawLlmText(
	error: unknown,
	lastRawText?: string | null,
): string | null {
	if (
		error instanceof StructuredLlmResponseError &&
		error.rawText.trim().length > 0
	) {
		return error.rawText;
	}
	return lastRawText && lastRawText.trim().length > 0 ? lastRawText : null;
}

function describeStructuredGenerationError(
	error: unknown,
	fallbackMessage: string,
): string {
	if (error instanceof StructuredLlmResponseError) {
		const issueSummary = error.issues
			.map((issue) => {
				const path = issue.path.length > 0 ? ` (${issue.path.join(".")})` : "";
				return `${issue.stage}${path}: ${issue.message}`;
			})
			.join("; ");
		return issueSummary || fallbackMessage;
	}
	return error instanceof Error ? error.message : fallbackMessage;
}
