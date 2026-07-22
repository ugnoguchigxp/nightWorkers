import { reviewerDraftSchema } from "../../../../shared/schemas/nightworkers.schema";
import { buildReviewerSystemPrompt } from "../../../services/structured-generation/prompts/review-rubric";
import { callStructuredOutputWithRepair } from "../../../services/structured-generation/structured-output-repair.service";
import { createStructuredOutputContract } from "../../../services/structured-llm";
import { StructuredLlmResponseError } from "../../../services/structured-llm/contract";
import { p } from "../../../systemContexts/catalog";
import { digestObject } from "./loader";
import type {
	LlmReviewerResult,
	ReviewEvidencePack,
	ReviewerDraft,
	RubricDefinition,
} from "./types";

type CallLlmReviewerInput = {
	rubric: RubricDefinition;
	evidencePack: ReviewEvidencePack;
	mockDraft?: ReviewerDraft | string | Record<string, unknown>;
};

const nullableStringJsonSchema = { type: ["string", "null"] };
const nullableIntegerJsonSchema = { type: ["integer", "null"] };
const reviewerFindingJsonSchema = {
	type: "object",
	additionalProperties: false,
	required: ["severity", "title", "body", "filePath", "line"],
	properties: {
		severity: { type: "string", enum: ["info", "warning", "blocking"] },
		title: { type: "string" },
		body: nullableStringJsonSchema,
		filePath: nullableStringJsonSchema,
		line: nullableIntegerJsonSchema,
	},
};
const reviewerDraftJsonSchema = {
	type: "object",
	additionalProperties: false,
	required: [
		"version",
		"verdict",
		"summary",
		"findings",
		"humanCallouts",
		"agentFollowUps",
		"suggestedNextTasks",
	],
	properties: {
		version: { type: "integer", enum: [1] },
		verdict: {
			type: "string",
			enum: ["approved", "changes_requested", "cancelled"],
		},
		summary: { type: "string" },
		findings: { type: "array", items: reviewerFindingJsonSchema },
		humanCallouts: { type: "array", items: reviewerFindingJsonSchema },
		agentFollowUps: { type: "array", items: { type: "string" } },
		suggestedNextTasks: { type: "array", items: { type: "string" } },
	},
};

export async function callLlmReviewer(
	input: CallLlmReviewerInput,
): Promise<LlmReviewerResult> {
	const reviewerSystemContext = p("review.llm-reviewer", {});
	const userPrompt = buildReviewerPrompt(input.rubric, input.evidencePack);
	const promptDigest = digestObject({
		system: reviewerSystemContext,
		user: userPrompt,
	});
	const evidencePackDigest = digestObject(input.evidencePack);

	if (input.mockDraft) {
		return {
			status: "completed",
			draft:
				typeof input.mockDraft === "string"
					? undefined
					: (input.mockDraft as ReviewerDraft),
			rawOutput: input.mockDraft,
			provider: "mock",
			model: "mock-reviewer",
			promptDigest,
			evidencePackDigest,
			outputDigest: digestObject(input.mockDraft),
			degradedReasons: [],
		};
	}

	let provider = "unknown";
	let model: string | undefined;
	try {
		const generated = await callStructuredOutputWithRepair({
			systemPrompt: reviewerSystemContext,
			userPrompt,
			options: {
				contract: createStructuredOutputContract({
					name: "reviewer_draft",
					runtimeSchema: reviewerDraftSchema,
					providerJsonSchema: reviewerDraftJsonSchema,
				}),
				role: "review",
				taskId: input.evidencePack.taskId,
				runId: input.evidencePack.runId,
				emitEvent: (event) => {
					const data = event.data ?? {};
					if (typeof data.provider === "string") provider = data.provider;
					if (typeof data.model === "string") model = data.model;
				},
			},
		});
		const rawOutput =
			generated.attempts.at(-1)?.rawText ?? JSON.stringify(generated.value);
		return {
			status: "completed",
			rawOutput,
			draft: generated.value as ReviewerDraft,
			provider,
			model,
			promptDigest,
			evidencePackDigest,
			outputDigest: digestObject(rawOutput),
			degradedReasons: [],
		};
	} catch (error) {
		if (error instanceof StructuredLlmResponseError) {
			return {
				status: "degraded",
				rawOutput: error.rawText,
				provider,
				model,
				promptDigest,
				evidencePackDigest,
				degradedReasons: ["llm_reviewer_response_invalid"],
				errorCode: "LLM_REVIEWER_RESPONSE_INVALID",
			};
		}
		const message = error instanceof Error ? error.message : String(error);
		const isNotConfigured = /no structured llm route candidates/i.test(message);
		return {
			status: "degraded",
			provider,
			model,
			promptDigest,
			evidencePackDigest,
			degradedReasons: [
				isNotConfigured
					? "llm_reviewer_provider_not_configured"
					: "llm_reviewer_call_failed",
			],
			errorCode: isNotConfigured
				? "LLM_REVIEWER_PROVIDER_NOT_CONFIGURED"
				: "LLM_REVIEWER_CALL_FAILED",
		};
	}
}

export function buildReviewerPrompt(
	rubric: RubricDefinition,
	evidencePack: ReviewEvidencePack,
): string {
	const maxChars = rubric.llm?.maxEvidenceChars ?? 12_000;
	const evidenceJson = JSON.stringify(evidencePack, null, 2).slice(0, maxChars);
	const hints = rubric.llm?.promptHints?.join("\n") || "追加指示なし";
	return buildReviewerSystemPrompt({
		rubricTitle: rubric.title,
		rubricId: rubric.id,
		hints,
		evidenceJson,
	});
}
