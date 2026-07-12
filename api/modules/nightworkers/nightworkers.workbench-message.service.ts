import { toDeepRecord } from "../../../shared/json-record";
import type { PromptImageInput } from "../../../shared/prompt-image";
import {
	type PlanModeWorkspace,
	planModeRegenerationTargetSchema,
} from "../../../shared/schemas/plan-mode-artifact.schema";
import { AppError, NotFoundError } from "../../lib/errors";
import { shouldWaitForWorkbenchIntakeInTests } from "../../services/runtime-env";
import { normalizeStructuredLlmModelTarget } from "../../services/structured-llm/selection";
import { generateDataModelArtifact } from "../dataModel/dataModel-generation.service";
import { executePlanModeArtifactCorrection } from "../planMode/plan-mode-artifact-correction.service";
import { buildSpecificationVerificationSidecar } from "../specification/specification-verification-sidecar";
import { assertRunnableWorkbenchTask } from "./nightworkers.planning-helpers.service";
import { queueTask } from "./nightworkers.queue-management.service";
import * as repo from "./nightworkers.repository";
import { startTaskRun } from "./nightworkers.run-orchestration.service";
import { createVerificationDocumentFromSpec } from "./nightworkers.verification.service";
import {
	handleWorkbenchIntakeMessage,
	isPlanModeArtifactRegenerationContext,
	prepareWorkbenchIntakeTask,
} from "./nightworkers.workbench.service";
import type { WorkbenchArtifactContext } from "./nightworkers.workbench-routing";
import {
	deletePromptImageAttachmentFiles,
	persistPromptImageAttachments,
} from "./prompt-image-attachments";

export async function createPlanningArtifactMessageIfNeeded(input: {
	taskId: string;
	runId: string;
	finalReport: string;
}) {
	const messages = await repo.listTaskMessages(input.taskId);
	const runStartedMessage = [...messages].reverse().find((message) => {
		const metadata = (message.metadataJson || {}) as Record<string, unknown>;
		return (
			message.role === "system" &&
			metadata.intent === "run_started" &&
			metadata.source === "workbench"
		);
	});
	const runStartedMetadata = (runStartedMessage?.metadataJson || {}) as Record<
		string,
		unknown
	>;
	const intakeJobSelection = toDeepRecord(
		runStartedMetadata.intakeJobSelection,
	);
	if (String(intakeJobSelection.jobType) !== "planning") {
		const run = await repo.getTaskRun(input.runId);
		const runContext =
			run?.contextSnapshot &&
			typeof run.contextSnapshot === "object" &&
			!Array.isArray(run.contextSnapshot)
				? (run.contextSnapshot as Record<string, unknown>)
				: {};
		if (runContext.executionMode !== "planning") return;
	}
	const alreadyPublished = messages.some((message) => {
		const metadata = (message.metadataJson || {}) as Record<string, unknown>;
		return (
			message.messageType === "markdown_document" &&
			metadata.intent === "implementation_plan" &&
			metadata.sourceRunId === input.runId
		);
	});
	if (alreadyPublished) return;
	const message = await repo.createTaskMessage({
		taskId: input.taskId,
		runId: input.runId,
		role: "assistant",
		content: input.finalReport,
		messageType: "markdown_document",
		payloadJson: {
			intent: "implementation_plan",
			title: "Implementation Plan",
			source: "workbench-planning-run",
			sourceRunId: input.runId,
			routingHypothesis: runStartedMetadata.routingHypothesis,
			intakeJobSelection,
			markdownDocumentData: {
				title: "Implementation Plan",
				content: input.finalReport,
			},
		},
	});
	if (!message) return;
	await attachImplementationPlanVerificationMetadata({
		taskId: input.taskId,
		runId: input.runId,
		specMessageId: message.id,
		finalReport: input.finalReport,
		sourceMessageIds: [...messages.map((item) => item.id), message.id],
		baseMetadata: toDeepRecord(message.metadataJson),
	});
}
async function attachImplementationPlanVerificationMetadata(input: {
	taskId: string;
	runId: string;
	specMessageId: string;
	finalReport: string;
	sourceMessageIds: string[];
	baseMetadata: Record<string, unknown>;
}) {
	const task = await repo.getTask(input.taskId);
	if (!task) throw new NotFoundError("Task not found");
	const generatedAt = new Date().toISOString();
	const workspace = buildImplementationPlanVerificationWorkspace({
		taskId: input.taskId,
		repositoryId: task.repositoryId,
		generatedAt,
		specMessageId: input.specMessageId,
	});
	const sidecar = buildSpecificationVerificationSidecar({
		taskId: input.taskId,
		specId: input.specMessageId,
		specPath: "spec/implementation-plan.md",
		content: input.finalReport,
		sourceMessageIds: input.sourceMessageIds,
		workspace,
		generatedAt,
	});
	const verificationMessage = await repo.createTaskMessage({
		taskId: input.taskId,
		runId: input.runId,
		role: "assistant",
		content: JSON.stringify(sidecar.document, null, 2),
		messageType: "verification_json",
		payloadJson: {
			intent: "implementation_plan_verification",
			artifactKind: "verification_json",
			title: "Implementation Plan Verification",
			sourceImplementationPlanMessageId: input.specMessageId,
			verificationDocument: sidecar.document,
		},
	});
	const verificationArtifactId = verificationMessage
		? `verification-json-${verificationMessage.id}`
		: null;
	const verificationDocument = await createVerificationDocumentFromSpec({
		taskId: input.taskId,
		runId: input.runId,
		specMessageId: input.specMessageId,
		specArtifactId: `implementation-plan-${input.specMessageId}`,
		verificationArtifactId,
		sourceSpecPath: sidecar.document.specPath,
		document: sidecar.document,
	});
	await repo.updateTaskMessageMetadata(input.specMessageId, {
		...input.baseMetadata,
		verificationDocumentId: verificationDocument.id,
		verificationArtifactId,
		verificationSidecarMessageId: verificationMessage?.id ?? null,
		markdownDocumentData: {
			...toDeepRecord(input.baseMetadata.markdownDocumentData),
			verificationDocumentId: verificationDocument.id,
		},
	});
	if (!verificationMessage) return;
	await repo.updateTaskMessageMetadata(verificationMessage.id, {
		...toDeepRecord(verificationMessage.metadataJson),
		verificationDocumentId: verificationDocument.id,
		verificationArtifactId,
		sourceImplementationPlanMessageId: input.specMessageId,
	});
}
function buildImplementationPlanVerificationWorkspace(input: {
	taskId: string;
	repositoryId: string;
	generatedAt: string;
	specMessageId: string;
}): PlanModeWorkspace {
	return {
		taskId: input.taskId,
		repositoryId: input.repositoryId,
		generatedAt: input.generatedAt,
		featurePlanArtifacts: [],
		blueprintArtifacts: [],
		dataModelArtifacts: [],
		dedicatedViewArtifacts: [],
		questionnaireSessions: [],
		decisionReviews: [],
		viewDecisions: [],
		implementationReferences: [
			{
				id: `implementation-plan-${input.specMessageId}`,
				kind: "implementation_reference",
				title: "Implementation Plan",
				sourceMessageId: input.specMessageId,
				taskId: input.taskId,
			},
		],
	};
}
export async function appendTaskMessage(
	id: string,
	prompt: string,
	metadata?: Record<string, unknown>,
) {
	const task = await repo.getTask(id);
	if (!task) throw new NotFoundError("Task not found");
	const trimmed = prompt.trim();
	if (!trimmed)
		throw new AppError(400, "EMPTY_PROMPT", "Prompt must not be empty");
	const existingMessages = await repo.listTaskMessages(id);
	const hasAnyUserMessage = existingMessages.some(
		(message) => message.role === "user",
	);
	await repo.createTaskMessage({
		taskId: id,
		role: "user",
		content: trimmed,
		messageType: "text",
		payloadJson: metadata,
	});
	if (task.title === "New Session" && !hasAnyUserMessage) {
		const firstPromptTitle = trimmed.replace(/\s+/g, " ").slice(0, 40);
		await repo.updateTask(id, { title: firstPromptTitle });
	}
	const latestTask = await repo.getTask(id);
	if (!latestTask) throw new NotFoundError("Task not found");
	return latestTask;
}
export type WorkbenchChatIntent =
	| "intake"
	| "draft"
	| "feature_plan"
	| "create_task"
	| "queue"
	| "run_task"
	| "adjust_running"
	| "review_followup"
	| "learning_capture"
	| "design_component"
	| "design_blueprint_data";

export async function appendWorkbenchMessage(
	id: string,
	input: {
		prompt: string;
		intent?: WorkbenchChatIntent;
		waitForIntake?: boolean;
		artifactContext?: WorkbenchArtifactContext | null;
		providerEndpointId?: string;
		model?: string;
		thinkingDepth?: "low" | "medium" | "high" | "very_high";
		images?: PromptImageInput[];
	},
) {
	const intent = input.intent || "intake";
	const task = await repo.getTask(id);
	if (!task) throw new NotFoundError("Task not found");
	const prompt = input.prompt.trim();
	if (!prompt)
		throw new AppError(400, "EMPTY_PROMPT", "Prompt must not be empty");
	const artifactContext = input.artifactContext || null;
	const llmSelection =
		input.model || input.providerEndpointId || input.thinkingDepth
			? {
					model: input.model || null,
					providerEndpointId: input.providerEndpointId || null,
					thinkingDepth: input.thinkingDepth || null,
				}
			: null;
	const llmRouteOverride = normalizeStructuredLlmModelTarget(llmSelection);
	const existingMessages = await repo.listTaskMessages(id);
	if (intent === "run_task") {
		assertRunnableWorkbenchTask(task, existingMessages);
	}
	const imageAttachments = await persistPromptImageAttachments({
		taskId: id,
		images: input.images,
	});
	const messageMetadata =
		artifactContext || llmSelection || imageAttachments.length > 0
			? {
					...(artifactContext
						? { intent: "artifact_context_instruction", artifactContext }
						: {}),
					source: "workbench",
					...(llmSelection ? { llmSelection } : {}),
					...(imageAttachments.length > 0 ? { imageAttachments } : {}),
				}
			: undefined;
	const appendWorkbenchTaskMessage = async () => {
		try {
			await appendTaskMessage(id, prompt, messageMetadata);
		} catch (error) {
			await deletePromptImageAttachmentFiles(imageAttachments);
			throw error;
		}
	};

	if (intent === "run_task") {
		await appendWorkbenchTaskMessage();
		const run = await startTaskRun(id, {
			executionMode: "implementation",
			executionModeSource: "workbench_run_task",
			routeOverride: llmRouteOverride,
		});
		return {
			task: await repo.getTask(id),
			run,
			messages: await repo.listTaskMessages(id),
		};
	}

	if (intent === "design_blueprint_data") {
		await appendWorkbenchTaskMessage();
		await generateDataModelArtifact(id, {
			prompt,
			routeOverride: llmRouteOverride,
		});
		const updated = await repo.updateTask(id, {
			objective: task.objective || prompt,
			status: task.status === "draft" ? "ready" : task.status,
		});
		return {
			task: updated,
			run: null,
			messages: await repo.listTaskMessages(id),
		};
	}

	if (
		intent === "intake" &&
		isPlanModeArtifactRegenerationContext(artifactContext)
	) {
		await appendWorkbenchTaskMessage();
		const metadata = artifactContext.metadata || {};
		const result = await executePlanModeArtifactCorrection({
			taskId: id,
			prompt,
			target: planModeRegenerationTargetSchema.parse(metadata.planModeTarget),
			focus: metadata.planModeFocus,
			correlationId: metadata.correlationId,
			questionnaireSessionId: metadata.questionnaireSessionId ?? null,
			featurePlanMessageId: metadata.featurePlanMessageId ?? null,
			sourceBlueprintMessageId: metadata.sourceBlueprintMessageId ?? null,
			sourceDataModelMessageId: metadata.sourceDataModelMessageId ?? null,
			routeOverride: llmRouteOverride,
		});
		return {
			task: (await repo.getTask(id)) || task,
			run: null,
			messages: await repo.listTaskMessages(id),
			workspace: result.workspace,
		};
	}

	await appendWorkbenchTaskMessage();

	if (intent === "queue" || intent === "create_task") {
		const queued = await queueTask(id);
		return {
			task: queued,
			run: null,
			messages: await repo.listTaskMessages(id),
		};
	}

	const waitForIntake =
		input.waitForIntake ?? shouldWaitForWorkbenchIntakeInTests();
	if (waitForIntake) {
		return handleWorkbenchIntakeMessage(id, task, prompt, {
			failureMode: "throw",
			intent,
			artifactContext,
			llmRouteOverride,
		});
	}

	const updated = await prepareWorkbenchIntakeTask(id, task, prompt);
	void handleWorkbenchIntakeMessage(id, task, prompt, {
		failureMode: "record",
		intent,
		artifactContext,
		llmRouteOverride,
	});
	return {
		task: updated,
		run: null,
		messages: await repo.listTaskMessages(id),
	};
}

export async function resumeWorkbenchIntakeMessage(
	id: string,
	prompt: string,
	options?: { waitForIntake?: boolean },
) {
	const task = await repo.getTask(id);
	if (!task) throw new NotFoundError("Task not found");
	const waitForIntake =
		options?.waitForIntake ?? shouldWaitForWorkbenchIntakeInTests();
	if (waitForIntake) {
		return handleWorkbenchIntakeMessage(id, task, prompt, {
			failureMode: "throw",
			intent: "intake",
			artifactContext: null,
			llmRouteOverride: null,
		});
	}
	const updated = await prepareWorkbenchIntakeTask(id, task, prompt);
	void handleWorkbenchIntakeMessage(id, task, prompt, {
		failureMode: "record",
		intent: "intake",
		artifactContext: null,
		llmRouteOverride: null,
	});
	return {
		task: updated,
		run: null,
		messages: await repo.listTaskMessages(id),
	};
}
