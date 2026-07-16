import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { missionPilotAgentSessions } from "../api/db/mission-pilot-agent-schema";
import {
	missionPilotQuestionnaireDrafts,
	missionPilotSessions,
} from "../api/db/mission-pilot-schema";
import { repositories, tasks } from "../api/db/schema";
import { saveAgentQuestionnaireDraft } from "../api/modules/missionPilot/agent/mission-pilot-agent-questionnaire.service";
import {
	claimAgentPlay,
	claimAgentStop,
} from "../api/modules/missionPilot/agent/mission-pilot-agent-session.repository";
import {
	claimMissionPilotAgentTurn,
	finishMissionPilotAgentTurn,
} from "../api/modules/missionPilot/agent/mission-pilot-conversation.repository";
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";
import {
	getQuestionnaireDraft,
	submitDueQuestionnaireDrafts,
} from "../api/modules/missionPilot/mission-pilot-questionnaire.service";
import { projectMissionPilotQuestionnaireDraftAnswers } from "../api/modules/missionPilot/mission-pilot-questionnaire-projection";
import {
	createDesignQuestionnaireQuestionSet,
	createDesignQuestionnaireSession,
	updateDesignQuestionnaireSessionStatus,
} from "../api/modules/questionnaire/questionnaire.repository";
import { getDesignQuestionnaireSession } from "../api/modules/questionnaire/questionnaire.service";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
});

describe("Mission Pilot agent Questionnaire compatibility", () => {
	it("stores LLM answers in the existing 20 second draft UI and auto-submits them", async () => {
		const fixture = await createFixture();
		const before = Date.now();
		const draft = await saveAgentQuestionnaireDraft({
			taskId: fixture.taskId,
			questionnaireSessionId: fixture.questionnaireSessionId,
			answers: [
				{
					questionId: "api-style",
					selectedOptionIds: ["rest"],
					rankedOptionIds: [],
					deferred: false,
				},
			],
			answerEvidence: [
				{
					questionId: "api-style",
					reason: "Taskの既存HTTP API規約と整合するためRESTを選択します。",
				},
			],
		});
		expect(draft).toMatchObject({
			state: "waiting_user",
			answersJson: [{ questionId: "api-style", selectedOptionIds: ["rest"] }],
			answerEvidenceJson: {
				"api-style": {
					source: "mission_pilot",
					reason: "Taskの既存HTTP API規約と整合するためRESTを選択します。",
				},
			},
		});
		expect(draft.deadlineAt.getTime() - before).toBeGreaterThanOrEqual(19_000);
		expect(draft.deadlineAt.getTime() - before).toBeLessThanOrEqual(20_500);
		expect(await readPilot(fixture.sessionId)).toMatchObject({
			phase: "waiting_intervention",
			nextWakeAt: draft.deadlineAt,
		});
		const canonicalBeforeSubmit = await getDesignQuestionnaireSession(
			fixture.taskId,
			fixture.questionnaireSessionId,
		);
		expect(canonicalBeforeSubmit.answers).toHaveLength(0);
		expect(
			await projectMissionPilotQuestionnaireDraftAnswers(fixture.taskId, [
				canonicalBeforeSubmit,
			]),
		).toMatchObject([
			{
				answers: [
					{
						questionId: "api-style",
						answer: { selectedOptionIds: ["rest"] },
					},
				],
			},
		]);

		const claimedTurn = await claimMissionPilotAgentTurn({
			sessionId: fixture.sessionId,
			leaseOwner: "questionnaire-test",
		});
		if (!claimedTurn) throw new Error("Mission Pilot turn was not claimed");
		await finishMissionPilotAgentTurn({
			sessionId: fixture.sessionId,
			turnId: claimedTurn.turnId,
			leaseOwner: "questionnaire-test",
			state: "waiting",
		});
		expect(await readPilot(fixture.sessionId)).toMatchObject({
			phase: "waiting_intervention",
			nextWakeAt: draft.deadlineAt,
		});

		await db
			.update(missionPilotAgentSessions)
			.set({ runtimeState: "completed", updatedAt: new Date() })
			.where(eq(missionPilotAgentSessions.sessionId, fixture.sessionId));
		await submitDueQuestionnaireDrafts(
			new Date(draft.deadlineAt.getTime() + 1),
		);
		const [submitted] = await db
			.select()
			.from(missionPilotQuestionnaireDrafts)
			.where(eq(missionPilotQuestionnaireDrafts.id, draft.id));
		expect(submitted).toMatchObject({ state: "submitted" });
		expect(
			await getDesignQuestionnaireSession(
				fixture.taskId,
				fixture.questionnaireSessionId,
			),
		).toMatchObject({
			status: "review_ready",
			answers: [
				{
					questionId: "api-style",
					answer: { selectedOptionIds: ["rest"] },
				},
			],
		});
		expect(await readPilot(fixture.sessionId)).toMatchObject({
			nextWakeAt: null,
		});
	});

	it("hides Mission Pilot draft answers from the normal Questionnaire while stopped", async () => {
		const fixture = await createFixture();
		await saveAgentQuestionnaireDraft({
			taskId: fixture.taskId,
			questionnaireSessionId: fixture.questionnaireSessionId,
			answers: [
				{
					questionId: "api-style",
					selectedOptionIds: ["rest"],
					rankedOptionIds: [],
					deferred: false,
				},
			],
			answerEvidence: [
				{
					questionId: "api-style",
					reason: "既存API規約と整合するためです。",
				},
			],
		});
		expect(await getQuestionnaireDraft(fixture.taskId)).not.toBeNull();
		const playing = await readPilot(fixture.sessionId);
		const stopped = await claimAgentStop(
			fixture.taskId,
			playing?.version ?? -1,
		);
		expect(stopped).not.toBeNull();
		const canonical = await getDesignQuestionnaireSession(
			fixture.taskId,
			fixture.questionnaireSessionId,
		);

		expect(await getQuestionnaireDraft(fixture.taskId)).toBeNull();
		expect(
			await projectMissionPilotQuestionnaireDraftAnswers(fixture.taskId, [
				canonical,
			]),
		).toEqual([canonical]);
		expect(canonical.answers).toHaveLength(0);
	});
});

async function createFixture() {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	const session = await db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "agent questionnaire",
			localPath: "/tmp/agent-questionnaire",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "agent questionnaire",
				objective: "Questionnaireに自動回答する",
			})
			.returning();
		return createSession(
			{ task, sourceKind: "task", sourceId: task.id, runtimeKind: "agent" },
			tx,
		);
	});
	const claimed = await claimAgentPlay(taskId, session.version);
	if (!claimed) throw new Error("Mission Pilot was not played");
	const questionnaire = await createDesignQuestionnaireSession({
		taskId,
		repositoryId,
		sourceBlueprintMessageId: null,
		status: "draft",
	});
	await createDesignQuestionnaireQuestionSet({
		sessionId: questionnaire.id,
		sequence: 1,
		validationStatus: "valid",
		rawOutput: null,
		questionnaireJson: {
			version: 1,
			source: { taskId, repositoryId, sourceKind: "plan_mode_intake" },
			title: "API方針",
			summary: "API方式を選択する",
			questionSets: [
				{
					id: "architecture",
					title: "構成",
					category: "architecture",
					purpose: "API契約を決める",
					questions: [
						{
							id: "api-style",
							topic: "API",
							question: "どの方式にしますか",
							why: "実装契約を固定するため",
							answerType: "single_choice",
							options: [
								{ id: "rest", label: "REST", tradeoff: "既存規約に合う" },
								{ id: "rpc", label: "RPC", tradeoff: "密結合になる" },
							],
							blocks: ["implementation"],
							outputSection: "API",
						},
					],
				},
			],
			openQuestions: [],
			dataModelHandoffNotes: [],
		},
	});
	await updateDesignQuestionnaireSessionStatus(questionnaire.id, "answering");
	return {
		repositoryId,
		taskId,
		sessionId: claimed.id,
		questionnaireSessionId: questionnaire.id,
	};
}

async function readPilot(sessionId: string) {
	const [pilot] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, sessionId));
	return pilot;
}
