import { z } from "zod";

export const genericPlanViewSchema = z.enum([
	"user_flow",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"zod_schema_design",
]);

export type GenericPlanView = z.infer<typeof genericPlanViewSchema>;

export const markdownPlanViewSchema = z.enum([
	"user_flow",
	"activity_flow",
	"sequence_flow",
]);

export type MarkdownPlanView = z.infer<typeof markdownPlanViewSchema>;
