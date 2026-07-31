import type { z } from "zod";

export type StructuredOutputContract<T> = {
	name: string;
	runtimeSchema: z.ZodType<T>;
	providerJsonSchema: unknown;
	renderOutputRequirements: (
		render?: (key: string, values: Record<string, unknown>) => string,
	) => string;
};
