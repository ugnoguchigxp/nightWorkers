import type { DesignQuestionnaireSession } from "../../../shared/schemas/design-questionnaire.schema";
import { logEvent } from "../../lib/logger";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { resumeTaskRunTodo } from "../nightworkers/nightworkers.run-orchestration.service";
import { getDesignQuestionnaireSession } from "../questionnaire/questionnaire.service";
import { registerQuestionnaireStateChangedListener } from "../questionnaire/questionnaire-events";

let initialized = false;

export function initializeCodingAgentPlanModeContinuation() {
	if (initialized) return;
	initialized = true;
	registerQuestionnaireStateChangedListener(async (questionnaire) => {
		await resumeCodingAgentRunAfterQuestionnaire(questionnaire);
	});
}

export async function resumeCodingAgentRunAfterQuestionnaire(
	questionnaire: DesignQuestionnaireSession,
) {
	if (questionnaire.status !== "accepted") return null;
	const runs = await nightworkersRepo.listTaskRunsForTask(questionnaire.taskId);
	const run = runs.find(
		(candidate) =>
			candidate.status === "needs_human" &&
			readAwaitingQuestionnaireSessionId(candidate.contextSnapshot) ===
				questionnaire.id,
	);
	if (!run) return null;
	const todos = await nightworkersRepo.listTaskRunTodosForRun(run.id);
	const todo = todos.find((candidate) => candidate.status === "needs_human");
	if (!todo) return null;
	try {
		return await resumeTaskRunTodo({
			runId: run.id,
			todoId: todo.id,
			expectedTodoRevision: todo.revision,
			userContext: buildQuestionnaireContinuationContext(questionnaire),
		});
	} catch (error) {
		logEvent({
			channel: "plan-mode",
			level: "warn",
			message: "failed to resume Coding Agent after Questionnaire acceptance",
			meta: {
				taskId: questionnaire.taskId,
				runId: run.id,
				questionnaireSessionId: questionnaire.id,
				error: error instanceof Error ? error.message : String(error),
			},
		});
		return null;
	}
}

export async function reconcileCodingAgentPlanModeContinuations() {
	const runs = await nightworkersRepo.listNeedsHumanTaskRuns();
	let resumed = 0;
	for (const run of runs) {
		const questionnaireSessionId = readAwaitingQuestionnaireSessionId(
			run.contextSnapshot,
		);
		if (!questionnaireSessionId) continue;
		const questionnaire = await getDesignQuestionnaireSession(
			run.taskId,
			questionnaireSessionId,
		).catch((error) => {
			logEvent({
				channel: "plan-mode",
				level: "warn",
				message:
					"failed to read Questionnaire during Coding Agent continuation recovery",
				meta: {
					taskId: run.taskId,
					runId: run.id,
					questionnaireSessionId,
					error: error instanceof Error ? error.message : String(error),
				},
			});
			return null;
		});
		if (
			questionnaire?.status === "accepted" &&
			(await resumeCodingAgentRunAfterQuestionnaire(questionnaire))
		)
			resumed += 1;
	}
	return resumed;
}

function readAwaitingQuestionnaireSessionId(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const planMode = (value as Record<string, unknown>).codingAgentPlanMode;
	if (!planMode || typeof planMode !== "object" || Array.isArray(planMode))
		return null;
	const sessionId = (planMode as Record<string, unknown>)
		.awaitingQuestionnaireSessionId;
	return typeof sessionId === "string" ? sessionId : null;
}

function buildQuestionnaireContinuationContext(
	questionnaire: DesignQuestionnaireSession,
) {
	const latestAcceptedReview = questionnaire.reviews.find(
		(review) => review.status === "accepted",
	);
	const payload = {
		questionnaireSessionId: questionnaire.id,
		status: questionnaire.status,
		answers: questionnaire.answers.map((answer) => ({
			questionId: answer.questionId,
			answer: answer.answer,
		})),
		acceptedReview: latestAcceptedReview?.review ?? null,
	};
	const serialized = JSON.stringify(payload);
	return [
		"Plan Modeで要求したQuestionnaireがユーザーにより確定しました。",
		"以下の回答と採用済み判断を読み、必要なArtifact routingと生成を同じTodoで続けてください。",
		serialized.length <= 18_000
			? serialized
			: `${serialized.slice(0, 18_000)}…`,
	].join("\n");
}
