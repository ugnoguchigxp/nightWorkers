import { z } from "@hono/zod-openapi";

const blueprintIdSchema = z
	.string()
	.min(1)
	.regex(/^[a-z][a-z0-9-]*$/);

const blueprintDataIdentifierSchema = z
	.string()
	.min(1)
	.regex(/^[a-z][a-z0-9_-]*$/);

export const blueprintDataBindingSchema = z
	.object({
		id: blueprintIdSchema,
		name: z.string().min(1),
		table: blueprintDataIdentifierSchema,
		mode: z.enum(["list", "detail", "form", "summary"]),
		fields: z.array(blueprintDataIdentifierSchema).min(1),
		filters: z.array(z.string().min(1)).default([]),
		sort: z.array(blueprintDataIdentifierSchema).default([]),
	})
	.openapi("BlueprintDataBinding");

export type BlueprintDataBinding = z.infer<typeof blueprintDataBindingSchema>;
