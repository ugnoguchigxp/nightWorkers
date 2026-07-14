import { eq } from "drizzle-orm";
import { z } from "zod";
import { featurePlanImplementationPlanSchema } from "../../../shared/schemas/feature-plan-implementation-plan.schema";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import { db } from "../../db/client";
import { taskMessages } from "../../db/schema";
import { AppError, NotFoundError } from "../../lib/errors";
import {
	buildSpecificationDocumentSystemPrompt,
	buildSpecificationDocumentUserPrompt,
} from "../../services/structured-generation/prompts/design-questionnaire";
import { callStructuredOutputWithRepair } from "../../services/structured-generation/structured-output-repair.service";
import { createStructuredOutputContract } from "../../services/structured-llm";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import {
	createPlanModeTaskMessage,
	getPlanModeTask,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import { assertPlanModeCapabilityEnabled } from "../nightworkers/nightworkers.plan-mode-settings.service";
import { createVerificationDocumentFromSpec } from "../nightworkers/nightworkers.verification.service";
import {
	getDesignQuestionnaireSession,
	listDesignQuestionnaires,
} from "../questionnaire/questionnaire.service";
import { listUnansweredBlockingQuestions } from "../questionnaire/questionnaire-validation";
import {
	buildFeaturePlanImplementationPlanMetadata,
	renderFeaturePlanContent,
} from "./feature-plan-implementation-plan";
import type { PlanArtifactSourceSelection } from "./plan-artifact-input.types";
import { resolvePlanArtifactCanonicalInput } from "./plan-artifact-input-context.service";
import { projectPlanArtifactInput } from "./plan-artifact-input-projection";
import {
	buildPlanArtifactPromptBudgetMetadata,
	PLAN_ARTIFACT_GENERATION_TIMEOUT_MS,
	renderPlanArtifactInput,
} from "./plan-artifact-input-renderer";
import { createPlanArtifactSourceSelection } from "./plan-artifact-source-selection";
import { getPlanModeWorkspace } from "./plan-mode-workspace.service";
import { sanitizeSpecificationTargetNaming } from "./specification-document-renderer";
import { assertPlanModeMutable } from "./specification-mutability";
import { buildSpecificationVerificationSidecar } from "./specification-verification-sidecar";

const specificationDocumentDraftSchema = z.object({
	title: z.string().min(1),
	contentTemplate: z.string().min(1),
	implementationPlan: featurePlanImplementationPlanSchema,
});
const DEFAULT_FEATURE_PLAN_TITLE = "Feature Plan";
export const FEATURE_PLAN_LLM_TIMEOUT_MS = PLAN_ARTIFACT_GENERATION_TIMEOUT_MS;

export async function generateFeaturePlanArtifact(
	taskId: string,
	input: {
		prompt?: string;
		questionnaireSessionId?: string | null;
		sourceSelection?: PlanArtifactSourceSelection;
		proceedWithUnansweredBlocking?: boolean;
		routeOverride?: StructuredLlmModelTarget | null;
		role?: StructuredLlmRole;
		trace?: TraceProvenance;
		llmUsageTrace?: TraceProvenance;
		expectedState?: {
			missionPilotSessionId: string;
			contextRevision: number;
			contextDigest: string;
			routingRevision: number;
		};
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
	const canonical = await resolvePlanArtifactCanonicalInput({
		taskId,
		target: "feature_plan",
		questionnaireSessionId: input.questionnaireSessionId ?? null,
		sourceSelection:
			input.sourceSelection ??
			createPlanArtifactSourceSelection({ policy: "explicit_request" }),
		regenerationRequest: input.prompt ?? null,
		expectedState: input.expectedState,
	});
	const projection = projectPlanArtifactInput(canonical);
	const renderedInput = renderPlanArtifactInput(projection);
	const workspace = await getPlanModeWorkspace(taskId);
	const context: Parameters<typeof buildSpecificationDocumentUserPrompt>[0] = {
		task: renderedInput.task,
		projectStackContext: renderedInput.projectContext,
		implementationPlanGuidance: "",
		questionnaireDecisions: renderedInput.questionnaire,
		blueprintSummary: renderedInput.blueprint,
		dataModelDdl: renderedInput.dataModel,
		planViewReferences: renderedInput.dedicatedViews,
		planModeReferences: "",
		traceability: "",
		userRegenerationRequest: renderedInput.regenerationRequest,
		artifactInputPrompt: renderedInput.prompt,
	};
	if (
		unansweredBlockingQuestions.length > 0 &&
		input.proceedWithUnansweredBlocking
	) {
		context.artifactInputPrompt = addUnansweredBlockingAssumptions(
			context.artifactInputPrompt ?? renderedInput.prompt,
			unansweredBlockingQuestions,
		);
	}
	const rawOutput = await generateSpecificationDesignDocumentRawOutput(
		taskId,
		context,
		input.routeOverride || null,
		input.role ?? "plan",
		projection,
		input.llmUsageTrace,
	);
	const parsed = specificationDocumentDraftSchema.parse(JSON.parse(rawOutput));
	const implementationPlan = buildFeaturePlanImplementationPlanMetadata({
		...parsed.implementationPlan,
		steps: parsed.implementationPlan.steps.map((step) => ({
			...step,
			title: sanitizeSpecificationTargetNaming(
				step.title,
				context.projectStackContext,
			),
			description: sanitizeSpecificationTargetNaming(
				step.description,
				context.projectStackContext,
			),
		})),
	});
	const renderedContent = renderFeaturePlanContent({
		contentTemplate: sanitizeSpecificationTargetNaming(
			parsed.contentTemplate,
			context.projectStackContext,
		),
		implementationPlan,
	});
	const sanitizedContent = sanitizeSpecificationTargetNaming(
		renderedContent.trimEnd(),
		context.projectStackContext,
	);
	const initialSidecar = buildSpecificationVerificationSidecar({
		taskId,
		specId: taskId,
		specPath: buildSpecificationPath(
			parsed.title || DEFAULT_FEATURE_PLAN_TITLE,
		),
		content: sanitizedContent,
		sourceMessageIds: projection.provenance.sourceMessageIds,
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
			implementationPlan,
			generation: {
				source: "llm",
				context: {
					blueprintSummaryIncluded: Boolean(context.blueprintSummary.trim()),
					planViewReferencesIncluded: Boolean(
						context.planViewReferences.trim(),
					),
					planModeReferencesIncluded: false,
					inputProjection: projectionMetadata(
						projection,
						canonical.questionnaire?.sessionId ?? null,
					),
					contractDetailsStoredInAssembledDesignContext: true,
				},
			},
			markdownDocumentData: {
				title: parsed.title || DEFAULT_FEATURE_PLAN_TITLE,
				content: initialSidecar.content,
			},
		},
		trace: input.trace,
	});
	const sidecar = buildSpecificationVerificationSidecar({
		taskId,
		specId: message.id,
		specPath: buildSpecificationPath(
			parsed.title || DEFAULT_FEATURE_PLAN_TITLE,
		),
		content: initialSidecar.content,
		sourceMessageIds: [...projection.provenance.sourceMessageIds, message.id],
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
		trace: input.trace,
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

function projectionMetadata(
	projection: ReturnType<typeof projectPlanArtifactInput>,
	questionnaireSessionId: string | null,
) {
	return {
		version: projection.version,
		target: projection.target,
		digest: projection.diagnostics.projectionDigest,
		contextRevision: projection.provenance.contextRevision,
		contextDigest: projection.provenance.contextDigest,
		routingRevision: projection.provenance.routingRevision,
		questionnaireSessionId,
		questionnaireDigest: projection.provenance.questionnaireDigest,
		sourceMessageIds: projection.provenance.sourceMessageIds,
		sourceDigests: projection.provenance.sourceDigests,
		sectionBytes: projection.diagnostics.sectionBytes,
	};
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
	context: Parameters<typeof buildSpecificationDocumentUserPrompt>[0],
	routeOverride: StructuredLlmModelTarget | null,
	role: StructuredLlmRole,
	projection: ReturnType<typeof projectPlanArtifactInput>,
	usageTrace?: TraceProvenance,
) {
	try {
		const systemPrompt = buildSpecificationDocumentSystemPrompt();
		const userPrompt = buildSpecificationDocumentUserPrompt(context);
		const generated = await callStructuredOutputWithRepair({
			systemPrompt,
			userPrompt,
			options: {
				contract: createStructuredOutputContract({
					name: "specification_document",
					runtimeSchema: specificationDocumentDraftSchema,
				}),
				taskId,
				role,
				usageTrace,
				routeOverride,
				promptBudgetMetadata: buildPlanArtifactPromptBudgetMetadata({
					projection,
					systemPrompt,
					userPrompt,
					role,
					routeOverride,
				}),
				timeoutMs: FEATURE_PLAN_LLM_TIMEOUT_MS,
			},
		});
		return JSON.stringify(generated.value);
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

function addUnansweredBlockingAssumptions(
	prompt: string,
	questions: Array<{ question: string; decisionKey: string }>,
) {
	const assumptions = [
		"明示的に未回答のまま進行したblocking論点:",
		...questions.map(
			(question) =>
				`- ${question.question} (decisionKey: ${question.decisionKey}; unanswered and explicitly proceeded without an answer)`,
		),
	].join("\n");
	const marker = "\n## Current Project State";
	return prompt.includes(marker)
		? prompt.replace(marker, `\n${assumptions}${marker}`)
		: `${prompt}\n${assumptions}`;
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
