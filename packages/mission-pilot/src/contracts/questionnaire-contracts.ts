import { z } from "@hono/zod-openapi";

const questionnaireIdentifierSchema = z
	.string()
	.min(1)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const designQuestionnaireAnswerSchema = z.object({
	questionId: questionnaireIdentifierSchema,
	selectedOptionIds: z.array(questionnaireIdentifierSchema).default([]),
	booleanValue: z.boolean().optional(),
	freeText: z.string().optional(),
	rankedOptionIds: z.array(questionnaireIdentifierSchema).default([]),
	deferred: z.boolean().default(false),
});

export type DesignQuestionnaireAnswer = z.infer<
	typeof designQuestionnaireAnswerSchema
>;

// biome-ignore lint/suspicious/noExplicitAny: opaque Task Operator questionnaire projection
export type DesignQuestionnaireSession = any;
