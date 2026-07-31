import { describe, expect, it } from "vitest";
import "./helpers/mission-pilot-runtime";
import {
	buildAgentScenarioTurns,
	buildQuestionnaireFixtureTurns,
} from "@nightworkers/mission-pilot/testing";

describe("Mission Pilot fixture catalog migration", () => {
	it("preserves Questionnaire assistant bytes and tool structure", () => {
		const turns = buildQuestionnaireFixtureTurns({
			taskRevision: 7,
			questionnaireSessionId: "questionnaire-1",
		});
		expect(turns.map((turn) => turn.content)).toEqual([
			"現在のTaskとQuestionnaireを確認します。",
			"既存規約に合うRESTを回答として送信します。",
			"Questionnaire回答の自動確定を確認しました。",
		]);
		expect(turns.map((turn) => turn.toolCalls.map((call) => call.id))).toEqual([
			["agent-questionnaire-read"],
			["agent-questionnaire-submit"],
			[],
		]);
		expect(turns[1]?.toolCalls[0]?.arguments).toMatchObject({
			actionId: "questionnaire.submit",
			expectedTaskRevision: 7,
			arguments: { questionnaireSessionId: "questionnaire-1" },
		});
	});

	it.each([
		[
			"autopilot",
			[
				"autopilot-read-tool-1",
				"autopilot-run-1",
				"autopilot-wait-1",
				"autopilot-read-tool-2",
				"autopilot-complete",
				"autopilot-complete-retry",
				"autopilot-finish",
				"autopilot-finish-wait",
				"autopilot-finish-retry",
			],
		],
		[
			"restart",
			[
				null,
				"restart-read-tool-1",
				"restart-run-1",
				"restart-wait-1",
				"restart-read-tool-2",
				"restart-complete",
				"restart-complete-retry",
				"restart-finish",
				"restart-finish-wait",
				"restart-finish-retry",
			],
		],
		[
			"user-interruption",
			[
				"user-read-tool-1",
				"user-message-1",
				"user-wait-1",
				"user-read-tool-2",
				"user-message-2",
				"user-message-2-retry",
			],
		],
	] as const)("preserves %s turn order and tool IDs", (scenario, expectedIds) => {
		const turns = buildAgentScenarioTurns(scenario);
		expect(turns.map((turn) => turn.toolCalls[0]?.id ?? null)).toEqual(
			expectedIds,
		);
		expect(turns.every((turn) => !turn.content.endsWith("\n"))).toBe(true);
	});

	it("preserves repair conditions and all three implementation attempts", () => {
		const turns = buildAgentScenarioTurns("repair");
		expect(
			turns
				.flatMap((turn) => turn.toolCalls)
				.filter(
					(call) => call.arguments.actionId === "run.implementation.start",
				)
				.map((call) => call.id),
		).toEqual(["repair-run-1", "repair-run-2", "repair-run-3"]);
		expect(
			turns.filter((turn) => turn.condition === "previous_tool_failed"),
		).toHaveLength(2);
	});
});
