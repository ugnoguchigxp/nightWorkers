import crypto from "node:crypto";
import "./helpers/mission-pilot-runtime";
import {
	createSession,
	missionPilotTaskEventInbox,
} from "@nightworkers/mission-pilot/backend";
import {
	appendMissionPilotTaskEvent,
	claimAgentPlay,
	claimMissionPilotAgentTurn,
	claimMissionPilotToolCall,
	missionPilotTaskActionPort,
	persistMissionPilotProviderTurn,
} from "@nightworkers/mission-pilot/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, tasks } from "../api/db/schema";
import {
	createDesignQuestionnaireQuestionSet,
	createDesignQuestionnaireSession,
	updateDesignQuestionnaireSessionStatus,
} from "../api/modules/questionnaire/questionnaire.repository";
import { getDesignQuestionnaireSession } from "../api/modules/questionnaire/questionnaire.service";
import { initializeQuestionnaireRealtime } from "../api/modules/questionnaire/questionnaire-realtime";
import {
	humanTaskOperatorQueryContext,
	readTaskOperatorResource,
} from "../api/modules/taskOperator";
import { nightWorkersRealtimeBroker } from "../api/services/realtime/nightworkers-ws";
import { questionnaireStateChangedRealtimeEventSchema } from "../shared/schemas/design-questionnaire.schema";

const repositoryIds: string[] = [];

beforeAll(() => {
	ensureNightWorkersSchema();
	initializeQuestionnaireRealtime();
});
afterEach(async () => {
	vi.restoreAllMocks();
	for (const repositoryId of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
});

describe("Mission Pilot agent Questionnaire compatibility", () => {
	it("reads the same answering Questionnaire session that the UI renders", async () => {
		const fixture = await createFixture(false);
		const canonical = await getDesignQuestionnaireSession(
			fixture.taskId,
			fixture.questionnaireSessionId,
		);
		const canonicalQuestions = canonical.questionSets.flatMap((questionSet) =>
			(questionSet.questionnaire?.questionSets ?? []).flatMap((group) =>
				group.questions.map((question) => ({
					id: question.id,
					question: question.question,
					why: question.why,
					answerType: question.answerType,
					recommendedAnswerId: question.recommendedAnswerId,
					options: question.options,
					allowsCustomAnswer: question.allowsCustomAnswer,
					dependsOn: question.dependsOn,
				})),
			),
		);
		const questions: Array<Record<string, unknown>> = [];
		const pages: unknown[] = [];
		let cursor: number | null = 0;
		while (cursor !== null) {
			const page = await readTaskOperatorResource({
				taskId: fixture.taskId,
				resourceKind: "questionnaire",
				resourceId: fixture.questionnaireSessionId,
				cursor,
				context: humanTaskOperatorQueryContext(),
			});
			const content = page.content as {
				status: string;
				totalQuestionCount: number;
				questions: Array<Record<string, unknown>>;
				answers: unknown[];
			};
			pages.push(content);
			questions.push(...content.questions);
			expect(content.status).toBe(canonical.status);
			expect(content.totalQuestionCount).toBe(canonicalQuestions.length);
			expect(content.answers).toEqual([]);
			cursor = page.nextCursor;
		}
		expect(pages).toHaveLength(1);
		expect(questions).toMatchObject([
			{
				id: "api-style",
				question: "どの方式にしますか",
				options: [
					{ id: "rest", label: "REST" },
					{ id: "rpc", label: "RPC" },
				],
			},
		]);
		expect(questions).toEqual(canonicalQuestions);
	});

	it("pages Questionnaire questions as valid structured content", async () => {
		const fixture = await createFixture(false, 12);
		const cursors: Array<number | null> = [];
		const questionIds: string[] = [];
		let cursor: number | null = 0;
		while (cursor !== null) {
			const page = await readTaskOperatorResource({
				taskId: fixture.taskId,
				resourceKind: "questionnaire",
				resourceId: fixture.questionnaireSessionId,
				cursor,
				limit: 5,
				context: humanTaskOperatorQueryContext(),
			});
			const content = page.content as {
				totalQuestionCount: number;
				questions: Array<{ id: string }>;
			};
			expect(content.totalQuestionCount).toBe(12);
			expect(content.questions.length).toBeGreaterThan(0);
			questionIds.push(...content.questions.map((question) => question.id));
			cursors.push(page.nextCursor);
			cursor = page.nextCursor;
		}

		expect(cursors).toEqual([5, 10, null]);
		expect(new Set(questionIds).size).toBe(12);
		await expect(
			readTaskOperatorResource({
				taskId: fixture.taskId,
				resourceKind: "questionnaire",
				resourceId: fixture.questionnaireSessionId,
				cursor: 5_516,
				context: humanTaskOperatorQueryContext(),
			}),
		).rejects.toMatchObject({
			code: "TASK_OPERATOR_RESOURCE_CURSOR_INVALID",
		});
	});

	it("submits answers through the same questionnaire.submit action as the UI after the 20 second delay", async () => {
		const fixture = await createFixture();
		const realtimePublish = vi.spyOn(nightWorkersRealtimeBroker, "publish");
		const result = await executeQuestionnaireSubmit(fixture);

		expect(result).toMatchObject({
			ok: true,
		});
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
		const realtimeSubmission = realtimePublish.mock.calls.find(
			([publishedTaskId, message]) =>
				publishedTaskId === fixture.taskId &&
				message.type === "questionnaire.state_changed",
		);
		expect(
			questionnaireStateChangedRealtimeEventSchema.safeParse({
				...realtimeSubmission?.[1],
				taskId: realtimeSubmission?.[0],
			}).success,
		).toBe(true);
		realtimePublish.mockRestore();
	});

	it("rejects questionnaire.submit until the delayed answering event was delivered", async () => {
		const fixture = await createFixture(false);
		const result = await executeQuestionnaireSubmit(fixture);

		expect(result).toMatchObject({
			ok: false,
			failure: {
				kind: "domain_precondition",
				message: expect.stringContaining("ユーザー待機時間"),
			},
		});
		expect(
			await getDesignQuestionnaireSession(
				fixture.taskId,
				fixture.questionnaireSessionId,
			),
		).toMatchObject({
			status: "answering",
			answers: [],
		});
	});

	it("does not reuse an older consumed event for a newer Questionnaire page", async () => {
		const fixture = await createFixture();
		const event = await appendMissionPilotTaskEvent({
			taskId: fixture.taskId,
			eventType: "questionnaire.state_changed",
			sourceEventId: `questionnaire-answering-pending:${fixture.questionnaireSessionId}`,
			taskRevision: 0,
			payload: {
				questionnaireSessionId: fixture.questionnaireSessionId,
				status: "answering",
			},
			availableAt: new Date(Date.now() + 20_000),
		});
		if (!event)
			throw new Error("New Questionnaire answering event was not recorded");

		expect(await executeQuestionnaireSubmit(fixture)).toMatchObject({
			ok: false,
			failure: {
				kind: "domain_precondition",
				message: expect.stringContaining("ユーザー待機時間"),
			},
		});
	});
});

async function createFixture(
	answeringEventDelivered = true,
	questionCount = 1,
) {
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
					questions: Array.from({ length: questionCount }, (_, index) =>
						index === 0
							? {
									id: "api-style",
									topic: "API",
									question: "どの方式にしますか",
									why: "実装契約を固定するため",
									answerType: "single_choice",
									options: [
										{
											id: "rest",
											label: "REST",
											tradeoff: "既存規約に合う",
										},
										{ id: "rpc", label: "RPC", tradeoff: "密結合になる" },
									],
									blocks: ["implementation"],
									outputSection: "API",
								}
							: {
									id: `api-style-${index + 1}`,
									topic: `API ${index + 1}`,
									question: `どの方式にしますか ${index + 1}`,
									why: "実装契約を固定するため",
									answerType: "single_choice" as const,
									options: [
										{
											id: `rest-${index + 1}`,
											label: "REST",
											tradeoff: "既存規約に合う",
										},
										{
											id: `rpc-${index + 1}`,
											label: "RPC",
											tradeoff: "密結合になる",
										},
									],
									blocks: ["implementation"],
									outputSection: `API ${index + 1}`,
								},
					),
				},
			],
			openQuestions: [],
			dataModelHandoffNotes: [],
		},
	});
	await updateDesignQuestionnaireSessionStatus(questionnaire.id, "answering");
	if (answeringEventDelivered) {
		const event = await appendMissionPilotTaskEvent({
			taskId,
			eventType: "questionnaire.state_changed",
			sourceEventId: `questionnaire-answering-delivered:${questionnaire.id}`,
			taskRevision: claimed.version,
			payload: {
				questionnaireSessionId: questionnaire.id,
				status: "answering",
			},
			availableAt: new Date(0),
		});
		if (!event)
			throw new Error("Questionnaire answering event was not recorded");
		await db
			.update(missionPilotTaskEventInbox)
			.set({ consumedAt: new Date() })
			.where(eq(missionPilotTaskEventInbox.id, event.id));
	}
	return {
		repositoryId,
		taskId,
		sessionId: claimed.id,
		questionnaireSessionId: questionnaire.id,
	};
}

async function executeQuestionnaireSubmit(fixture: {
	taskId: string;
	sessionId: string;
	questionnaireSessionId: string;
}) {
	const leaseOwner = `questionnaire-submit:${crypto.randomUUID()}`;
	const turn = await claimMissionPilotAgentTurn({
		sessionId: fixture.sessionId,
		leaseOwner,
	});
	if (!turn) throw new Error("Mission Pilot turn was not claimed");
	const [task] = await db
		.select()
		.from(tasks)
		.where(eq(tasks.id, fixture.taskId));
	if (!task) throw new Error("Task was not found");
	const argumentsJson = {
		questionnaireSessionId: fixture.questionnaireSessionId,
		answers: [
			{
				questionId: "api-style",
				selectedOptionIds: ["rest"],
				rankedOptionIds: [],
				deferred: false,
			},
		],
	};
	const [toolCall] =
		(await persistMissionPilotProviderTurn({
			sessionId: fixture.sessionId,
			turnId: turn.turnId,
			leaseOwner,
			content: "UIと同じQuestionnaire回答commandへ回答を送信します。",
			toolCalls: [
				{
					id: `questionnaire-submit-${crypto.randomUUID()}`,
					name: "execute_task_action",
					arguments: {
						actionId: "questionnaire.submit",
						expectedTaskRevision: task.revision,
						idempotencyKey: `${fixture.sessionId}:questionnaire-submit`,
						arguments: argumentsJson,
					},
				},
			],
		})) ?? [];
	if (!toolCall) throw new Error("Mission Pilot tool call was not persisted");
	const running = await claimMissionPilotToolCall({
		id: toolCall.id,
		leaseOwner,
	});
	if (!running) throw new Error("Mission Pilot tool call was not claimed");
	return missionPilotTaskActionPort.execute({
		toolCallId: running.id,
		leaseOwner,
		taskId: fixture.taskId,
		sessionId: fixture.sessionId,
		actionId: running.actionId,
		arguments: argumentsJson,
		expectedTaskRevision: task.revision,
		idempotencyKey: running.idempotencyKey,
		signal: new AbortController().signal,
	});
}
