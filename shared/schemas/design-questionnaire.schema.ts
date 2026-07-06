import { z } from "@hono/zod-openapi";

const kebabIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const questionnaireDecisionKeySchema = z
	.string()
	.regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const dateLikeSchema = z.union([z.string(), z.date()]);

export const questionnaireChoiceQuestionSchema = z.object({
	text: z.string().min(1),
	type: z.enum(["radio", "checkbox"]),
	options: z.array(z.string().min(1)).min(2).max(10),
});

export const questionnaireChoiceFormSchema = z.object({
	title: z.string().min(1).default("実装前に決めたいこと"),
	questions: z.array(questionnaireChoiceQuestionSchema).min(1).max(15),
});

export const questionnaireQuestionSetSourceSchema = z.enum([
	"initial",
	"follow_up",
	"user_requested",
	"artifact_triggered",
	"pre_feature_plan_gate",
]);

export const questionnaireQuestionSetMetadataSchema = z.object({
	source: questionnaireQuestionSetSourceSchema,
	blocking: z.boolean(),
	reason: z.string().default(""),
	generatedFromMessageIds: z.array(z.string()).default([]),
	decisionKeys: z.array(questionnaireDecisionKeySchema).default([]),
});

export const designQuestionnaireFollowUpDecisionSchema = z
	.object({
		action: z.enum(["follow_up", "ready_for_design_assembly"]),
		rationale: z.string().min(1),
		questionnaire: questionnaireChoiceFormSchema.nullable().default(null),
	})
	.superRefine((decision, ctx) => {
		if (decision.action === "follow_up" && !decision.questionnaire) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["questionnaire"],
				message: "follow_up requires a questionnaire.",
			});
		}
		if (
			decision.action === "ready_for_design_assembly" &&
			decision.questionnaire
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["questionnaire"],
				message: "ready_for_design_assembly must not include a questionnaire.",
			});
		}
	});

export const designQuestionOptionSchema = z.object({
	id: kebabIdSchema,
	label: z.string().min(1),
	tradeoff: z.string().min(1),
	recommended: z.boolean().optional(),
});

export const designQuestionDependencySchema = z.object({
	questionId: kebabIdSchema,
	operator: z.enum(["equals", "not_equals", "includes", "excludes"]),
	value: z.union([z.string(), z.boolean(), z.array(z.string())]),
});

export const designQuestionSchema = z
	.object({
		id: kebabIdSchema,
		topic: z.string().min(1),
		question: z.string().min(1),
		why: z.string().min(1),
		answerType: z.enum([
			"single_choice",
			"multi_choice",
			"boolean",
			"free_text",
			"ranked",
		]),
		recommendedAnswerId: kebabIdSchema.optional(),
		options: z.array(designQuestionOptionSchema).optional(),
		allowsCustomAnswer: z.boolean().optional(),
		blocks: z.array(z.string().min(1)).min(1),
		outputSection: z.string().min(1),
		decisionKey: questionnaireDecisionKeySchema.optional(),
		blocking: z.boolean().optional(),
		blockingReason: z.string().optional(),
		dependsOn: z.array(designQuestionDependencySchema).optional(),
	})
	.superRefine((question, ctx) => {
		if (
			["single_choice", "multi_choice", "ranked"].includes(
				question.answerType,
			) &&
			(!question.options || question.options.length === 0)
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["options"],
				message: "Choice-based questions require options.",
			});
		}
	});

export const designQuestionSetSchema = z.object({
	id: kebabIdSchema,
	title: z.string().min(1),
	category: z.string().min(1),
	purpose: z.string().min(1),
	metadata: questionnaireQuestionSetMetadataSchema.optional(),
	questions: z.array(designQuestionSchema).min(1),
});

export const additionalQuestionnaireDraftSchema = z.object({
	title: z.string().min(1).default("追加で確認したいこと"),
	rationale: z.string().default(""),
	questions: z
		.array(
			z.object({
				decisionKey: questionnaireDecisionKeySchema,
				text: z.string().min(1),
				type: z.enum(["radio", "checkbox"]),
				options: z.array(z.string().min(1)).min(2).max(10),
				blocking: z.boolean(),
				reason: z.string().min(1),
			}),
		)
		.max(5)
		.default([]),
});

export const designOpenQuestionSchema = z.object({
	id: kebabIdSchema,
	topic: z.string().min(1),
	reason: z.string().min(1),
	blocks: z.array(z.string().min(1)).min(1),
	suggestedOwner: z
		.enum(["user", "designer", "engineer", "data-model", "later"])
		.optional(),
});

export const dataModelHandoffNoteSchema = z.object({
	id: kebabIdSchema,
	summary: z.string().min(1),
	sourceQuestionIds: z.array(kebabIdSchema),
	constraint: z.string().min(1),
});

export const designQuestionnaireSchema = z.object({
	version: z.literal(1),
	source: z.object({
		taskId: z.string().uuid(),
		repositoryId: z.string().uuid(),
		blueprintMessageId: z.string().uuid().nullable().optional(),
		promptMessageId: z.string().uuid().nullable().optional(),
		sourceKind: z.enum(["blueprint", "plan_mode_intake"]).optional(),
		blueprintVersion: z.number().int().positive().optional(),
	}),
	title: z.string().min(1),
	summary: z.string().min(1),
	questionSets: z.array(designQuestionSetSchema).min(1),
	openQuestions: z.array(designOpenQuestionSchema).default([]),
	dataModelHandoffNotes: z.array(dataModelHandoffNoteSchema).default([]),
});

export const designQuestionnaireAnswerSchema = z.object({
	questionId: kebabIdSchema,
	selectedOptionIds: z.array(kebabIdSchema).default([]),
	booleanValue: z.boolean().optional(),
	freeText: z.string().optional(),
	rankedOptionIds: z.array(kebabIdSchema).default([]),
	deferred: z.boolean().default(false),
});

export const saveDesignQuestionnaireAnswersSchema = z.object({
	answers: z.array(designQuestionnaireAnswerSchema).min(1),
});

export const designDecisionDraftSchema = z.object({
	id: kebabIdSchema,
	outputSection: z.string().min(1),
	decision: z.string().min(1),
	rationale: z.string().min(1),
	alternativesConsidered: z.array(z.string()).default([]),
	tradeoffs: z.array(z.string()).default([]),
	sourceQuestionIds: z.array(kebabIdSchema),
	unresolvedQuestionIds: z.array(kebabIdSchema).default([]),
});

export const designDecisionReviewSchema = z.object({
	version: z.literal(1),
	sessionId: z.string().uuid(),
	sourceBlueprintMessageId: z.string().uuid().nullable(),
	title: z.string().min(1),
	summary: z.string().min(1),
	decisions: z.array(designDecisionDraftSchema).default([]),
	deferredItems: z.array(designOpenQuestionSchema).default([]),
	unresolvedQuestions: z.array(designOpenQuestionSchema).default([]),
	dataModelHandoffNotes: z.array(dataModelHandoffNoteSchema).default([]),
});

export const createDesignQuestionnaireRequestSchema = z.object({
	sourceBlueprintMessageId: z.string().uuid().nullable().optional(),
});

export const generateAdditionalDesignQuestionnaireRequestSchema = z.object({
	source: z.enum([
		"user_requested",
		"artifact_triggered",
		"pre_feature_plan_gate",
	]),
	reason: z.string().optional(),
	maxQuestions: z.number().int().min(0).max(5).optional(),
});

export const designQuestionnaireSessionStatusSchema = z.enum([
	"draft",
	"answering",
	"review_ready",
	"accepted",
	"needs_edit",
	"abandoned",
]);

export const designQuestionnaireSessionSchema = z.object({
	id: z.string().uuid(),
	taskId: z.string().uuid(),
	repositoryId: z.string().uuid(),
	sourceBlueprintMessageId: z.string().uuid().nullable(),
	status: designQuestionnaireSessionStatusSchema,
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
	questionSets: z.array(
		z.object({
			id: z.string().uuid(),
			sequence: z.number().int().positive(),
			questionnaire: designQuestionnaireSchema.nullable(),
			rawOutput: z.string().nullable(),
			validationStatus: z.enum(["valid", "invalid"]),
			createdAt: dateLikeSchema,
		}),
	),
	answers: z.array(
		z.object({
			id: z.string().uuid(),
			questionId: kebabIdSchema,
			answer: designQuestionnaireAnswerSchema,
			answeredAt: dateLikeSchema,
		}),
	),
	reviews: z.array(
		z.object({
			id: z.string().uuid(),
			review: designDecisionReviewSchema.nullable(),
			publishedMessageId: z.string().uuid().nullable().optional(),
			status: z.enum(["draft", "accepted", "needs_edit", "left_unadopted"]),
			createdAt: dateLikeSchema,
			updatedAt: dateLikeSchema,
		}),
	),
});

export type DesignQuestionnaire = z.infer<typeof designQuestionnaireSchema>;
export type DesignQuestion = z.infer<typeof designQuestionSchema>;
export type DesignQuestionDependency = z.infer<
	typeof designQuestionDependencySchema
>;
export type DesignQuestionOption = z.infer<typeof designQuestionOptionSchema>;
export type DesignQuestionSet = z.infer<typeof designQuestionSetSchema>;
export type QuestionnaireDecisionKey = z.infer<
	typeof questionnaireDecisionKeySchema
>;
export type QuestionnaireQuestionSetSource = z.infer<
	typeof questionnaireQuestionSetSourceSchema
>;
export type QuestionnaireQuestionSetMetadata = z.infer<
	typeof questionnaireQuestionSetMetadataSchema
>;
export type QuestionnaireChoiceForm = z.infer<
	typeof questionnaireChoiceFormSchema
>;
export type AdditionalQuestionnaireDraft = z.infer<
	typeof additionalQuestionnaireDraftSchema
>;
export type DesignQuestionnaireFollowUpDecision = z.infer<
	typeof designQuestionnaireFollowUpDecisionSchema
>;
export type DesignQuestionnaireAnswer = z.infer<
	typeof designQuestionnaireAnswerSchema
>;
export type DesignDecisionReview = z.infer<typeof designDecisionReviewSchema>;
export type DesignQuestionnaireSession = z.infer<
	typeof designQuestionnaireSessionSchema
>;
