import type { DesignQuestionnaireSession } from "../../../shared/schemas/design-questionnaire.schema";
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
	listPlanModeTaskMessages,
	updatePlanModeTask,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import { assertPlanModeCapabilityEnabled } from "../nightworkers/nightworkers.plan-mode-settings.service";
import { resolvePlanModeProjectStackContext } from "../specification/plan-mode-project-stack-context";
import { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import { renderQuestionnaireAnswerMarkdown } from "../specification/specification-document-renderer";
import { assertPlanModeMutable } from "../specification/specification-mutability";
import { resolveOptionalReadyQuestionnaireSession } from "../specification/specification-questionnaire-session";
import {
	generatePlanModeMockBlueprintDraft,
	MockBlueprintDraftGenerationError,
} from "./mock-blueprint-generation.service";

export async function generateBlueprintArtifact(
	taskId: string,
	input: {
		prompt?: string;
		questionnaireSessionId?: string | null;
		sourceBlueprintMessageId?: string | null;
		routeOverride?: StructuredLlmModelTarget | null;
		role?: StructuredLlmRole;
	} = {},
) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	assertPlanModeCapabilityEnabled("blueprint");
	assertPlanModeMutable(task);
	const session = await resolveOptionalReadyQuestionnaireSession(
		taskId,
		input.questionnaireSessionId,
	);
	const previousBlueprintContext = await resolveSourceBlueprintContext(
		taskId,
		input.sourceBlueprintMessageId,
	);
	const prompt = renderQuestionnaireBlueprintPrompt(session, {
		userRegenerationRequest: input.prompt,
		previousBlueprintContext,
	});
	const projectStackContext = await resolvePlanModeProjectStackContext(
		task.repositoryId,
	);
	const specContext = await resolveLatestSpecContext(taskId);
	try {
		const { mockBlueprint, generation } =
			await generatePlanModeMockBlueprintDraft({
				taskId,
				title: task.title || "Mock Blueprint",
				prompt,
				description: task.description,
				objective: task.objective,
				questionnaireMarkdown: session
					? renderQuestionnaireAnswerMarkdown(session)
					: null,
				projectStackContext,
				specContext,
				routeOverride: input.routeOverride || null,
				role: input.role,
			});
		const generationWithUsage = {
			...generation,
			llmUsage: await resolveLatestMockBlueprintUsage(taskId),
		};
		const artifact = await createPlanModeMockBlueprintActivityArtifact({
			taskId,
			title: mockBlueprint.name || task.title || "Mock Blueprint",
			mockBlueprint,
			generation: generationWithUsage,
			source: "status",
			metadataJson: {
				questionnaireSessionId: session?.id ?? null,
				sourceBlueprintMessageId: input.sourceBlueprintMessageId ?? null,
				userRegenerationRequest: input.prompt?.trim() || null,
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
				generation: generationWithUsage,
				source: "status",
				questionnaireSessionId: session?.id ?? null,
			},
		});
		await updatePlanModeTask(taskId, {
			objective: task.objective || task.description || task.title || prompt,
			status: task.status === "draft" ? "ready" : task.status,
		});
		return { message, workspace: await getPlanModeWorkspace(taskId) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (
			error instanceof MockBlueprintDraftGenerationError &&
			error.rawOutput?.trim()
		) {
			await createPlanModeTaskMessage({
				taskId,
				role: "assistant",
				content: error.rawOutput.trim(),
				messageType: "text",
				payloadJson: {
					intent: "mock_blueprint_raw_output",
					source: "status",
					validationStatus: "failed",
					error: message,
					rawOutputBytes: Buffer.byteLength(error.rawOutput.trim(), "utf8"),
					rawOutputPreview: error.rawOutput.trim().slice(0, 500),
					questionnaireSessionId: session?.id ?? null,
					sourceBlueprintMessageId: input.sourceBlueprintMessageId ?? null,
					userRegenerationRequest: input.prompt?.trim() || null,
					promptDiagnostics: error.promptDiagnostics,
				},
			});
		}
		throw new AppError(502, "SPECIFICATION_BLUEPRINT_FAILED", message);
	}
}

function renderQuestionnaireBlueprintPrompt(
	session: DesignQuestionnaireSession | null,
	input: {
		userRegenerationRequest?: string | null;
		previousBlueprintContext?: string | null;
	} = {},
) {
	const userRegenerationRequest = input.userRegenerationRequest?.trim();
	return [
		session
			? "Design Questionnaire の回答から Mock Blueprint を生成してください。"
			: "Task context から Mock Blueprint を生成してください。",
		"## Output Focus",
		"- UI/UX と画面構成を優先する。",
		"- DB table/column/relation や詳細実装情報は作らず、表示用の Section 選択と Mock dataset に集中する。",
		"- ユーザーが回答した仕様判断を画面・セクション・サンプルデータに反映する。",
		userRegenerationRequest
			? [
					"",
					"## User Regeneration Request",
					userRegenerationRequest,
					"",
					"上記の再生成指示を優先してください。ただし、指摘されていない既存の良い構造は維持し、不要な section や機能を追加しないでください。",
				].join("\n")
			: null,
		input.previousBlueprintContext
			? [
					"",
					"## Previous Blueprint Context",
					input.previousBlueprintContext,
				].join("\n")
			: null,
	]
		.filter(Boolean)
		.join("\n");
}

async function resolveSourceBlueprintContext(
	taskId: string,
	messageId?: string | null,
) {
	if (!messageId) return null;
	const messages = await listPlanModeTaskMessages(taskId);
	const message = messages.find((item) => item.id === messageId);
	if (!message?.content.trim()) return null;
	return compactSpecContext(message.content);
}

async function resolveLatestSpecContext(taskId: string) {
	const messages = await listPlanModeTaskMessages(taskId);
	const latest = [...messages]
		.filter((message) => {
			const metadata = (message.metadataJson || {}) as Record<string, unknown>;
			return (
				message.messageType === "markdown_document" &&
				metadata.intent === "feature_plan"
			);
		})
		.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))[0];
	return latest ? compactSpecContext(latest.content) : null;
}

function compactSpecContext(content: string) {
	const compacted = content
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.join("\n")
		.slice(0, 1_600);
	return compacted || null;
}

function toMs(value: unknown) {
	if (!value) return 0;
	if (value instanceof Date) return value.getTime();
	if (typeof value === "number" && Number.isFinite(value)) {
		return value > 0 && value < 1_000_000_000_000 ? value * 1000 : value;
	}
	if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
		const numeric = Number(value);
		if (Number.isFinite(numeric)) {
			return numeric > 0 && numeric < 1_000_000_000_000
				? numeric * 1000
				: numeric;
		}
	}
	const ms = new Date(String(value)).getTime();
	return Number.isFinite(ms) ? ms : 0;
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
