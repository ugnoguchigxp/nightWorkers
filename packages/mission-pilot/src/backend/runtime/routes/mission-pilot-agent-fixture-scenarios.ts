import {
	type LlmFixtureKey,
	renderLlmFixtureText,
} from "../../../e2eFixtures/llmCatalog/catalog";
import type { FixtureTurn } from "../../../services/structured-llm/fixture-tool-provider";
import type { ProviderToolCall } from "../../../services/structured-llm/tool-calls";

export type AgentScenario =
	| "autopilot"
	| "repair"
	| "restart"
	| "user-interruption";

type FixtureArguments = Record<string, unknown>;
const taskRevision = { $fixture: "taskRevision" };
const latestRunId = { $fixture: "latestRunId" };

export function buildQuestionnaireFixtureTurns(input: {
	taskRevision: number;
	questionnaireSessionId: string;
}): FixtureTurn[] {
	return [
		turn("missionPilot.questionnaire.read-current", [
			readTask("agent-questionnaire-read"),
		]),
		turn("missionPilot.questionnaire.submit", [
			taskAction(
				"agent-questionnaire-submit",
				"questionnaire.submit",
				input.taskRevision,
				{
					questionnaireSessionId: input.questionnaireSessionId,
					answers: [
						{
							questionId: "api-style",
							selectedOptionIds: ["rest"],
							rankedOptionIds: [],
							deferred: false,
						},
					],
				},
			),
		]),
		turn("missionPilot.questionnaire.confirmed", []),
	];
}

export function buildAgentScenarioTurns(
	scenario: AgentScenario,
): FixtureTurn[] {
	if (scenario === "user-interruption") {
		return [
			turn("missionPilot.userInterruption.read-task", [
				readTask("user-read-tool-1"),
			]),
			turn("missionPilot.userInterruption.send-question", [
				action("user-message-1", "task.message.send", {
					content: "追加の指示があれば教えてください。",
				}),
			]),
			turn("missionPilot.userInterruption.wait-user", [
				control("user-wait-1", "agent.wait_for_event", {
					eventTypes: ["task.user_message_added"],
					reason: "ユーザーの追加指示を受け取るまで待ちます。",
				}),
			]),
			turn("missionPilot.userInterruption.read-message", [
				readTask("user-read-tool-2"),
			]),
			turn("missionPilot.userInterruption.acknowledge", [
				action("user-message-2", "task.message.send", {
					content: "追加指示を受け取り、現在の判断へ反映しました。",
				}),
			]),
			turn(
				"missionPilot.userInterruption.acknowledge-retry",
				[
					action("user-message-2-retry", "task.message.send", {
						content: "追加指示を受け取り、現在の判断へ反映しました。",
					}),
				],
				"previous_tool_failed",
			),
		];
	}
	if (scenario === "repair") {
		return [
			turn("missionPilot.repair.read-task", [readTask("repair-read-tool-1")]),
			turn("missionPilot.repair.start-first-run", [
				action("repair-run-1", "run.implementation.start", {
					request: "[fixture:tool_failure] 最初の実装を実行してください。",
				}),
			]),
			turn("missionPilot.repair.wait-first-run", [
				control("repair-wait-1", "agent.wait_for_event", {
					eventTypes: ["task_run.failed"],
					reason: "失敗したRunのterminal outcomeを確認してから修正します。",
				}),
			]),
			turn("missionPilot.repair.read-first-outcome", [
				readTask("repair-read-tool-2"),
			]),
			turn("missionPilot.repair.start-first-repair", [
				action("repair-run-2", "run.implementation.start", {
					request:
						"[fixture:tool_failure] 一回目の失敗原因を修正して再実行してください。",
				}),
			]),
			turn("missionPilot.repair.wait-first-repair", [
				control("repair-wait-2", "agent.wait_for_event", {
					eventTypes: ["task_run.failed"],
					reason: "一回目の修正結果を確認してから次の判断をします。",
				}),
			]),
			turn("missionPilot.repair.read-second-outcome", [
				readTask("repair-read-tool-3"),
			]),
			turn("missionPilot.repair.start-second-repair", [
				action("repair-run-3", "run.implementation.start", {
					request:
						"[fixture:success] 二回目の失敗原因を踏まえ、別の修正方針で実装と検証を完了してください。",
				}),
			]),
			turn("missionPilot.repair.wait-second-repair", [
				control("repair-wait-3", "agent.wait_for_event", {
					eventTypes: ["task_run.terminal"],
					reason: "二回目の修正後のterminal outcomeを確認してから完了します。",
				}),
			]),
			turn("missionPilot.repair.read-final-outcome", [
				readTask("repair-read-tool-4"),
			]),
			...completionTurns("repair"),
		];
	}
	if (scenario === "restart") {
		return [
			turn("missionPilot.restart.checkpoint", []),
			turn("missionPilot.restart.restore-context", [
				readTask("restart-read-tool-1"),
			]),
			turn("missionPilot.restart.start-run", [
				action("restart-run-1", "run.implementation.start", {
					request:
						"[fixture:success] 再起動後もTask Goalを実装し、検証してください。",
				}),
			]),
			turn("missionPilot.restart.wait-run", [
				control("restart-wait-1", "agent.wait_for_event", {
					eventTypes: ["task_run.terminal"],
					reason: "terminal outcomeを確認してからTaskを完了します。",
				}),
			]),
			turn("missionPilot.restart.read-outcome", [
				readTask("restart-read-tool-2"),
			]),
			...completionTurns("restart"),
		];
	}
	return [
		turn("missionPilot.autopilot.read-task", [
			readTask("autopilot-read-tool-1"),
		]),
		turn("missionPilot.autopilot.start-run", [
			action("autopilot-run-1", "run.implementation.start", {
				request: "[fixture:success] Task Goalを実装し、検証してください。",
			}),
		]),
		turn("missionPilot.autopilot.wait-run", [
			control("autopilot-wait-1", "agent.wait_for_event", {
				eventTypes: ["task_run.terminal"],
				reason: "terminal outcomeを確認してからTaskを完了します。",
			}),
		]),
		turn("missionPilot.autopilot.read-outcome", [
			readTask("autopilot-read-tool-2"),
		]),
		...completionTurns("autopilot"),
	];
}

function completionTurns(
	prefix: "autopilot" | "repair" | "restart",
): FixtureTurn[] {
	const keys = {
		autopilot: {
			complete: "missionPilot.autopilot.complete",
			retry: "missionPilot.autopilot.complete-retry",
			finish: "missionPilot.autopilot.finish",
		},
		repair: {
			complete: "missionPilot.autopilot.complete",
			retry: "missionPilot.autopilot.complete-retry",
			finish: "missionPilot.autopilot.finish",
		},
		restart: {
			complete: "missionPilot.autopilot.complete",
			retry: "missionPilot.autopilot.complete-retry",
			finish: "missionPilot.autopilot.finish",
		},
	} as const;
	return [
		turn(keys[prefix].complete, [
			action(`${prefix}-complete`, "task.complete", {
				sourceRunId: latestRunId,
			}),
		]),
		turn(
			keys[prefix].retry,
			[
				action(`${prefix}-complete-retry`, "task.complete", {
					sourceRunId: latestRunId,
				}),
			],
			"previous_tool_failed",
		),
		turn(keys[prefix].finish, [
			control(`${prefix}-finish`, "agent.finish", {
				summary:
					"Task Goalを満たすterminal outcomeを確認し、Taskを完了しました。",
			}),
		]),
		turn(
			"missionPilot.autopilot.finish-retry",
			[
				control(`${prefix}-finish-retry`, "agent.finish", {
					summary:
						"直前の完了判定を再評価し、Task Goalの達成とTask完了を再確認しました。",
				}),
			],
			"previous_tool_failed",
		),
	];
}

function readTask(id: string) {
	return tool(id, "read_task_operator_view", {});
}

function action(
	id: string,
	actionId: string,
	argumentsValue: FixtureArguments,
) {
	return taskAction(id, actionId, taskRevision, argumentsValue);
}

function control(id: string, name: string, argumentsValue: FixtureArguments) {
	return tool(id, name, argumentsValue);
}

function tool(
	id: string,
	name: string,
	argumentsValue: FixtureArguments,
): ProviderToolCall {
	return { id, name, arguments: argumentsValue };
}

function taskAction(
	id: string,
	actionId: string,
	expectedTaskRevision: unknown,
	argumentsValue: FixtureArguments,
) {
	return tool(id, "execute_task_action", {
		actionId,
		expectedTaskRevision,
		idempotencyKey: `fixture:${id}`,
		arguments: argumentsValue,
	});
}

function turn(
	contentKey: LlmFixtureKey,
	toolCalls: ProviderToolCall[],
	condition?: "previous_tool_failed",
): FixtureTurn {
	return {
		content: renderLlmFixtureText(contentKey, {}),
		toolCalls,
		...(condition ? { condition } : {}),
	};
}
