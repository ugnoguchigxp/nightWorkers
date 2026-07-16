import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import { AppError, NotFoundError } from "../../lib/errors";
import { renderMockBlueprintMarkdown } from "../../services/blueprints/mock-draft";
import { listLlmUsageRecordsForTask } from "../../services/llm-usage";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import {
	createPlanModeMockBlueprintActivityArtifact,
	createPlanModeTaskMessage,
	getPlanModeTask,
	updatePlanModeTask,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import { assertPlanModeCapabilityEnabled } from "../nightworkers/nightworkers.plan-mode-settings.service";
import type { PlanArtifactSourceSelection } from "../specification/plan-artifact-input.types";
import { resolvePlanArtifactCanonicalInput } from "../specification/plan-artifact-input-context.service";
import { projectPlanArtifactInput } from "../specification/plan-artifact-input-projection";
import { renderPlanArtifactInput } from "../specification/plan-artifact-input-renderer";
import { createPlanArtifactSourceSelection } from "../specification/plan-artifact-source-selection";
import { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import { assertPlanModeMutable } from "../specification/specification-mutability";
import {
	generatePlanModeMockBlueprintDraft,
	MockBlueprintDraftGenerationError,
} from "./mock-blueprint-generation.service";

export async function generateBlueprintArtifact(
	taskId: string,
	input: {
		prompt?: string;
		questionnaireSessionId?: string | null;
		sourceSelection?: PlanArtifactSourceSelection;
		routeOverride?: StructuredLlmModelTarget | null;
		role?: StructuredLlmRole;
		trace?: TraceProvenance;
		llmUsageTrace?: TraceProvenance;
		signal?: AbortSignal;
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
	assertPlanModeCapabilityEnabled("blueprint");
	assertPlanModeMutable(task);
	const canonical = await resolvePlanArtifactCanonicalInput({
		taskId,
		target: "blueprint",
		questionnaireSessionId: input.questionnaireSessionId ?? null,
		sourceSelection:
			input.sourceSelection ??
			createPlanArtifactSourceSelection({ policy: "explicit_request" }),
		regenerationRequest: input.prompt ?? null,
		expectedState: input.expectedState,
	});
	const projection = projectPlanArtifactInput(canonical);
	const renderedInput = renderPlanArtifactInput(projection);
	try {
		const { mockBlueprint, generation } =
			await generatePlanModeMockBlueprintDraft({
				taskId,
				title: task.title || "Mock Blueprint",
				prompt: renderedInput.prompt,
				description: null,
				objective: null,
				questionnaireMarkdown: null,
				projectStackContext: null,
				specContext: null,
				projectionPrompt: renderedInput.prompt,
				projection,
				routeOverride: input.routeOverride || null,
				role: input.role,
				usageTrace: input.llmUsageTrace,
				signal: input.signal,
			});
		input.signal?.throwIfAborted();
		const generationWithUsage = {
			...generation,
			llmUsage: await resolveLatestMockBlueprintUsage(taskId),
		};
		const artifact = await createPlanModeMockBlueprintActivityArtifact({
			taskId,
			title: mockBlueprint.name || task.title || "Mock Blueprint",
			mockBlueprint,
			generation: {
				...generationWithUsage,
				inputProjection: projectionMetadata(
					projection,
					canonical.questionnaire?.sessionId ?? null,
				),
			},
			source: "status",
			metadataJson: {
				questionnaireSessionId: canonical.questionnaire?.sessionId ?? null,
				sourceBlueprintMessageId:
					input.sourceSelection?.previousTargetMessageId ?? null,
				userRegenerationRequest: input.prompt?.trim() || null,
				inputProjection: projectionMetadata(
					projection,
					canonical.questionnaire?.sessionId ?? null,
				),
			},
		});
		if (!artifact) throw new Error("Blueprint artifact persistence failed.");
		const renderedBlueprint = renderMockBlueprintMarkdown(mockBlueprint);
		const message = await createPlanModeTaskMessage({
			taskId,
			role: "assistant",
			content: renderedBlueprint,
			messageType: "markdown_document",
			payloadJson: {
				intent: "mock_blueprint",
				title: mockBlueprint.name || task.title || "Mock Blueprint",
				artifactType: "mock_blueprint",
				artifactRef: {
					artifactId: artifact.id,
					kind: "app_blueprint",
					version: 1,
				},
				display: {
					title: mockBlueprint.name || task.title || "Mock Blueprint",
					summary: mockBlueprint.summary || renderedBlueprint.slice(0, 160),
					cardKind: "app_blueprint",
				},
				mockBlueprint,
				generation: {
					...generationWithUsage,
					inputProjection: projectionMetadata(
						projection,
						canonical.questionnaire?.sessionId ?? null,
					),
				},
				source: "status",
				questionnaireSessionId: canonical.questionnaire?.sessionId ?? null,
			},
			trace: input.trace,
		});
		await updatePlanModeTask(taskId, {
			objective:
				task.objective ||
				task.description ||
				task.title ||
				renderedInput.regenerationRequest ||
				"",
			status: task.status === "draft" ? "ready" : task.status,
		});
		return { message, workspace: await getPlanModeWorkspace(taskId) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (
			error instanceof MockBlueprintDraftGenerationError &&
			error.rawOutput?.trim()
		) {
			const attempts = error.attempts.length
				? error.attempts
				: [
						{
							attempt: 1,
							rawText: error.rawOutput,
							extractedText: null,
							repairedText: null,
							repairKind: null,
						},
					];
			for (const attempt of attempts) {
				const rawText = attempt.rawText.trim();
				if (!rawText) continue;
				await createPlanModeTaskMessage({
					taskId,
					role: "assistant",
					content: rawText,
					messageType: "text",
					payloadJson: {
						intent: "mock_blueprint_raw_output",
						source: "status",
						attempt: attempt.attempt,
						validationStatus: "failed",
						validationIssues:
							error.validationByAttempt.find(
								(item) => item.attempt === attempt.attempt,
							)?.issues ?? [],
						repairKind: attempt.repairKind,
						rawOutputBytes: Buffer.byteLength(rawText, "utf8"),
						rawOutputPreview: rawText.slice(0, 500),
						questionnaireSessionId: canonical.questionnaire?.sessionId ?? null,
						sourceBlueprintMessageId:
							input.sourceSelection?.previousTargetMessageId ?? null,
						userRegenerationRequest: input.prompt?.trim() || null,
						promptDiagnostics: error.promptDiagnostics,
					},
					trace: input.trace,
				});
			}
		}
		throw new AppError(502, "SPECIFICATION_BLUEPRINT_FAILED", message, {
			responseTextOrigin:
				error instanceof MockBlueprintDraftGenerationError
					? "llm"
					: "application",
		});
	}
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

async function resolveLatestMockBlueprintUsage(taskId: string) {
	const records = await listLlmUsageRecordsForTask(taskId);
	const record = records.find((item) => item.label === "mock_blueprint");
	if (!record) return null;

	const inputTokens = normalizeTokenCount(record.inputTokens) ?? 0;
	const outputTokens = normalizeTokenCount(record.outputTokens) ?? 0;
	return {
		usageRecordId: record.id,
		provider: record.provider,
		model: record.model,
		label: record.label,
		usageMode: record.usageMode,
		inputTokens,
		outputTokens,
		totalTokens:
			normalizeTokenCount(record.totalTokens) ?? inputTokens + outputTokens,
		cachedInputTokens: normalizeTokenCount(record.cachedInputTokens),
		reasoningOutputTokens: normalizeTokenCount(record.reasoningOutputTokens),
		systemPromptTokens: normalizeTokenCount(record.systemPromptTokens),
		userPromptTokens: normalizeTokenCount(record.userPromptTokens),
		durationMs: Math.max(0, Math.floor(record.durationMs)),
		createdAt:
			record.createdAt instanceof Date ? record.createdAt.toISOString() : null,
	};
}

function normalizeTokenCount(value: number | null | undefined) {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: null;
}
