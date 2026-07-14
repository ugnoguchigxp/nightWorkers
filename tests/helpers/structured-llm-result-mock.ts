import { isDeepStrictEqual } from "node:util";
import type { StructuredLlmResultOptions } from "../../api/services/structured-llm/contract";

type LegacyStructuredLlmMock = (
	systemPrompt: string,
	userPrompt: string,
	options: Record<string, unknown>,
) => Promise<string>;

export function createStructuredLlmResultMock(
	callLegacy: LegacyStructuredLlmMock,
) {
	return async <T>(
		systemPrompt: string,
		userPrompt: string,
		options: StructuredLlmResultOptions<T>,
	) => {
		const rawText = await callLegacy(systemPrompt, userPrompt, {
			...options,
			schemaName: options.contract.name,
			schema: options.contract.providerJsonSchema,
		});
		const attempt = {
			attempt: options.attempt ?? 1,
			rawText,
			extractedText: rawText,
			repairedText: null,
			repairKind: null,
		};

		let value: unknown;
		try {
			value = JSON.parse(rawText);
		} catch {
			return {
				ok: false as const,
				value: null,
				attempt: { ...attempt, extractedText: null },
				issues: [
					{
						stage: "parse" as const,
						path: [],
						code: "invalid_json",
						message: "fixture output is not JSON",
					},
				],
			};
		}

		const parsed = options.contract.runtimeSchema.safeParse(value);
		if (!parsed.success) {
			return {
				ok: false as const,
				value: null,
				attempt,
				issues: parsed.error.issues.map((issue) => ({
					stage: "schema" as const,
					path: issue.path.map((part) =>
						typeof part === "symbol" ? String(part) : part,
					),
					code: issue.code,
					message: issue.message,
				})),
			};
		}
		if (!isDeepStrictEqual(parsed.data, value)) {
			return {
				ok: false as const,
				value: null,
				attempt,
				issues: [
					{
						stage: "schema" as const,
						path: [],
						code: "non_lossless_schema_parse",
						message: "fixture schema parse was not lossless",
					},
				],
			};
		}

		return {
			ok: true as const,
			value: parsed.data,
			attempt,
			issues: [] as [],
		};
	};
}
