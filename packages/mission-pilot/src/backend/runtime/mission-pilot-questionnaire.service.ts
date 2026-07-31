import { and, desc, eq, lte, or } from "drizzle-orm";
import {
	type DesignQuestionnaireAnswer,
	type DesignQuestionnaireSession,
	designQuestionnaireAnswerSchema,
	missionPilotQuestionnaireDraftSchema,
} from "../../contracts";
import { db } from "../../db/client";
import * as missionPilotRepo from "../storage";
import {
	missionPilotQuestionnaireDrafts,
	missionPilotSessions,
} from "../storage";
import { enqueueTaskActivityEvent } from "../task";
import {
	executeTaskOperatorCommand,
	humanTaskOperatorCommandContext,
	humanTaskOperatorQueryContext,
	readTaskOperatorProjection,
} from "../taskOperator";
import { isMissionPilotAgentSession } from "./agent/mission-pilot-agent-session.repository";
import { MissionPilotError } from "./mission-pilot.errors";
import { createMissionPilotTaskOperatorAccess } from "./mission-pilot-delegation";
import { publishMissionPilotUpdated } from "./mission-pilot-realtime";
import { missionPilotThoughtTrace } from "./mission-pilot-trace-provenance";

type DraftRow = typeof missionPilotQuestionnaireDrafts.$inferSelect;

function recordPilotActivity(input: {
	taskId: string;
	sessionId: string;
	kind: string;
	text: string;
	status?: string;
	payloadJson?: Record<string, unknown>;
	dedupeKey: string;
}) {
	enqueueTaskActivityEvent({
		taskId: input.taskId,
		kind: input.kind,
		source: "mission_pilot",
		status: input.status,
		text: input.text,
		payloadJson: {
			source: "mission_pilot",
			missionPilotSessionId: input.sessionId,
			...input.payloadJson,
		},
		dedupeKey: input.dedupeKey,
		trace: missionPilotThoughtTrace({ sessionId: input.sessionId }),
	});
}

function toView(row: DraftRow, taskId: string) {
	return missionPilotQuestionnaireDraftSchema.parse({
		id: row.id,
		taskId,
		questionnaireSessionId: row.questionnaireSessionId,
		answers: row.answersJson,
		answerEvidence: row.answerEvidenceJson,
		state: row.state,
		deadlineAt: row.deadlineAt,
		version: row.version,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

export async function getQuestionnaireDraft(taskId: string) {
	const pilot = await missionPilotRepo.getSessionByTaskId(taskId);
	if (pilot?.desiredState !== "playing") return null;
	const [row] = await db
		.select()
		.from(missionPilotQuestionnaireDrafts)
		.where(eq(missionPilotQuestionnaireDrafts.sessionId, pilot.id))
		.orderBy(desc(missionPilotQuestionnaireDrafts.createdAt))
		.limit(1);
	return row ? toView(row, taskId) : null;
}

export async function updateQuestionnaireDraft(
	taskId: string,
	expectedVersion: number,
	answers: DesignQuestionnaireAnswer[],
) {
	const pilot = await missionPilotRepo.getSessionByTaskId(taskId);
	if (!pilot)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	const [current] = await db
		.select()
		.from(missionPilotQuestionnaireDrafts)
		.where(
			and(
				eq(missionPilotQuestionnaireDrafts.sessionId, pilot.id),
				eq(missionPilotQuestionnaireDrafts.state, "waiting_user"),
			),
		)
		.orderBy(desc(missionPilotQuestionnaireDrafts.createdAt))
		.limit(1);
	if (!current)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_DRAFT_NOT_EDITABLE",
			"Questionnaire draft is no longer editable",
		);
	const parsed = answers.map((answer) =>
		designQuestionnaireAnswerSchema.parse(answer),
	);
	const now = new Date();
	const currentById = new Map(
		current.answersJson.map((answer) => [answer.questionId, answer]),
	);
	const evidence = { ...current.answerEvidenceJson };
	for (const answer of parsed) {
		if (
			JSON.stringify(currentById.get(answer.questionId)) !==
			JSON.stringify(answer)
		) {
			evidence[answer.questionId] = {
				source: "user",
				reason: "ユーザーがMission Pilotの回答案を変更しました。",
				updatedAt: now,
			};
		}
	}
	const [updated] = await db
		.update(missionPilotQuestionnaireDrafts)
		.set({
			answersJson: parsed,
			answerEvidenceJson: evidence,
			version: expectedVersion + 1,
			updatedAt: now,
		})
		.where(
			and(
				eq(missionPilotQuestionnaireDrafts.id, current.id),
				eq(missionPilotQuestionnaireDrafts.version, expectedVersion),
				eq(missionPilotQuestionnaireDrafts.state, "waiting_user"),
			),
		)
		.returning();
	if (!updated)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_DRAFT_VERSION_CONFLICT",
			"Questionnaire draft changed; refresh and retry",
		);
	recordPilotActivity({
		taskId,
		sessionId: current.sessionId,
		kind: "ui.optimistic",
		status: "updated",
		text: "Questionnaireのユーザー変更を回答案へ反映しました。",
		payloadJson: {
			questionnaireSessionId: current.questionnaireSessionId,
			changedQuestionIds: Object.entries(evidence)
				.filter(([, item]) => item.source === "user")
				.map(([questionId]) => questionId),
		},
		dedupeKey: `mission-pilot:questionnaire:user-edit:${current.id}:${updated.version}`,
	});
	return toView(updated, taskId);
}

async function submitDraftRow(
	row: DraftRow,
	taskId: string,
	trigger: "timeout" | "user" | "resume" | "mission_pilot",
) {
	const [claimed] = await db
		.update(missionPilotQuestionnaireDrafts)
		.set({
			state: "submitting",
			version: row.version + 1,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(missionPilotQuestionnaireDrafts.id, row.id),
				eq(missionPilotQuestionnaireDrafts.version, row.version),
				eq(missionPilotQuestionnaireDrafts.state, "waiting_user"),
			),
		)
		.returning();
	if (!claimed) return null;
	recordPilotActivity({
		taskId,
		sessionId: row.sessionId,
		kind: "runtime.state",
		status: "running",
		text:
			trigger === "timeout"
				? "20秒の介入時間が終了したため、Questionnaire回答を自動確定しています。"
				: trigger === "mission_pilot"
					? "20秒の待機後、Mission Pilotがユーザーの代わりにQuestionnaire回答を確定しています。"
					: trigger === "resume"
						? "Mission Pilotの再生操作を受け、現在の回答案を確定しています。"
						: "ユーザー操作によりQuestionnaire回答を確定しています。",
		payloadJson: {
			questionnaireSessionId: claimed.questionnaireSessionId,
			answerCount: claimed.answersJson.length,
			trigger,
		},
		dedupeKey: `mission-pilot:questionnaire:submitting:${claimed.id}:${claimed.version}`,
	});
	try {
		const delegatedAccess =
			trigger === "mission_pilot"
				? await createMissionPilotTaskOperatorAccess({
						sessionId: row.sessionId,
						taskId,
					})
				: null;
		const queryContext =
			delegatedAccess?.context ?? humanTaskOperatorQueryContext();
		const projection = await readTaskOperatorProjection(
			taskId,
			queryContext,
			delegatedAccess?.delegatedAuthorization,
		);
		const delivery = await executeTaskOperatorCommand({
			taskId,
			actionId: "questionnaire.submit",
			expectedTaskRevision: projection.task.revision,
			arguments: {
				questionnaireSessionId: claimed.questionnaireSessionId,
				answers: claimed.answersJson,
			},
			context: delegatedAccess
				? {
						...delegatedAccess.context,
						requestId: `questionnaire-draft:${claimed.id}`,
						idempotencyKey: `questionnaire-draft:${claimed.id}:${claimed.version}`,
					}
				: humanTaskOperatorCommandContext({
						idempotencyKey: `questionnaire-draft:${claimed.id}:${claimed.version}`,
					}),
			runtime: delegatedAccess
				? {
						delegatedAuthorization: delegatedAccess.delegatedAuthorization,
					}
				: undefined,
		});
		const questionnaire = delivery.data as DesignQuestionnaireSession;
		if (!["review_ready", "accepted"].includes(questionnaire.status)) {
			throw new Error("Mission Pilot Questionnaire remained incomplete");
		}
		const now = new Date();
		const [submitted] = await db
			.update(missionPilotQuestionnaireDrafts)
			.set({ state: "submitted", version: claimed.version + 1, updatedAt: now })
			.where(
				and(
					eq(missionPilotQuestionnaireDrafts.id, claimed.id),
					eq(missionPilotQuestionnaireDrafts.version, claimed.version),
				),
			)
			.returning();
		const pilot = await missionPilotRepo.getSessionByTaskId(taskId);
		if (pilot && pilot.nextWakeAt?.getTime() === claimed.deadlineAt.getTime()) {
			const [updatedPilot] = await db
				.update(missionPilotSessions)
				.set({
					phase: pilot.resumePhase ?? "initial_intake",
					resumePhase: null,
					nextWakeAt: null,
					lastErrorCode: null,
					lastErrorMessage: null,
					version: pilot.version + 1,
					updatedAt: now,
				})
				.where(
					and(
						eq(missionPilotSessions.id, pilot.id),
						eq(missionPilotSessions.version, pilot.version),
						eq(missionPilotSessions.nextWakeAt, claimed.deadlineAt),
					),
				)
				.returning();
			if (updatedPilot)
				publishMissionPilotUpdated(
					taskId,
					missionPilotRepo.toControlSummary(updatedPilot),
				);
		}
		recordPilotActivity({
			taskId,
			sessionId: claimed.sessionId,
			kind: "runtime.state",
			status: "completed",
			text: `${claimed.answersJson.length}件のQuestionnaire回答を確定しました。`,
			payloadJson: {
				questionnaireSessionId: claimed.questionnaireSessionId,
				answerCount: claimed.answersJson.length,
				trigger,
				questionnaireStatus: questionnaire.status,
			},
			dedupeKey: `mission-pilot:questionnaire:submitted:${claimed.id}:${claimed.version}`,
		});
		return {
			draft: submitted ? toView(submitted, taskId) : null,
			questionnaire,
		};
	} catch (error) {
		const now = new Date();
		await db
			.update(missionPilotQuestionnaireDrafts)
			.set({
				state: "failed",
				version: claimed.version + 1,
				updatedAt: now,
			})
			.where(eq(missionPilotQuestionnaireDrafts.id, claimed.id));
		const pilot = await missionPilotRepo.getSessionByTaskId(taskId);
		if (pilot) {
			const agentOwned = await isMissionPilotAgentSession(pilot.id);
			if (agentOwned) {
				await import("./agent/mission-pilot-task-event.adapter").then(
					({ recordMissionPilotTaskEvent }) =>
						recordMissionPilotTaskEvent({
							taskId,
							type: "questionnaire.submission_failed",
							sourceEventId: `questionnaire-submit-failed:${claimed.id}:${claimed.version}`,
							taskRevision: pilot.version,
							payload: {
								questionnaireSessionId: claimed.questionnaireSessionId,
								trigger,
								error: error instanceof Error ? error.message : String(error),
							},
						}),
				);
			} else {
				const [updatedPilot] = await db
					.update(missionPilotSessions)
					.set({
						desiredState: "stopped",
						phase: "attention",
						nextWakeAt: null,
						lastErrorCode: "MISSION_PILOT_QUESTIONNAIRE_SUBMIT_FAILED",
						lastErrorMessage:
							error instanceof Error ? error.message : String(error),
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
				if (updatedPilot)
					publishMissionPilotUpdated(
						taskId,
						missionPilotRepo.toControlSummary(updatedPilot),
					);
			}
		}
		recordPilotActivity({
			taskId,
			sessionId: claimed.sessionId,
			kind: "system.error",
			status: "failed",
			text: "Questionnaire回答の確定に失敗しました。",
			payloadJson: {
				questionnaireSessionId: claimed.questionnaireSessionId,
				trigger,
				error: error instanceof Error ? error.message : String(error),
			},
			dedupeKey: `mission-pilot:questionnaire:failed:${claimed.id}:${claimed.version}`,
		});
		throw error;
	}
}

export async function submitQuestionnaireDraft(
	taskId: string,
	expectedVersion: number,
	answers: DesignQuestionnaireAnswer[],
) {
	const updated = await updateQuestionnaireDraft(
		taskId,
		expectedVersion,
		answers,
	);
	const pilot = await missionPilotRepo.getSessionByTaskId(taskId);
	if (!pilot)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_NOT_FOUND",
			"Mission Pilot session not found",
		);
	const [row] = await db
		.select()
		.from(missionPilotQuestionnaireDrafts)
		.where(
			and(
				eq(missionPilotQuestionnaireDrafts.sessionId, pilot.id),
				eq(missionPilotQuestionnaireDrafts.version, updated.version),
			),
		)
		.limit(1);
	if (!row)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_DRAFT_VERSION_CONFLICT",
			"Questionnaire draft changed; refresh and retry",
		);
	const confirmedAt = new Date();
	const confirmedEvidence = Object.fromEntries(
		Object.entries(row.answerEvidenceJson).map(([questionId, evidence]) => [
			questionId,
			evidence.source === "mission_pilot"
				? {
						source: "user_confirmed" as const,
						reason: "ユーザーがMission Pilotの回答案を確認して確定しました。",
						updatedAt: confirmedAt,
					}
				: evidence,
		]),
	);
	const [confirmed] = await db
		.update(missionPilotQuestionnaireDrafts)
		.set({
			answerEvidenceJson: confirmedEvidence,
			version: row.version + 1,
			updatedAt: confirmedAt,
		})
		.where(
			and(
				eq(missionPilotQuestionnaireDrafts.id, row.id),
				eq(missionPilotQuestionnaireDrafts.version, row.version),
				eq(missionPilotQuestionnaireDrafts.state, "waiting_user"),
			),
		)
		.returning();
	if (!confirmed)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_DRAFT_VERSION_CONFLICT",
			"Questionnaire draft changed; refresh and retry",
		);
	const result = await submitDraftRow(confirmed, taskId, "user");
	if (!result)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_DRAFT_VERSION_CONFLICT",
			"Questionnaire draft changed; refresh and retry",
		);
	return result;
}

export async function submitDueQuestionnaireDrafts(now = new Date()) {
	const due = await db
		.select()
		.from(missionPilotQuestionnaireDrafts)
		.where(
			and(
				eq(missionPilotQuestionnaireDrafts.state, "waiting_user"),
				lte(missionPilotQuestionnaireDrafts.deadlineAt, now),
			),
		);
	for (const row of due) {
		const [pilot] = await db
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, row.sessionId));
		if (
			pilot?.desiredState !== "playing" ||
			pilot.nextWakeAt?.getTime() !== row.deadlineAt.getTime()
		)
			continue;
		await submitDraftRow(row, pilot.taskId, "timeout").catch(() => undefined);
	}
	return due.length;
}

export async function resumeQuestionnaireCountdown(taskId: string) {
	const pilot = await missionPilotRepo.getSessionByTaskId(taskId);
	if (!pilot) return null;
	const [draft] = await db
		.select()
		.from(missionPilotQuestionnaireDrafts)
		.where(
			and(
				eq(missionPilotQuestionnaireDrafts.sessionId, pilot.id),
				or(
					eq(missionPilotQuestionnaireDrafts.state, "waiting_user"),
					eq(missionPilotQuestionnaireDrafts.state, "failed"),
				),
			),
		)
		.orderBy(desc(missionPilotQuestionnaireDrafts.createdAt))
		.limit(1);
	if (!draft) return pilot;
	let editableDraft = draft;
	if (draft.state === "failed") {
		const [reset] = await db
			.update(missionPilotQuestionnaireDrafts)
			.set({
				state: "waiting_user",
				version: draft.version + 1,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(missionPilotQuestionnaireDrafts.id, draft.id),
					eq(missionPilotQuestionnaireDrafts.version, draft.version),
					eq(missionPilotQuestionnaireDrafts.state, "failed"),
				),
			)
			.returning();
		if (!reset) return missionPilotRepo.getSessionByTaskId(taskId);
		editableDraft = reset;
	}
	const updated = await updateQuestionnaireDraft(
		taskId,
		editableDraft.version,
		editableDraft.answersJson,
	);
	const [row] = await db
		.select()
		.from(missionPilotQuestionnaireDrafts)
		.where(eq(missionPilotQuestionnaireDrafts.id, updated.id));
	if (row) await submitDraftRow(row, taskId, "resume");
	return missionPilotRepo.getSessionByTaskId(taskId);
}
