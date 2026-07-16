import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
	type DesignQuestionnaireAnswer,
	designQuestionnaireAnswerSchema,
} from "../../../../shared/schemas/design-questionnaire.schema";
import { missionPilotAnswerEvidenceSchema } from "../../../../shared/schemas/mission-pilot.schema";
import { db } from "../../../db/client";
import {
	missionPilotQuestionnaireDrafts,
	missionPilotSessions,
} from "../../../db/mission-pilot-schema";
import { AppError } from "../../../lib/errors";
import { enqueueActivityEvent } from "../../nightworkers/nightworkers.activity.repository";
import { missionPilotThoughtTrace } from "../../nightworkers/nightworkers.trace-provenance";
import { getDesignQuestionnaireSession } from "../../questionnaire/questionnaire.service";
import { getSessionQuestions } from "../../questionnaire/questionnaire-parser.service";
import {
	areQuestionnaireAnswersComplete,
	validateDesignQuestionnaireAnswerForQuestion,
} from "../../questionnaire/questionnaire-validation";
import * as missionPilotRepo from "../mission-pilot.repository";
import { publishMissionPilotUpdated } from "../mission-pilot-realtime";
import { ensureMissionPilotAgentQuestionnaireReadyMessage } from "../mission-pilot-workbench.port";
import { MISSION_PILOT_QUESTIONNAIRE_INTERVENTION_MS } from "./mission-pilot-agent.constants";
import { isMissionPilotAgentSession } from "./mission-pilot-agent-session.repository";

export async function saveAgentQuestionnaireDraft(input: {
	taskId: string;
	questionnaireSessionId: string;
	answers: DesignQuestionnaireAnswer[];
	answerEvidence: Array<{ questionId: string; reason: string }>;
}) {
	const pilot = await missionPilotRepo.getSessionByTaskId(input.taskId);
	if (
		pilot?.desiredState !== "playing" ||
		!(await isMissionPilotAgentSession(pilot.id)) ||
		!missionPilotRepo.hasValidAuthorization(pilot)
	)
		throw new AppError(
			409,
			"MISSION_PILOT_AGENT_NOT_PLAYING",
			"Mission Pilot agent is not playing.",
		);
	const questionnaire = await getDesignQuestionnaireSession(
		input.taskId,
		input.questionnaireSessionId,
	);
	if (questionnaire.status !== "answering")
		throw new AppError(
			409,
			"QUESTIONNAIRE_NOT_ANSWERING",
			"Questionnaire is not accepting a draft.",
		);
	const questionById = new Map(
		getSessionQuestions(questionnaire).map((question) => [
			String(question.id),
			question,
		]),
	);
	const parsedAnswers = input.answers.map((answer) => {
		const parsed = designQuestionnaireAnswerSchema.parse(answer);
		const question = questionById.get(parsed.questionId);
		if (!question)
			throw new AppError(
				422,
				"UNKNOWN_QUESTION",
				`Unknown question id: ${parsed.questionId}`,
			);
		validateDesignQuestionnaireAnswerForQuestion(parsed, question);
		return parsed;
	});
	if (
		new Set(parsedAnswers.map((answer) => answer.questionId)).size !==
		parsedAnswers.length
	)
		throw new AppError(
			422,
			"DUPLICATE_QUESTIONNAIRE_ANSWER",
			"Questionnaire draft contains duplicate question ids.",
		);
	if (
		!areQuestionnaireAnswersComplete(
			questionnaire,
			new Map(parsedAnswers.map((answer) => [answer.questionId, answer])),
		)
	)
		throw new AppError(
			422,
			"QUESTIONNAIRE_DRAFT_INCOMPLETE",
			"Questionnaire draft must answer every currently answerable question.",
		);
	const reasonByQuestionId = new Map(
		input.answerEvidence.map((evidence) => [
			evidence.questionId,
			evidence.reason.trim(),
		]),
	);
	if (reasonByQuestionId.size !== input.answerEvidence.length)
		throw new AppError(
			422,
			"DUPLICATE_QUESTIONNAIRE_ANSWER_EVIDENCE",
			"Questionnaire draft contains duplicate answer evidence.",
		);
	const answerQuestionIds = new Set(
		parsedAnswers.map((answer) => answer.questionId),
	);
	for (const questionId of reasonByQuestionId.keys())
		if (!answerQuestionIds.has(questionId))
			throw new AppError(
				422,
				"UNKNOWN_QUESTIONNAIRE_ANSWER_EVIDENCE",
				`Questionnaire answer evidence has no matching answer: ${questionId}`,
			);
	const now = new Date();
	const answerEvidence = Object.fromEntries(
		parsedAnswers.map((answer) => {
			const reason = reasonByQuestionId.get(answer.questionId);
			if (!reason)
				throw new AppError(
					422,
					"QUESTIONNAIRE_ANSWER_EVIDENCE_REQUIRED",
					`Questionnaire answer evidence is required: ${answer.questionId}`,
				);
			return [
				answer.questionId,
				missionPilotAnswerEvidenceSchema.parse({
					source: "mission_pilot",
					reason,
					updatedAt: now,
				}),
			];
		}),
	);
	const deadlineAt = new Date(
		now.getTime() + MISSION_PILOT_QUESTIONNAIRE_INTERVENTION_MS,
	);
	const result = await db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(missionPilotQuestionnaireDrafts)
			.where(
				eq(
					missionPilotQuestionnaireDrafts.questionnaireSessionId,
					input.questionnaireSessionId,
				),
			);
		const [draft] = existing
			? await tx
					.update(missionPilotQuestionnaireDrafts)
					.set({
						answersJson: parsedAnswers,
						answerEvidenceJson: answerEvidence,
						state: "waiting_user",
						deadlineAt,
						version: existing.version + 1,
						updatedAt: now,
					})
					.where(
						and(
							eq(missionPilotQuestionnaireDrafts.id, existing.id),
							eq(missionPilotQuestionnaireDrafts.version, existing.version),
						),
					)
					.returning()
			: await tx
					.insert(missionPilotQuestionnaireDrafts)
					.values({
						id: crypto.randomUUID(),
						sessionId: pilot.id,
						questionnaireSessionId: input.questionnaireSessionId,
						answersJson: parsedAnswers,
						answerEvidenceJson: answerEvidence,
						deadlineAt,
						createdAt: now,
						updatedAt: now,
					})
					.returning();
		if (!draft)
			throw new AppError(
				409,
				"MISSION_PILOT_DRAFT_VERSION_CONFLICT",
				"Questionnaire draft changed; refresh and retry",
			);
		const [updatedPilot] = await tx
			.update(missionPilotSessions)
			.set({
				phase: "waiting_intervention",
				resumePhase:
					pilot.phase === "waiting_intervention"
						? pilot.resumePhase
						: pilot.phase,
				nextWakeAt: deadlineAt,
				version: pilot.version + 1,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.id, pilot.id),
					eq(missionPilotSessions.version, pilot.version),
				),
			)
			.returning();
		if (!updatedPilot)
			throw new AppError(
				409,
				"MISSION_PILOT_VERSION_CONFLICT",
				"Mission Pilot state changed; re-read the Task workspace.",
			);
		return { draft, updatedPilot };
	});
	publishMissionPilotUpdated(
		input.taskId,
		missionPilotRepo.toControlSummary(result.updatedPilot),
	);
	await ensureMissionPilotAgentQuestionnaireReadyMessage({
		taskId: input.taskId,
		missionPilotSessionId: pilot.id,
		questionnaireSession: questionnaire,
	});
	enqueueActivityEvent({
		taskId: input.taskId,
		kind: "runtime.decision",
		source: "mission_pilot",
		status: "waiting",
		text: `${parsedAnswers.length}件のQuestionnaire回答案を作成しました。20秒間、ユーザーの変更を待ちます。`,
		payloadJson: {
			source: "mission_pilot",
			missionPilotSessionId: pilot.id,
			questionnaireSessionId: input.questionnaireSessionId,
			answerCount: parsedAnswers.length,
			deadlineAt: deadlineAt.toISOString(),
			decision: "wait_for_user_or_auto_submit",
		},
		dedupeKey: `mission-pilot:questionnaire:agent-draft:${result.draft.id}:${result.draft.version}`,
		trace: missionPilotThoughtTrace({ sessionId: pilot.id }),
	});
	return result.draft;
}
