import {
	type PlanModeWorkspace,
	planModeArtifactKindSchema,
} from "../../../shared/schemas/plan-mode-artifact.schema";
import { NotFoundError } from "../../lib/errors";
import { getBlueprintArtifactAdoption } from "../blueprint";
import { getPlanModeRouting } from "../missionPilot";
import {
	getPlanModeTask,
	listPlanModeTaskMessages,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import { listDesignQuestionnaires } from "../questionnaire/questionnaire.service";
import { getAnswerableSessionQuestions } from "../questionnaire/questionnaire-parser.service";
import {
	isDesignQuestionnaireAnswerComplete,
	listUnansweredBlockingQuestions,
} from "../questionnaire/questionnaire-validation";

export async function getPlanModeWorkspace(
	taskId: string,
): Promise<PlanModeWorkspace> {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	const messages = await listPlanModeTaskMessages(taskId);
	const sessions = await listDesignQuestionnaires(taskId);
	const routing = await getPlanModeRouting(taskId, {
		messages,
		taskStatus: task.status,
	});
	const featurePlanArtifacts = [];
	const blueprintArtifacts = [];
	const dataModelArtifacts = [];
	const dedicatedViewArtifacts = [];
	const decisionReviews = [];
	const implementationReferences = [];
	for (const message of messages) {
		const metadata = (message.metadataJson || {}) as Record<string, unknown>;
		const isMarkdownDocument = message.messageType === "markdown_document";
		const isApiContractDocument =
			message.messageType === "api_contract" &&
			metadata.artifactKind === "plan_mode_api_contract";
		const isZodSchemaDocument =
			message.messageType === "zod_schema" &&
			metadata.artifactKind === "plan_mode_zod_schema";
		if (!isMarkdownDocument && !isApiContractDocument && !isZodSchemaDocument)
			continue;
		if (metadata.intent === "feature_plan") {
			featurePlanArtifacts.push({
				id: `feature-plan-${message.id}`,
				kind: "feature_plan" as const,
				title: String(metadata.title || "Feature Plan"),
				sourceMessageId: message.id,
				createdAt: message.createdAt,
			});
		}
		if (isBlueprintMetadata(metadata)) {
			const blueprintPayload = isRecord(metadata.appBlueprint)
				? metadata.appBlueprint
				: isRecord(metadata.mockBlueprint)
					? metadata.mockBlueprint
					: {};
			const adoption = await getBlueprintArtifactAdoption(taskId, message.id);
			const artifact = {
				id: `blueprint-${message.id}`,
				kind: "blueprint" as const,
				title: String(metadata.title || blueprintPayload.name || "Blueprint"),
				sourceMessageId: message.id,
				createdAt: message.createdAt,
				adoptionState: adoption
					? adoption.adopted
						? ("adopted" as const)
						: ("not_adopted" as const)
					: ("unknown" as const),
				sourceArtifactMessageId:
					typeof metadata.sourceBlueprintMessageId === "string"
						? metadata.sourceBlueprintMessageId
						: undefined,
				sourceBlueprintMessageId:
					typeof metadata.sourceBlueprintMessageId === "string"
						? metadata.sourceBlueprintMessageId
						: undefined,
			};
			blueprintArtifacts.push(artifact);
			dedicatedViewArtifacts.push(artifact);
		}
		if (
			metadata.artifactKind === "plan_mode_dedicated_view" ||
			metadata.artifactKind === "plan_mode_api_contract" ||
			metadata.artifactKind === "plan_mode_zod_schema"
		) {
			const parsedView = planModeArtifactKindSchema.safeParse(metadata.view);
			if (!parsedView.success) continue;
			const view = parsedView.data;
			const artifact = {
				id: `${view}-${message.id}`,
				kind: view,
				title: String(metadata.title || "Plan View"),
				sourceMessageId: message.id,
				createdAt: message.createdAt,
				sourceArtifactMessageId:
					typeof metadata.sourceBlueprintMessageId === "string"
						? metadata.sourceBlueprintMessageId
						: undefined,
				sourceBlueprintMessageId:
					typeof metadata.sourceBlueprintMessageId === "string"
						? metadata.sourceBlueprintMessageId
						: undefined,
				sourceDataModelMessageId:
					typeof metadata.sourceDataModelMessageId === "string"
						? metadata.sourceDataModelMessageId
						: undefined,
			};
			if (view === "data_model") dataModelArtifacts.push(artifact);
			dedicatedViewArtifacts.push(artifact);
		}
		if (
			metadata.intent === "design_decision_review" &&
			metadata.designDecisionReview
		) {
			decisionReviews.push({
				id: `decision-review-${message.id}`,
				kind: "decision_review" as const,
				title: String(metadata.title || "Decision Review"),
				sourceMessageId: message.id,
				createdAt: message.createdAt,
				sourceArtifactMessageId:
					typeof metadata.sourceBlueprintMessageId === "string"
						? metadata.sourceBlueprintMessageId
						: undefined,
			});
		}
		if (metadata.intent === "implementation_plan") {
			implementationReferences.push({
				id: `implementation-reference-${message.id}`,
				kind: "implementation_reference" as const,
				title: String(metadata.title || "Implementation Plan"),
				sourceMessageId: message.id,
				taskId,
			});
		}
	}
	return {
		taskId,
		repositoryId: task.repositoryId,
		generatedAt: new Date().toISOString(),
		featurePlanArtifacts,
		blueprintArtifacts,
		dataModelArtifacts,
		dedicatedViewArtifacts,
		questionnaireSessions: sessions.map((session) => {
			const answerableQuestions = getAnswerableSessionQuestions(
				session,
				session.answers,
			);
			const answerByQuestionId = new Map(
				session.answers.map((answer) => [answer.questionId, answer.answer]),
			);
			const answeredCount = answerableQuestions.filter((question) =>
				isDesignQuestionnaireAnswerComplete(
					question,
					answerByQuestionId.get(String(question.id)),
				),
			).length;
			const unansweredCount = Math.max(
				answerableQuestions.length - answeredCount,
				0,
			);
			const blockingUnansweredCount =
				listUnansweredBlockingQuestions(session).length;
			return {
				id: session.id,
				sourceBlueprintMessageId: session.sourceBlueprintMessageId,
				status: session.status,
				answeredCount,
				totalQuestionCount: answerableQuestions.length,
				unansweredCount,
				blockingUnansweredCount,
				nonBlockingUnansweredCount: Math.max(
					unansweredCount - blockingUnansweredCount,
					0,
				),
				latestAdditionalQuestionSetId:
					findLatestAdditionalQuestionSetId(session),
				latestReviewId: session.reviews[0]?.id,
			};
		}),
		decisionReviews,
		implementationReferences,
		viewDecisions: routing.entries.map(({ view, decision, reason }) => ({
			view,
			decision,
			...(reason ? { reason } : {}),
		})),
		routing,
	};
}

function findLatestAdditionalQuestionSetId(
	session: Awaited<ReturnType<typeof listDesignQuestionnaires>>[number],
) {
	return [...session.questionSets].reverse().find((set) =>
		(set.questionnaire?.questionSets || []).some((questionSet) => {
			const source = questionSet.metadata?.source;
			return (
				source === "user_requested" ||
				source === "artifact_triggered" ||
				source === "pre_feature_plan_gate"
			);
		}),
	)?.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isBlueprintMetadata(metadata: Record<string, unknown>) {
	return (
		(metadata.intent === "app_blueprint" && Boolean(metadata.appBlueprint)) ||
		(metadata.intent === "mock_blueprint" && Boolean(metadata.mockBlueprint))
	);
}
