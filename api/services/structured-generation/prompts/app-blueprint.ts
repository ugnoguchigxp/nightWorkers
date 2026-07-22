import {
	bindSystemContextTextCatalog,
	type SystemContextP,
} from "../../../systemContexts/catalog";

export function buildBlueprintSystemPrompt(
	input: {
		appBlueprintJsonSchema: string;
	},
	p: SystemContextP = bindSystemContextTextCatalog().p,
): string {
	return p("structuredGeneration.app-blueprint", {
		appBlueprintJsonSchema: input.appBlueprintJsonSchema,
	});
}
