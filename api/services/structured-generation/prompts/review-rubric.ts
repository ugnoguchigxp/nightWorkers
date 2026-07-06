export function buildReviewerSystemPrompt(input: {
	rubricTitle: string;
	rubricId: string;
	hints: string;
	evidenceJson: string;
}): string {
	return [
		"最終 outcome は変更せず、rubric と evidence に基づく findings / humanCallouts / follow-ups だけを返してください。",
		"ReviewResult は直接返さず、ReviewerDraft JSON だけを返してください。",
		`Rubric: ${input.rubricTitle} (${input.rubricId})`,
		`Hints:\n${input.hints}`,
		`EvidencePack:\n${input.evidenceJson}`,
	].join("\n\n");
}
