import crypto from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db/client";
import {
	missionPilotAgentSessions,
	missionPilotAgentTurns,
} from "../../../db/mission-pilot-agent-schema";
import { createOpenApiRouter } from "../../../lib/openapi";
import { registerFixtureProviderToolTurns } from "../../../services/structured-llm/fixture-tool-provider";
import * as repo from "../../nightworkers/nightworkers.repository";
import {
	createDesignQuestionnaireQuestionSet,
	createDesignQuestionnaireSession,
	updateDesignQuestionnaireSessionStatus,
} from "../../questionnaire/questionnaire.repository";
import { reconcileInterruptedMissionPilotAgentSessions } from "../agent/mission-pilot-agent-runtime";
import { isMissionPilotAgentSession } from "../agent/mission-pilot-agent-session.repository";
import { scheduleMissionPilotAgentWake } from "../agent/mission-pilot-agent-wake.service";
import { appendMissionPilotTaskEvent } from "../agent/mission-pilot-task-event.repository";
import * as missionPilotRepo from "../mission-pilot.repository";

const prepareAgentQuestionnaireFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/mission-pilot-agent-questionnaire",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ taskId: z.string().uuid() }),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ questionnaireSessionId: z.string().uuid() }),
				},
			},
			description: "Prepare an isolated agent Questionnaire flow.",
		},
		404: { description: "Route unavailable" },
	},
});

const prepareAgentScenarioFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/mission-pilot-agent-scenario",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						taskId: z.string().uuid(),
						scenario: z.enum([
							"autopilot",
							"repair",
							"restart",
							"user-interruption",
						]),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ sessionId: z.string().uuid() }),
				},
			},
			description: "Prepare a deterministic Mission Pilot Agent scenario.",
		},
		404: { description: "Route unavailable" },
	},
});
const restartAgentRuntimeFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/mission-pilot-agent-runtime-restart",
	request: {
		body: {
			content: {
				"application/json": { schema: z.object({ taskId: z.string().uuid() }) },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ sessionId: z.string().uuid() }),
				},
			},
			description: "Expire and reconcile an Agent runtime lease.",
		},
		404: { description: "Route unavailable" },
	},
});
export const missionPilotAgentFixtureRouter = createOpenApiRouter().openapi(
	prepareAgentQuestionnaireFixtureRoute,
	async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		)
			return c.json({ error: "Not found" }, 404);
		const { taskId } = c.req.valid("json");
		const [task, pilot] = await Promise.all([
			repo.getTask(taskId),
			missionPilotRepo.getSessionByTaskId(taskId),
		]);
		if (
			!task ||
			!pilot ||
			pilot.desiredState !== "stopped" ||
			!(await isMissionPilotAgentSession(pilot.id))
		)
			return c.json({ error: "Agent Mission Pilot not found" }, 404);

		const questionnaire = await createDesignQuestionnaireSession({
			taskId,
			repositoryId: task.repositoryId,
			status: "draft",
		});
		await createDesignQuestionnaireQuestionSet({
			sessionId: questionnaire.id,
			sequence: 1,
			validationStatus: "valid",
			rawOutput: null,
			questionnaireJson: buildQuestionnaire(taskId, task.repositoryId),
		});
		await updateDesignQuestionnaireSessionStatus(questionnaire.id, "answering");
		registerFixtureProviderToolTurns(taskId, [
			{
				content: "現在のTaskとQuestionnaireを確認します。",
				toolCalls: [
					{
						id: "agent-questionnaire-read",
						name: "read_task_workspace",
						arguments: {},
					},
				],
			},
			{
				content: "既存規約に合うRESTを回答案として保存します。",
				toolCalls: [
					{
						id: "agent-questionnaire-draft",
						name: "questionnaire_draft_save",
						arguments: {
							expectedTaskRevision: task.revision,
							questionnaireSessionId: questionnaire.id,
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
									reason:
										"Projectの既存規約とHTTP APIに合うためRESTを選択します。",
								},
							],
						},
					},
				],
			},
			{
				content: "Questionnaire回答の自動確定を確認しました。",
				toolCalls: [],
			},
		]);
		return c.json({ questionnaireSessionId: questionnaire.id }, 201);
	},
);

missionPilotAgentFixtureRouter.openapi(
	prepareAgentScenarioFixtureRoute,
	async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		)
			return c.json({ error: "Not found" }, 404);
		const { taskId, scenario } = c.req.valid("json");
		const [task, pilot] = await Promise.all([
			repo.getTask(taskId),
			missionPilotRepo.getSessionByTaskId(taskId),
		]);
		if (
			!task ||
			!pilot ||
			pilot.desiredState !== "stopped" ||
			!(await isMissionPilotAgentSession(pilot.id))
		)
			return c.json({ error: "Agent Mission Pilot not found" }, 404);
		registerFixtureProviderToolTurns(taskId, buildAgentScenarioTurns(scenario));
		return c.json({ sessionId: pilot.id }, 201);
	},
);

missionPilotAgentFixtureRouter.openapi(
	restartAgentRuntimeFixtureRoute,
	async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		)
			return c.json({ error: "Not found" }, 404);
		const { taskId } = c.req.valid("json");
		const pilot = await missionPilotRepo.getSessionByTaskId(taskId);
		if (
			pilot?.desiredState !== "playing" ||
			!(await isMissionPilotAgentSession(pilot.id))
		)
			return c.json({ error: "Agent Mission Pilot not found" }, 404);
		const [agent] = await db
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, pilot.id));
		if (!agent || agent.runtimeState === "completed")
			return c.json({ error: "Agent runtime cannot be restarted" }, 404);
		const turnId = crypto.randomUUID();
		const now = new Date();
		await db.transaction(async (tx) => {
			await tx.insert(missionPilotAgentTurns).values({
				id: turnId,
				sessionId: pilot.id,
				turnIndex: agent.nextTurnIndex,
				status: "running",
				startedAt: new Date(now.getTime() - 10_000),
			});
			await tx
				.update(missionPilotAgentSessions)
				.set({
					runtimeState: "running",
					currentTurnId: turnId,
					leaseOwner: "expired-e2e-runtime",
					leaseExpiresAt: new Date(0),
					nextTurnIndex: agent.nextTurnIndex + 1,
					updatedAt: now,
				})
				.where(eq(missionPilotAgentSessions.sessionId, pilot.id));
		});
		await reconcileInterruptedMissionPilotAgentSessions(now);
		await appendMissionPilotTaskEvent({
			taskId,
			eventType: "mission_pilot.resume_requested",
			sourceEventId: `e2e-runtime-restart:${turnId}`,
			taskRevision: pilot.version,
			payload: { reason: "e2e_runtime_restart", expiredTurnId: turnId },
		});
		scheduleMissionPilotAgentWake({ sessionId: pilot.id });
		return c.json({ sessionId: pilot.id }, 200);
	},
);

function buildQuestionnaire(taskId: string, repositoryId: string) {
	return {
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
	};
}

type AgentScenario = "autopilot" | "repair" | "restart" | "user-interruption";
type FixtureArguments = Record<string, unknown>;
const taskRevision = { $fixture: "taskRevision" };
const latestRunId = { $fixture: "latestRunId" };

function buildAgentScenarioTurns(scenario: AgentScenario) {
	if (scenario === "user-interruption")
		return [
			turn("user-read-1", "Taskの現在状態を確認します。", [
				readTask("user-read-tool-1"),
			]),
			turn("user-message-1", "ユーザーへ確認事項を送ります。", [
				action("user-message-1", "task_message_send", {
					expectedTaskRevision: taskRevision,
					content: "追加の指示があれば教えてください。",
				}),
			]),
			turn("user-wait-1", "ユーザーからの追加指示を待ちます。", [
				control("user-wait-1", "agent.wait_for_event", {
					eventTypes: ["task.user_message_added"],
					reason: "ユーザーの追加指示を受け取るまで待ちます。",
				}),
			]),
			turn("user-read-2", "追加指示を読み直します。", [
				readTask("user-read-tool-2"),
			]),
			turn("user-message-2", "追加指示を反映しました。", [
				action("user-message-2", "task_message_send", {
					expectedTaskRevision: taskRevision,
					content: "追加指示を受け取り、現在の判断へ反映しました。",
				}),
			]),
			turn(
				"user-message-2-retry",
				"最新のTask revisionを再確認して追加指示を反映しました。",
				[
					action("user-message-2-retry", "task_message_send", {
						expectedTaskRevision: taskRevision,
						content: "追加指示を受け取り、現在の判断へ反映しました。",
					}),
				],
				"previous_tool_failed",
			),
		];
	if (scenario === "repair")
		return [
			turn("repair-read-1", "Taskと実行可能な操作を確認します。", [
				readTask("repair-read-tool-1"),
			]),
			turn("repair-run-1", "最初の実装依頼を送ります。", [
				action("repair-run-1", "run_implementation_start", {
					expectedTaskRevision: taskRevision,
					request: "[fixture:tool_failure] 最初の実装を実行してください。",
				}),
			]),
			turn("repair-wait-1", "失敗したRunの完了イベントを待ちます。", [
				control("repair-wait-1", "agent.wait_for_event", {
					eventTypes: ["task_run.failed"],
					reason: "失敗したRunのterminal outcomeを確認してから修正します。",
				}),
			]),
			turn("repair-read-2", "失敗したRunの結果を読み、原因を確認します。", [
				readTask("repair-read-tool-2"),
			]),
			turn("repair-run-2", "失敗結果を踏まえた一回目の修正依頼を送ります。", [
				action("repair-run-2", "run_implementation_start", {
					expectedTaskRevision: taskRevision,
					request:
						"[fixture:tool_failure] 一回目の失敗原因を修正して再実行してください。",
					repairRequest: {
						goal: "Taskの受入条件を満たす実装に修正する。",
						observedProblem: "最初の実装Runが失敗した。",
						failure: {
							kind: "runtime_failure",
							message: "fixture failure",
							sourceRunId: latestRunId,
						},
						canonicalRefs: [],
						requestedOutcome: "実装と検証を成功させる。",
						preserve: ["Task Goal"],
						verification: ["fixture verification"],
						priorAttemptRefs: [],
					},
				}),
			]),
			turn("repair-wait-2", "一回目の修正Runの完了イベントを待ちます。", [
				control("repair-wait-2", "agent.wait_for_event", {
					eventTypes: ["task_run.failed"],
					reason: "一回目の修正結果を確認してから次の判断をします。",
				}),
			]),
			turn("repair-read-3", "一回目の修正が失敗した原因を再調査します。", [
				readTask("repair-read-tool-3"),
			]),
			turn("repair-run-3", "再調査結果を踏まえた二回目の修正依頼を送ります。", [
				action("repair-run-3", "run_implementation_start", {
					expectedTaskRevision: taskRevision,
					request:
						"[fixture:success] 二回目の失敗原因を踏まえ、別の修正方針で実装と検証を完了してください。",
					repairRequest: {
						goal: "Taskの受入条件を満たす実装に修正する。",
						observedProblem:
							"一回目の修正Runでも失敗したため、別の原因を調査した。",
						failure: {
							kind: "runtime_failure",
							message: "second fixture failure",
							sourceRunId: latestRunId,
						},
						canonicalRefs: [],
						requestedOutcome: "別の修正方針で実装と検証を成功させる。",
						preserve: ["Task Goal"],
						verification: ["fixture verification after second repair"],
						priorAttemptRefs: ["repair-run-2"],
					},
				}),
			]),
			turn("repair-wait-3", "二回目の修正Runの完了イベントを待ちます。", [
				control("repair-wait-3", "agent.wait_for_event", {
					eventTypes: ["task_run.terminal"],
					reason: "二回目の修正後のterminal outcomeを確認してから完了します。",
				}),
			]),
			turn("repair-read-4", "二回目の修正Runのterminal outcomeを確認します。", [
				readTask("repair-read-tool-4"),
			]),
			...completionTurns("repair"),
		];
	if (scenario === "restart")
		return [
			turn(
				"restart-checkpoint",
				"再起動前のconversation checkpointを保存しました。",
				[],
			),
			turn(
				"restart-read-1",
				"再起動後にTask Goalと現在のFactを再取得します。",
				[readTask("restart-read-tool-1")],
			),
			turn("restart-run-1", "再構成したsessionから実装を依頼します。", [
				action("restart-run-1", "run_implementation_start", {
					expectedTaskRevision: taskRevision,
					request:
						"[fixture:success] 再起動後もTask Goalを実装し、検証してください。",
				}),
			]),
			turn("restart-wait-1", "再起動後に開始したRunの終了を待ちます。", [
				control("restart-wait-1", "agent.wait_for_event", {
					eventTypes: ["task_run.terminal"],
					reason: "terminal outcomeを確認してからTaskを完了します。",
				}),
			]),
			turn("restart-read-2", "再起動後のRun結果を確認します。", [
				readTask("restart-read-tool-2"),
			]),
			...completionTurns("restart"),
		];
	return [
		turn(`${scenario}-read-1`, "Task Goalと現在のFactを確認します。", [
			readTask(`${scenario}-read-tool-1`),
		]),
		turn(`${scenario}-run-1`, "必要な実装をCoding Agentへ依頼します。", [
			action(`${scenario}-run-1`, "run_implementation_start", {
				expectedTaskRevision: taskRevision,
				request: "[fixture:success] Task Goalを実装し、検証してください。",
			}),
		]),
		turn(`${scenario}-wait-1`, "Runの完了イベントを待ちます。", [
			control(`${scenario}-wait-1`, "agent.wait_for_event", {
				eventTypes: ["task_run.terminal"],
				reason: "terminal outcomeを確認してからTaskを完了します。",
			}),
		]),
		turn(`${scenario}-read-2`, "Runの結果とTaskの現在状態を確認します。", [
			readTask(`${scenario}-read-tool-2`),
		]),
		...completionTurns(scenario),
	];
}

function completionTurns(prefix: string) {
	return [
		turn(
			`${prefix}-complete`,
			"terminal outcomeを確認したのでTaskを完了します。",
			[
				action(`${prefix}-complete`, "task_complete", {
					expectedTaskRevision: taskRevision,
					sourceRunId: latestRunId,
				}),
			],
		),
		turn(
			`${prefix}-complete-retry`,
			"完了条件を再確認してTaskを完了します。",
			[
				action(`${prefix}-complete-retry`, "task_complete", {
					expectedTaskRevision: taskRevision,
					sourceRunId: latestRunId,
				}),
			],
			"previous_tool_failed",
		),
		turn(`${prefix}-finish`, "完了結果を確認し、Agent sessionを終了します。", [
			control(`${prefix}-finish`, "agent.finish", {
				summary:
					"Task Goalを満たすterminal outcomeを確認し、Taskを完了しました。",
			}),
		]),
	];
}

function readTask(id: string) {
	return tool(id, "read_task_workspace", {});
}

function action(id: string, name: string, argumentsValue: FixtureArguments) {
	return tool(id, name, argumentsValue);
}

function control(id: string, name: string, argumentsValue: FixtureArguments) {
	return tool(id, name, argumentsValue);
}

function tool(id: string, name: string, argumentsValue: FixtureArguments) {
	return { id, name, arguments: argumentsValue };
}

function turn(
	_id: string,
	content: string,
	toolCalls: ReturnType<typeof tool>[],
	condition?: "previous_tool_failed",
) {
	return { content, toolCalls, ...(condition ? { condition } : {}) };
}
