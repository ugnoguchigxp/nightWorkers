import {
	p as defaultP,
	type SystemContextP,
} from "../../../systemContexts/catalog";

export function buildBlueprintSystemPrompt(
	input: {
		appBlueprintJsonSchema: string;
	},
	p: SystemContextP = defaultP,
): string {
	return p("structuredGeneration.app-blueprint", {
		appBlueprintJsonSchema: input.appBlueprintJsonSchema,
	});
}
