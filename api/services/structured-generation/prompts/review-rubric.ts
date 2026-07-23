export function buildReviewerUserPrompt(input: {
	rubricTitle: string;
	rubricId: string;
	hints: readonly string[];
	evidencePack: unknown;
	maxEvidenceChars: number;
}): string {
	const evidenceJson = stringifyRuntimeJson(input.evidencePack);
	const boundedEvidence =
		evidenceJson.length <= input.maxEvidenceChars
			? evidenceJson
			: stringifyRuntimeJson({
					truncated: true,
					originalCharacterCount: evidenceJson.length,
					jsonPrefix: evidenceJson.slice(0, input.maxEvidenceChars),
				});
	return [
		"<RUBRIC_METADATA_JSON>",
		stringifyRuntimeJson({
			id: input.rubricId,
			title: input.rubricTitle,
			hints: input.hints,
		}),
		"</RUBRIC_METADATA_JSON>",
		"",
		"<UNTRUSTED_EVIDENCE_PACK_JSON>",
		boundedEvidence,
		"</UNTRUSTED_EVIDENCE_PACK_JSON>",
	].join("\n");
}

function stringifyRuntimeJson(value: unknown) {
	return JSON.stringify(value, null, 2).replace(
		/[<>&\u2028\u2029]/g,
		(character) =>
			`\\u${character.codePointAt(0)?.toString(16).padStart(4, "0")}`,
	);
}
