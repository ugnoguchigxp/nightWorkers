import { z } from "zod";
import {
	additionalQuestionnaireDraftSchema,
	designQuestionnaireFollowUpDecisionSchema,
	generatedQuestionnaireChoiceFormSchema,
	questionnaireChoiceFormSchema,
} from "../../../shared/schemas/design-questionnaire.schema";

export const questionnaireChoiceFormJsonSchema = z.toJSONSchema(
	questionnaireChoiceFormSchema,
);
export const generatedQuestionnaireChoiceFormJsonSchema = z.toJSONSchema(
	generatedQuestionnaireChoiceFormSchema,
);
export const additionalQuestionnaireDraftJsonSchema = z.toJSONSchema(
	additionalQuestionnaireDraftSchema,
);
export const designQuestionnaireFollowUpDecisionJsonSchema = z.toJSONSchema(
	designQuestionnaireFollowUpDecisionSchema,
);

export const designDecisionReviewJsonSchema = {
	type: "object",
	additionalProperties: false,
	required: [
		"version",
		"sessionId",
		"sourceBlueprintMessageId",
		"title",
		"summary",
		"decisions",
		"deferredItems",
		"unresolvedQuestions",
		"dataModelHandoffNotes",
	],
	properties: {
		version: { type: "integer", const: 1 },
		sessionId: { type: "string" },
		sourceBlueprintMessageId: { type: ["string", "null"] },
		title: { type: "string" },
		summary: { type: "string" },
		decisions: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"id",
					"outputSection",
					"decision",
					"rationale",
					"alternativesConsidered",
					"tradeoffs",
					"sourceQuestionIds",
					"unresolvedQuestionIds",
				],
				properties: {
					id: { type: "string" },
					outputSection: { type: "string" },
					decision: { type: "string" },
					rationale: { type: "string" },
					alternativesConsidered: { type: "array", items: { type: "string" } },
					tradeoffs: { type: "array", items: { type: "string" } },
					sourceQuestionIds: { type: "array", items: { type: "string" } },
					unresolvedQuestionIds: { type: "array", items: { type: "string" } },
				},
			},
		},
		deferredItems: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "topic", "reason", "blocks"],
				properties: {
					id: { type: "string" },
					topic: { type: "string" },
					reason: { type: "string" },
					blocks: { type: "array", items: { type: "string" } },
					suggestedOwner: {
						type: "string",
						enum: ["user", "designer", "engineer", "data-model", "later"],
					},
				},
			},
		},
		unresolvedQuestions: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "topic", "reason", "blocks"],
				properties: {
					id: { type: "string" },
					topic: { type: "string" },
					reason: { type: "string" },
					blocks: { type: "array", items: { type: "string" } },
					suggestedOwner: {
						type: "string",
						enum: ["user", "designer", "engineer", "data-model", "later"],
					},
				},
			},
		},
		dataModelHandoffNotes: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "summary", "sourceQuestionIds", "constraint"],
				properties: {
					id: { type: "string" },
					summary: { type: "string" },
					sourceQuestionIds: { type: "array", items: { type: "string" } },
					constraint: { type: "string" },
				},
			},
		},
	},
};
