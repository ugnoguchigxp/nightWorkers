import { eq } from "drizzle-orm";
import { implementationPlanSchema } from "../../../shared/modules/agentsShare";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import type { SpecificationAcceptanceCriterion } from "../../../shared/schemas/verification-checklist.schema";
import { db } from "../../db/client";
import { taskMessages } from "../../db/schema";
import { AppError, NotFoundError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import {
	buildSpecificationDocumentSystemPrompt,
	buildSpecificationDocumentUserPrompt,
} from "../../services/structured-generation/prompts/design-questionnaire";
import { callStructuredOutputWithRepair } from "../../services/structured-generation/structured-output-repair.service";
import {
	createStructuredOutputContract,
	StructuredLlmTimeoutError,
} from "../../services/structured-llm";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import { p } from "../../systemContexts/catalog";
import {
	digestImplementationPlan,
	renderSpecificationWithImplementationPlan,
	type StructuredProviderExecutionPolicy,
} from "../agentsShare";
import { repositoryHasGitHead } from "../gitworktree/repository-state.service";
import {
	createPlanModeTaskMessage,
	getPlanModeRepository,
	getPlanModeTask,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import { assertPlanModeCapabilityEnabled } from "../nightworkers/nightworkers.plan-mode-settings.service";
import { createVerificationDocumentFromSpec } from "../nightworkers/nightworkers.verification.service";
import {
	getDesignQuestionnaireSession,
	listDesignQuestionnaires,
} from "../questionnaire/questionnaire.service";
import { resolveCompletionVerificationScope } from "../questionnaire/questionnaire-completion-verification";
import { listUnansweredBlockingQuestions } from "../questionnaire/questionnaire-validation";
import {
	createFeaturePlanMarkdownDraftSchema,
	digestFeaturePlanContent,
	readFeaturePlanTitle,
} from "./feature-plan-content";
import { resolveFeaturePlanUpstreamArtifacts } from "./feature-plan-upstream-artifacts";
import type { PlanArtifactSourceSelection } from "./plan-artifact-input.types";
import { resolvePlanArtifactCanonicalInput } from "./plan-artifact-input-context.service";
import { projectPlanArtifactInput } from "./plan-artifact-input-projection";
import {
	buildPlanArtifactPromptBudgetMetadata,
	PLAN_ARTIFACT_GENERATION_TIMEOUT_MS,
	renderPlanArtifactInput,
} from "./plan-artifact-input-renderer";
import { getPlanModeWorkspace } from "./plan-mode-workspace.service";
import { sanitizeSpecificationTargetNaming } from "./specification-document-renderer";
import { assertPlanModeMutable } from "./specification-mutability";
import { buildSpecificationVerificationSidecar } from "./specification-verification-sidecar";

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
		executionPolicy?: StructuredProviderExecutionPolicy;
		trace?: TraceProvenance;
		llmUsageTrace?: TraceProvenance;
		signal?: AbortSignal;
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
	const repository = await getPlanModeRepository(task.repositoryId);
	if (!repository?.localPath) {
		throw new AppError(
			422,
			"PLAN_MODE_REPOSITORY_PATH_REQUIRED",
			"Feature Plan generation requires a registered Project path.",
		);
	}
	const requiresRepositoryMaterialization = !(await repositoryHasGitHead(
		repository.localPath,
	));
	const workspace = await getPlanModeWorkspace(taskId);
	const sourceSelection = resolveFeaturePlanUpstreamArtifacts({
		workspace,
		requestedSourceSelection: input.sourceSelection,
	});
	const canonical = await resolvePlanArtifactCanonicalInput({
		taskId,
		target: "feature_plan",
		questionnaireSessionId: input.questionnaireSessionId ?? null,
		sourceSelection,
		regenerationRequest: input.prompt ?? null,
	});
	const projection = projectPlanArtifactInput(canonical);
	const renderedInput = renderPlanArtifactInput(projection);
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
	const generatedDraft = await generateSpecificationDesignDocument(
		taskId,
		context,
		input.routeOverride || null,
		input.role ?? "plan",
		projection,
		input.llmUsageTrace,
		input.executionPolicy,
		input.signal,
		requiresRepositoryMaterialization,
	);
	input.signal?.throwIfAborted();
	const sanitizedPlan = implementationPlanSchema.parse({
		steps: generatedDraft.implementationPlan.steps.map((step) => ({
			title: sanitizeSpecificationTargetNaming(
				step.title,
				context.projectStackContext,
			).replace(/\s+/g, " "),
			systemContext: sanitizeSpecificationTargetNaming(
				step.systemContext,
				context.projectStackContext,
			).replace(/\s+/g, " "),
		})),
	});
	const sanitizedMarkdown = sanitizeSpecificationTargetNaming(
		generatedDraft.markdown.trimEnd(),
		context.projectStackContext,
	);
	const sanitizedAcceptanceCriteria: SpecificationAcceptanceCriterion[] =
		generatedDraft.acceptanceCriteria.map((criterion) => ({
			...criterion,
			title: sanitizeSpecificationTargetNaming(
				criterion.title,
				context.projectStackContext,
			).trim(),
		}));
	const sanitizedDraftResult = createFeaturePlanMarkdownDraftSchema({
		requiresRepositoryMaterialization,
	}).safeParse({
		markdown: sanitizedMarkdown,
		acceptanceCriteria: sanitizedAcceptanceCriteria,
		implementationPlan: sanitizedPlan,
		repositoryMaterializationIntent:
			generatedDraft.repositoryMaterializationIntent ?? null,
	});
	if (!sanitizedDraftResult.success) {
		throw new AppError(
			422,
			"FEATURE_PLAN_CANONICALIZATION_MISMATCH",
			"名称正規化後のFeature Plan本文と構造化完了条件が一致しません。",
			{
				retryable: true,
				issues: sanitizedDraftResult.error.issues.map((issue) => ({
					path: issue.path.map((part) =>
						typeof part === "number" ? part : String(part),
					),
					message: issue.message,
				})),
			},
		);
	}
	const sanitizedDraft = sanitizedDraftResult.data;
	const sanitizedContent = renderSpecificationWithImplementationPlan(
		sanitizedDraft.markdown,
		sanitizedDraft.implementationPlan,
	);
	const title = readFeaturePlanTitle(
		sanitizedContent,
		DEFAULT_FEATURE_PLAN_TITLE,
	);
	const contentDigest = digestFeaturePlanContent(sanitizedContent);
	const implementationPlanDigest = digestImplementationPlan(
		sanitizedDraft.implementationPlan,
	);
	const message = await createPlanModeTaskMessage({
		taskId,
		role: "assistant",
		content: sanitizedContent,
		messageType: "markdown_document",
		payloadJson: {
			intent: "feature_plan",
			title,
			source: "status",
			repositoryMaterializationIntent:
				sanitizedDraft.repositoryMaterializationIntent,
			implementationPlan: sanitizedDraft.implementationPlan,
			acceptanceCriteria: sanitizedDraft.acceptanceCriteria,
			implementationPlanProvenance: {
				version: 1,
				digest: implementationPlanDigest,
			},
			questionnaireSessionId: session?.id ?? null,
			featurePlanContent: {
				version: 1,
				digest: contentDigest,
			},
			verificationSidecarStatus: "pending",
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
				title,
				content: sanitizedContent,
			},
		},
		trace: input.trace,
	});
	try {
		const sidecar = buildSpecificationVerificationSidecar({
			taskId,
			specId: message.id,
			specPath: buildSpecificationPath(title),
			content: sanitizedContent,
			sourceMessageIds: [...projection.provenance.sourceMessageIds, message.id],
			workspace,
			acceptanceCriteria: sanitizedDraft.acceptanceCriteria,
			inferConditionSemantics: false,
			completionVerificationScope: session
				? resolveCompletionVerificationScope(session)
				: null,
		});
		const verificationMessage = await createPlanModeTaskMessage({
			taskId,
			role: "assistant",
			content: JSON.stringify(sidecar.document, null, 2),
			messageType: "verification_json",
			payloadJson: {
				intent: "feature_plan_verification",
				artifactKind: "verification_json",
				title: `${title} Verification`,
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
	} catch (error) {
		logger.warn(
			{ error, taskId, specMessageId: message.id },
			"Feature Plan was saved but verification sidecar generation failed",
		);
		await markVerificationSidecarFailed(message.id).catch((metadataError) => {
			logger.warn(
				{ error: metadataError, taskId, specMessageId: message.id },
				"Failed to record Feature Plan verification sidecar failure",
			);
		});
	}
	const [persistedMessage] = await db
		.select()
		.from(taskMessages)
		.where(eq(taskMessages.id, message.id));
	return {
		message: persistedMessage ?? message,
		workspace: await getPlanModeWorkspace(taskId),
	};
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

async function generateSpecificationDesignDocument(
	taskId: string,
	context: Parameters<typeof buildSpecificationDocumentUserPrompt>[0],
	routeOverride: StructuredLlmModelTarget | null,
	role: StructuredLlmRole,
	projection: ReturnType<typeof projectPlanArtifactInput>,
	usageTrace?: TraceProvenance,
	executionPolicy?: StructuredProviderExecutionPolicy,
	signal?: AbortSignal,
	requiresRepositoryMaterialization = false,
) {
	try {
		const materializationSystemContext = requiresRepositoryMaterialization
			? p("specification.repository-materialization-required", {}).trimEnd()
			: null;
		const systemPrompt = buildSpecificationDocumentSystemPrompt(
			{
				additionalSystemContext: [materializationSystemContext]
					.filter((value): value is string => Boolean(value))
					.join("\n"),
			},
			p,
		);
		const userPrompt = buildSpecificationDocumentUserPrompt(context);
		const generated = await callStructuredOutputWithRepair({
			systemPrompt,
			userPrompt,
			options: {
				contract: createStructuredOutputContract({
					name: "feature_plan_markdown",
					runtimeSchema: createFeaturePlanMarkdownDraftSchema({
						requiresRepositoryMaterialization,
					}),
				}),
				taskId,
				role,
				executionPolicy,
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
				signal,
			},
		});
		return generated.value;
	} catch (error) {
		if (error instanceof StructuredLlmTimeoutError) {
			throw new AppError(504, "SPECIFICATION_DOCUMENT_TIMEOUT", error.message, {
				responseTextOrigin: "application",
				failureKind: "provider_timeout",
				retryable: true,
				timeoutMs: error.timeoutMs,
			});
		}
		throw error;
	}
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
				verificationSidecarStatus: "ready",
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

async function markVerificationSidecarFailed(specMessageId: string) {
	const rows = await db
		.select()
		.from(taskMessages)
		.where(eq(taskMessages.id, specMessageId));
	const metadata = toRecord(rows[0]?.metadataJson);
	await db
		.update(taskMessages)
		.set({
			metadataJson: {
				...metadata,
				verificationSidecarStatus: "failed",
			},
		})
		.where(eq(taskMessages.id, specMessageId));
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
