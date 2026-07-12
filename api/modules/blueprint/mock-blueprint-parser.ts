import type { MockBlueprint } from "../../../shared/schemas/mock-blueprint.schema";
import { mockBlueprintSchema } from "../../../shared/schemas/mock-blueprint.schema";
import {
	type JsonFixWrapperResult,
	jsonFixWrapper,
} from "../../services/structured-llm/json";
import { normalizeMockBlueprintCandidate } from "./mock-blueprint-normalizer";

export function parseMockBlueprintJsonOutput(rawOutput: string):
	| {
			ok: true;
			value: MockBlueprint;
			sourceText: string;
			repaired: boolean;
			repairKind: JsonFixWrapperResult["repairKind"];
	  }
	| {
			ok: false;
			reason: "parse" | "schema";
			message: string;
			rawOutput: string;
	  } {
	const jsonFix = jsonFixWrapper(rawOutput);
	if (jsonFix) {
		const rawParsed = mockBlueprintSchema.safeParse(jsonFix.parsedJson);
		const normalized = normalizeMockBlueprintCandidate(jsonFix.parsedJson);
		const normalizedParsed = mockBlueprintSchema.safeParse(normalized);
		if (normalizedParsed.success) {
			return {
				ok: true,
				value: normalizedParsed.data,
				sourceText: jsonFix.sourceText,
				repaired: jsonFix.repaired || !rawParsed.success,
				repairKind: jsonFix.repairKind,
			};
		}

		return {
			ok: false,
			reason: "schema",
			message: normalizedParsed.error.issues
				.slice(0, 6)
				.map((issue) => `${issue.path.join(".") || "$"}:${issue.message}`)
				.join(", "),
			rawOutput,
		};
	}

	const balancedPrefix = firstBalancedJsonObject(rawOutput);
	if (!balancedPrefix) {
		return {
			ok: false,
			reason: "parse",
			message: "LLM output did not contain repairable JSON.",
			rawOutput,
		};
	}
	const prefixParsed = parseNormalizedMockBlueprintCandidate(balancedPrefix);
	if (prefixParsed.ok) {
		return {
			ok: true,
			value: prefixParsed.value,
			sourceText: balancedPrefix,
			repaired: true,
			repairKind: "balanced_json",
		};
	}
	return prefixParsed.error;
}

function parseNormalizedMockBlueprintCandidate(sourceText: string):
	| { ok: true; value: MockBlueprint }
	| {
			ok: false;
			error: {
				ok: false;
				reason: "parse" | "schema";
				message: string;
				rawOutput: string;
			};
	  } {
	try {
		const normalized = normalizeMockBlueprintCandidate(JSON.parse(sourceText));
		const parsed = mockBlueprintSchema.safeParse(normalized);
		if (parsed.success) return { ok: true, value: parsed.data };
		return {
			ok: false,
			error: {
				ok: false,
				reason: "schema",
				message: parsed.error.issues
					.slice(0, 6)
					.map((issue) => `${issue.path.join(".") || "$"}:${issue.message}`)
					.join(", "),
				rawOutput: sourceText,
			},
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				ok: false,
				reason: "parse",
				message: error instanceof Error ? error.message : String(error),
				rawOutput: sourceText,
			},
		};
	}
}

function firstBalancedJsonObject(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed.startsWith("{")) return null;

	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = 0; index < trimmed.length; index += 1) {
		const char = trimmed[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\" && inString) {
			escaped = true;
			continue;
		}
		if (char === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (char === "{") depth += 1;
		if (char === "}") depth -= 1;
		if (depth === 0) return trimmed.slice(0, index + 1);
	}
	return null;
}
