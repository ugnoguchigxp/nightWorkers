import type { ProviderToolDefinition } from "../../../../services/structured-llm/tool-calls";

export * from "./native-api-tool-manifest";

import {
	type NativeApiToolProfileInput,
	type NativeApiToolRegistration,
	nativeApiToolRegistrations,
} from "./native-api-tool-manifest";

export function getNativeApiToolDefinitions(
	_input: NativeApiToolProfileInput = {},
): ProviderToolDefinition[] {
	return nativeApiToolRegistrations.map(
		(registration) => registration.definition,
	);
}

export function getNativeApiToolRegistration(
	name: string,
): NativeApiToolRegistration | undefined {
	return nativeApiToolRegistrations.find(
		(registration) => registration.name === name,
	);
}
