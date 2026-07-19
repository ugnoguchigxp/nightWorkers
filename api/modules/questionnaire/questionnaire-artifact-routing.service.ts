import crypto from "node:crypto";
import type { DesignQuestionnaireSession } from "../../../shared/schemas/design-questionnaire.schema";
import { AppError, NotFoundError } from "../../lib/errors";
import { readGeneralSettings } from "../../services/settings/general-settings";
import { StructuredLlmResponseError } from "../../services/structured-llm/contract";
import { writePlanModeRoutingForUser } from "../agentsShare";
import {
	createPlanModeTaskMessage,
	getPlanModeTask,
	listPlanModeTaskMessages,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import { selectQuestionnaireArtifactRouting } from "./questionnaire-artifact-selection.service";

const ARTIFACT_ROUTING_PROMPT_VERSION = "questionnaire-artifact-routing-v3";

function record(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function recommendationInputDigest(input: {
	questionnaire: DesignQuestionnaireSession;
	task: {
		title: string;
		objective: string | null;
		acceptanceCriteria: string | null;
	};
	capabilities: Record<string, boolean>;
}) {
	const questionnaire = input.questionnaire;
	const answers = [...questionnaire.answers]
		.map(({ questionId, answer }) => ({ questionId, answer }))
		.sort((left, right) => left.questionId.localeCompare(right.questionId));
	return crypto
		.createHash("sha256")
		.update(
			JSON.stringify({
				promptVersion: ARTIFACT_ROUTING_PROMPT_VERSION,
				questionnaireSessionId: questionnaire.id,
				task: input.task,
				capabilities: Object.entries(input.capabilities).sort(
					([left], [right]) => left.localeCompare(right),
				),
				questionSets: questionnaire.questionSets,
				answers,
			}),
		)
		.digest("hex");
}

function idempotencyKeyFromDigest(digest: string) {
	const hex = digest.slice(0, 32).split("");
	hex[12] = "5";
	hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4];
	const value = hex.join("");
	return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export async function recommendQuestionnaireArtifactRouting(
	taskId: string,
	questionnaire: DesignQuestionnaireSession,
) {
	if (!["review_ready", "accepted"].includes(questionnaire.status)) return null;
	const [task, workspace, messages] = await Promise.all([
		getPlanModeTask(taskId),
		getPlanModeWorkspace(taskId),
		listPlanModeTaskMessages(taskId),
	]);
	if (!task) throw new NotFoundError("Task not found");
	const capabilities = readGeneralSettings().planMode.capabilities;
	const taskBasis = {
		title: task.title,
		objective: task.objective,
		acceptanceCriteria: task.acceptanceCriteria,
	};
	const digest = recommendationInputDigest({
		questionnaire,
		task: taskBasis,
		capabilities,
	});
	const existing = messages.find((message) => {
		const metadata = record(message.metadataJson);
		return (
			metadata?.intent === "questionnaire_artifact_routing" &&
			metadata.questionnaireSessionId === questionnaire.id &&
			metadata.recommendationInputDigest === digest &&
			metadata.promptVersion === ARTIFACT_ROUTING_PROMPT_VERSION
		);
	});
	if (existing) return workspace.routing;
	let decisions: Awaited<ReturnType<typeof selectQuestionnaireArtifactRouting>>;
	try {
		decisions = await selectQuestionnaireArtifactRouting({
			taskId,
			task: taskBasis,
			questionnaire,
			routing: workspace.routing,
			capabilities,
		});
	} catch (error) {
		const rawOutput =
			error instanceof StructuredLlmResponseError ? error.rawText : null;
		await createPlanModeTaskMessage({
			taskId,
			role: "system",
			content:
				rawOutput?.trim() ||
				`Questionnaire回答は保存されましたが、任意Artifactの推薦には失敗しました: ${error instanceof Error ? error.message : String(error)}`,
			messageType: "text",
			payloadJson: {
				intent: "questionnaire_artifact_routing_failed",
				source: "questionnaire_artifact_recommender",
				questionnaireSessionId: questionnaire.id,
				recommendationInputDigest: digest,
				promptVersion: ARTIFACT_ROUTING_PROMPT_VERSION,
				errorName: error instanceof Error ? error.name : "UnknownError",
				...(rawOutput !== null ? { rawOutput } : {}),
			},
		});
		return workspace.routing;
	}
	if (decisions.length === 0) return workspace.routing;

	if (workspace.routing.revision > 0) {
		try {
			await writePlanModeRoutingForUser({
				taskId,
				request: {
					expectedRevision: workspace.routing.revision,
					idempotencyKey: idempotencyKeyFromDigest(digest),
					changes: decisions,
				},
			});
		} catch (error) {
			if (
				error instanceof AppError &&
				error.code === "PLAN_MODE_ROUTING_REBUILD_IN_PROGRESS"
			) {
				return null;
			}
			throw error;
		}
	}

	await createPlanModeTaskMessage({
		taskId,
		role: "system",
		content:
			"Questionnaireの確定回答から、Feature Plan前に必要な設計Artifactと推奨粒度を選定しました。",
		messageType: "text",
		payloadJson: {
			intent: "questionnaire_artifact_routing",
			source: "questionnaire_artifact_recommender",
			questionnaireSessionId: questionnaire.id,
			recommendationInputDigest: digest,
			promptVersion: ARTIFACT_ROUTING_PROMPT_VERSION,
			viewDecisions: decisions,
		},
	});
	return (await getPlanModeWorkspace(taskId)).routing;
}
