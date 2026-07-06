import { z } from "@hono/zod-openapi";
import { blueprintDataBindingSchema } from "./app-blueprint-binding.schema";
import { blueprintDatabaseSchema } from "./app-blueprint-data.schema";
import { blueprintScreenSchema } from "./app-blueprint-ui.schema";
import { designPresetSchema } from "./design-governance.schema";

const blueprintIdSchema = z
	.string()
	.min(1)
	.regex(/^[a-z][a-z0-9-]*$/);

export const blueprintImplementationTaskSchema = z
	.object({
		id: blueprintIdSchema,
		title: z.string().min(1),
		description: z.string().min(1),
		affectedDomains: z.array(
			z.enum([
				"design-governance",
				"blueprint-catalog",
				"blueprint-ui",
				"blueprint-data",
				"blueprint-binding",
				"blueprints",
				"blueprint-task-planning",
				"nightworkers-runtime",
				"contextstill-feedback",
			]),
		),
	})
	.openapi("BlueprintImplementationTask");

export const blueprintLearningHookSchema = z
	.object({
		id: blueprintIdSchema,
		trigger: z.string().min(1),
		note: z.string().min(1),
	})
	.openapi("BlueprintLearningHook");

export const appBlueprintSchema = z
	.object({
		id: blueprintIdSchema,
		name: z.string().min(1),
		version: z.number().int().positive(),
		description: z.string().min(1).optional(),
		designPreset: designPresetSchema,
		screens: z.array(blueprintScreenSchema).min(1),
		databaseSchema: blueprintDatabaseSchema.default({
			tables: [],
			relations: [],
		}),
		dataBindings: z.array(blueprintDataBindingSchema).default([]),
		implementationTasks: z.array(blueprintImplementationTaskSchema).default([]),
		learningHooks: z.array(blueprintLearningHookSchema).default([]),
	})
	.openapi("AppBlueprint");

export type BlueprintImplementationTask = z.infer<
	typeof blueprintImplementationTaskSchema
>;
export type BlueprintLearningHook = z.infer<typeof blueprintLearningHookSchema>;
export type AppBlueprint = z.infer<typeof appBlueprintSchema>;
