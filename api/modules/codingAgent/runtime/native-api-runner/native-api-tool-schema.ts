export function objectSchema(
	properties: Record<string, unknown>,
	required: string[] = [],
	additionalProperties = false,
) {
	return {
		type: "object",
		properties,
		required,
		additionalProperties,
	};
}
