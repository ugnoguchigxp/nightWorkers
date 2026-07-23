import {
	bindSystemContextCatalogSnapshot,
	type SystemContextBindingSnapshot,
	systemContextPromptAudit,
} from "../../../systemContexts/catalog";
import type {
	StructuredLlmIssue,
	StructuredOutputContract,
} from "../../structured-llm";

export function buildStructuredOutputRepairPrompt<T>(input: {
	contract: StructuredOutputContract<T>;
	rawText: string;
	issues: StructuredLlmIssue[];
	systemContextBinding?: SystemContextBindingSnapshot;
}) {
	const systemContexts = bindSystemContextCatalogSnapshot(
		input.systemContextBinding,
	);
	const invocation = systemContexts.invoke("structuredGeneration.repair", {
		outputRequirements: input.contract.renderOutputRequirements(
			systemContexts.p,
		),
	});
	return {
		systemPrompt: invocation.content.text,
		userPrompt: JSON.stringify({
			originalResponse: input.rawText,
			validationIssues: input.issues,
		}),
		systemContextAudit: [
			systemContextPromptAudit("system", systemContexts, invocation),
		],
	};
}
