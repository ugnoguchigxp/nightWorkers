import type { ProviderToolDefinition } from "../../../../services/structured-llm/tool-calls";
import { getCompatibleEditToolDefinition } from "./native-api-compatible-tool-profile";

export * from "./native-api-tool-manifest";

import {
	type NativeApiToolProfileInput,
	type NativeApiToolRegistration,
	nativeApiToolRegistrations,
	todoToolInputJsonSchema,
} from "./native-api-tool-manifest";

export function getNativeApiToolDefinitions(
	input: NativeApiToolProfileInput = {},
): ProviderToolDefinition[] {
	return nativeApiToolRegistrations
		.filter(
			(registration) =>
				registration.name !== "project_exploration_catalog" ||
				input.projectExplorationCatalogEnabled === true,
		)
		.map((registration) => {
			if (input.flatToolArguments === true) {
				const compatibleEdit = getCompatibleEditToolDefinition(
					registration.name,
				);
				if (compatibleEdit) return compatibleEdit;
				if (registration.name === "todo_list") {
					return {
						...registration.definition,
						description:
							"Todoが品質を上げるRunでだけ使います。planとreplace_remainingは、local/openai-compatible parser向けに1件のtitleとsystemContextを指定します。hostは次Todoを推測しません。",
						inputSchema: todoToolInputJsonSchema,
					};
				}
			}
			return registration.definition;
		});
}

export function getNativeApiToolRegistration(
	name: string,
): NativeApiToolRegistration | undefined {
	return nativeApiToolRegistrations.find(
		(registration) => registration.name === name,
	);
}
