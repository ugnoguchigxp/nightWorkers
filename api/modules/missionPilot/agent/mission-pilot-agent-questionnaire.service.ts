import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { missionPilotAnswerEvidenceSchema } from "../../../../shared/modules/missionPilot";
import type { DesignQuestionnaireAnswer } from "../../../../shared/schemas/design-questionnaire.schema";
import { db } from "../../../db/client";
import { missionPilotQuestionnaireDrafts } from "../../../db/mission-pilot-schema";
import { AppError } from "../../../lib/errors";
import { enqueueTaskActivityEvent } from "../../task";
import { validateTaskOperatorQuestionnaireDraft } from "../../taskOperator";
import * as missionPilotRepo from "../mission-pilot.repository";
import { createMissionPilotTaskOperatorAccess } from "../mission-pilot-delegation";
import { submitMissionPilotQuestionnaireDraftRow } from "../mission-pilot-questionnaire.service";
import { missionPilotThoughtTrace } from "../mission-pilot-trace-provenance";
import { isMissionPilotAgentSession } from "./mission-pilot-agent-session.repository";
import { hasConsumedMissionPilotQuestionnaireAnsweringEvent } from "./mission-pilot-task-event.repository";

export async function saveAgentQuestionnaireDraft(input: {
	taskId: string;
	questionnaireSessionId: string;
	answers: DesignQuestionnaireAnswer[];
	answerEvidence: Array<{ questionId: string; reason: string }>;
	idempotencyKey?: string | null;
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
	if (
		!(await hasConsumedMissionPilotQuestionnaireAnsweringEvent({
			sessionId: pilot.id,
			questionnaireSessionId: input.questionnaireSessionId,
		}))
	)
		throw new AppError(
			409,
			"MISSION_PILOT_QUESTIONNAIRE_RESPONSE_WAIT_REQUIRED",
			"Questionnaireへの代理回答は、ユーザー待機時間が終了したanswering eventを受信した後にだけ実行できます。",
		);
	const access = await createMissionPilotTaskOperatorAccess({
		sessionId: pilot.id,
		taskId: input.taskId,
	});
	const { answers: parsedAnswers } =
		await validateTaskOperatorQuestionnaireDraft({
			taskId: input.taskId,
			questionnaireSessionId: input.questionnaireSessionId,
			answers: input.answers,
			context: access.context,
			delegatedAuthorization: access.delegatedAuthorization,
		});
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
	const deadlineAt = now;
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
						lastActionIdempotencyKey: input.idempotencyKey ?? null,
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
						lastActionIdempotencyKey: input.idempotencyKey ?? null,
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
		return { draft };
	});
	enqueueTaskActivityEvent({
		taskId: input.taskId,
		kind: "runtime.decision",
		source: "mission_pilot",
		status: "running",
		text: `Questionnaire表示から20秒待機したため、${parsedAnswers.length}件をユーザーの代わりに回答します。`,
		payloadJson: {
			source: "mission_pilot",
			missionPilotSessionId: pilot.id,
			questionnaireSessionId: input.questionnaireSessionId,
			answerCount: parsedAnswers.length,
			deadlineAt: deadlineAt.toISOString(),
			decision: "answer_after_user_wait",
		},
		dedupeKey: `mission-pilot:questionnaire:agent-draft:${result.draft.id}:${result.draft.version}`,
		trace: missionPilotThoughtTrace({ sessionId: pilot.id }),
	});
	const submitted = await submitMissionPilotQuestionnaireDraftRow(
		result.draft,
		input.taskId,
	);
	return submitted?.draft ?? result.draft;
}
