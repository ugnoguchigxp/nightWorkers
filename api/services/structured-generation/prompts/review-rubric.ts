import { p } from "../../../systemContexts/catalog";

export function buildReviewerSystemPrompt(input: {
	rubricTitle: string;
	rubricId: string;
	hints: string;
	evidenceJson: string;
}): string {
	return p("structuredGeneration.reviewer", input);
}
