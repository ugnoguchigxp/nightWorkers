import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client";
import { taskMessages } from "../../db/schema";
import { AppError, NotFoundError } from "../../lib/errors";
import {
	buildSpecificationDocumentSystemPrompt,
	buildSpecificationDocumentUserPrompt,
} from "../../services/structured-generation/prompts/design-questionnaire";
import { callStructuredJsonLLM } from "../../services/structured-llm";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import {
	createPlanModeTaskMessage,
	getPlanModeTask,
	listPlanModeTaskMessages,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import { assertPlanModeCapabilityEnabled } from "../nightworkers/nightworkers.plan-mode-settings.service";
import { createVerificationDocumentFromSpec } from "../nightworkers/nightworkers.verification.service";
import {
	getDesignQuestionnaireSession,
	listDesignQuestionnaires,
} from "../questionnaire/questionnaire.service";
import { listUnansweredBlockingQuestions } from "../questionnaire/questionnaire-validation";
import { resolvePlanModeProjectStackContext } from "./plan-mode-project-stack-context";
import { getPlanModeWorkspace } from "./plan-mode-workspace.service";
import {
	buildSpecificationDocumentContext,
	sanitizeSpecificationTargetNaming,
} from "./specification-document-renderer";
import { assertPlanModeMutable } from "./specification-mutability";
import { buildSpecificationVerificationSidecar } from "./specification-verification-sidecar";

const specificationDocumentDraftSchema = z.object({
	title: z.string().min(1),
	content: z.string().min(1),
});
const DEFAULT_FEATURE_PLAN_TITLE = "Feature Plan";
export const FEATURE_PLAN_LLM_TIMEOUT_MS = 240_000;

export async function generateFeaturePlanArtifact(
	taskId: string,
	input: {
		prompt?: string;
		questionnaireSessionId?: string | null;
		sourceBlueprintMessageId?: string | null;
		proceedWithUnansweredBlocking?: boolean;
		routeOverride?: StructuredLlmModelTarget | null;
		role?: StructuredLlmRole;
	} = {},
) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	assertPlanModeCapabilityEnabled("feature_plan");
	assertPlanModeMutable(task);
	const { session, unansweredBlockingQuestions } =
		await resolveFeaturePlanQuestionnaireGate(
			taskId,
			input.questionnaireSessionId,
		);
	if (
		unansweredBlockingQuestions.length > 0 &&
		!input.proceedWithUnansweredBlocking
	) {
		throw new AppError(
			409,
			"BLOCKING_QUESTIONNAIRE_ANSWERS_REQUIRED",
			"Blocking questionnaire answers are required before generating Feature Plan.",
			{ blockingQuestions: unansweredBlockingQuestions },
		);
	}
	const projectStackContext = await resolvePlanModeProjectStackContext(
		task.repositoryId,
	);
	const workspace = await getPlanModeWorkspace(taskId);
	const messages = await listPlanModeTaskMessages(taskId);
	const context = buildSpecificationDocumentContext({
		task,
		session,
		workspace,
		messages,
		projectStackContext,
		preferredBlueprintMessageId: input.sourceBlueprintMessageId,
	});
	context.userRegenerationRequest = input.prompt?.trim() || null;
	if (
		unansweredBlockingQuestions.length > 0 &&
		input.proceedWithUnansweredBlocking
	) {
		context.questionnaireDecisions = [
			context.questionnaireDecisions,
			"",
			"## Unanswered Blocking Assumptions",
			...unansweredBlockingQuestions.map(
				(question) =>
					`- ${question.question} (decisionKey: ${question.decisionKey}; unanswered and explicitly proceeded without an answer)`,
			),
		].join("\n");
	}
	const rawOutput = await generateSpecificationDesignDocumentRawOutput(
		taskId,
		context,
		input.routeOverride || null,
		input.role ?? "plan",
	);
	const parsed = specificationDocumentDraftSchema.parse(JSON.parse(rawOutput));
	const sanitizedContent = sanitizeSpecificationTargetNaming(
		parsed.content.trimEnd(),
		context.projectStackContext,
	);
	const initialSidecar = buildSpecificationVerificationSidecar({
		taskId,
		specId: taskId,
		specPath: buildSpecificationPath(
			parsed.title || DEFAULT_FEATURE_PLAN_TITLE,
		),
		content: sanitizedContent,
		sourceMessageIds: messages.map((message) => message.id),
		workspace,
	});
	const message = await createPlanModeTaskMessage({
		taskId,
		role: "assistant",
		content: initialSidecar.content,
		messageType: "markdown_document",
		payloadJson: {
			intent: "feature_plan",
			title: parsed.title || DEFAULT_FEATURE_PLAN_TITLE,
			source: "status",
			questionnaireSessionId: session?.id ?? null,
			generation: {
				source: "llm",
				context: {
					blueprintSummaryIncluded: Boolean(context.blueprintSummary.trim()),
					dataModelReferenceIncluded: Boolean(context.dataModelDdl.trim()),
					planViewReferencesIncluded: Boolean(
						context.planViewReferences.trim(),
					),
					planModeReferencesIncluded: Boolean(
						context.planModeReferences.trim(),
					),
					contractDetailsStoredInAssembledDesignContext: true,
				},
			},
			markdownDocumentData: {
				title: parsed.title || DEFAULT_FEATURE_PLAN_TITLE,
				content: initialSidecar.content,
			},
		},
	});
	const sidecar = buildSpecificationVerificationSidecar({
		taskId,
		specId: message.id,
		specPath: buildSpecificationPath(
			parsed.title || DEFAULT_FEATURE_PLAN_TITLE,
		),
		content: initialSidecar.content,
		sourceMessageIds: [...messages.map((item) => item.id), message.id],
		workspace,
		generatedAt: initialSidecar.document.generatedAt,
	});
	const verificationMessage = await createPlanModeTaskMessage({
		taskId,
		role: "assistant",
		content: JSON.stringify(sidecar.document, null, 2),
		messageType: "verification_json",
		payloadJson: {
			intent: "feature_plan_verification",
			artifactKind: "verification_json",
			title: `${parsed.title || DEFAULT_FEATURE_PLAN_TITLE} Verification`,
			sourceFeaturePlanMessageId: message.id,
			verificationDocument: sidecar.document,
		},
	});
	const verificationDocument = await createVerificationDocumentFromSpec({
		taskId,
		specMessageId: message.id,
		specArtifactId: `feature-plan-${message.id}`,
		verificationArtifactId: `verification-json-${verificationMessage.id}`,
		sourceSpecPath: sidecar.document.specPath,
		document: sidecar.document,
	});
	await attachVerificationMetadata({
		specMessageId: message.id,
		verificationMessageId: verificationMessage.id,
		verificationDocumentId: verificationDocument.id,
		verificationArtifactId: `verification-json-${verificationMessage.id}`,
	});
	return { message, workspace: await getPlanModeWorkspace(taskId) };
}

async function resolveFeaturePlanQuestionnaireGate(
	taskId: string,
	questionnaireSessionId?: string | null,
) {
	const session = questionnaireSessionId
		? await getDesignQuestionnaireSession(taskId, questionnaireSessionId)
		: await resolveLatestQuestionnaireSession(taskId);
	const unansweredBlockingQuestions = session
		? listUnansweredBlockingQuestions(session)
		: [];
	return { session, unansweredBlockingQuestions };
}

async function resolveLatestQuestionnaireSession(taskId: string) {
	const sessions = await listDesignQuestionnaires(taskId);
	return (
		sessions.find(
			(session) => session.status !== "abandoned" && hasValidQuestions(session),
		) || null
	);
}

function hasValidQuestions(
	session: Awaited<ReturnType<typeof listDesignQuestionnaires>>[number],
) {
	return session.questionSets.some((set) =>
		(set.questionnaire?.questionSets || []).some(
			(questionSet) => questionSet.questions.length > 0,
		),
	);
}

async function generateSpecificationDesignDocumentRawOutput(
	taskId: string,
	context: ReturnType<typeof buildSpecificationDocumentContext>,
	routeOverride: StructuredLlmModelTarget | null,
	role: StructuredLlmRole,
) {
	try {
		return await callStructuredJsonLLM(
			buildSpecificationDocumentSystemPrompt(),
			buildSpecificationDocumentUserPrompt(context),
			{
				schemaName: "specification_document",
				schema: z.toJSONSchema(specificationDocumentDraftSchema),
				taskId,
				role,
				routeOverride,
				timeoutMs: FEATURE_PLAN_LLM_TIMEOUT_MS,
			},
		);
	} catch (error) {
		if (isStructuredLlmAbortError(error)) {
			throw new AppError(
				504,
				"SPECIFICATION_DOCUMENT_TIMEOUT",
				`Feature Plan generation timed out after ${Math.round(FEATURE_PLAN_LLM_TIMEOUT_MS / 1000)} seconds.`,
			);
		}
		throw error;
	}
}

function isStructuredLlmAbortError(error: unknown) {
	if (!(error instanceof Error)) return false;
	return (
		error.name === "AbortError" ||
		error.message.toLowerCase().includes("operation was aborted")
	);
}

async function attachVerificationMetadata(input: {
	specMessageId: string;
	verificationMessageId: string;
	verificationDocumentId: string;
	verificationArtifactId: string;
}) {
	const rows = await db
		.select()
		.from(taskMessages)
		.where(eq(taskMessages.id, input.specMessageId));
	const specMessage = rows[0];
	const specMetadata = toRecord(specMessage?.metadataJson);
	await db
		.update(taskMessages)
		.set({
			metadataJson: {
				...specMetadata,
				verificationDocumentId: input.verificationDocumentId,
				verificationArtifactId: input.verificationArtifactId,
				verificationSidecarMessageId: input.verificationMessageId,
				markdownDocumentData: {
					...toRecord(specMetadata.markdownDocumentData),
					verificationDocumentId: input.verificationDocumentId,
				},
			},
		})
		.where(eq(taskMessages.id, input.specMessageId));

	const verificationRows = await db
		.select()
		.from(taskMessages)
		.where(eq(taskMessages.id, input.verificationMessageId));
	const verificationMessage = verificationRows[0];
	await db
		.update(taskMessages)
		.set({
			metadataJson: {
				...toRecord(verificationMessage?.metadataJson),
				verificationDocumentId: input.verificationDocumentId,
				verificationArtifactId: input.verificationArtifactId,
				sourceFeaturePlanMessageId: input.specMessageId,
			},
		})
		.where(eq(taskMessages.id, input.verificationMessageId));
}

function buildSpecificationPath(title: string) {
	const slug = title
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return `spec/${slug || "feature-plan"}.md`;
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
