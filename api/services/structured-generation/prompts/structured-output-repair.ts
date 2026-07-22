import { bindSystemContextTextCatalog } from "../../../systemContexts/catalog";
import type {
	StructuredLlmIssue,
	StructuredOutputContract,
} from "../../structured-llm";

export function buildStructuredOutputRepairPrompt<T>(input: {
	contract: StructuredOutputContract<T>;
	rawText: string;
	issues: StructuredLlmIssue[];
}) {
	const { p } = bindSystemContextTextCatalog();
	return {
		systemPrompt: p("structuredGeneration.repair", {
			outputRequirements: input.contract.renderOutputRequirements(p),
		}),
		userPrompt: JSON.stringify({
			originalResponse: input.rawText,
			validationIssues: input.issues,
		}),
	};
}
