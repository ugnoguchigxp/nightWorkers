import { describe, expect, it } from "vitest";
import { MISSION_PILOT_AGENT_CONTROL_TOOL_DEFINITIONS } from "../api/modules/missionPilot/agent/mission-pilot-agent-control-tools";
import {
	getMissionPilotActionDefinition,
	getMissionPilotActionUnavailableReason,
	missionPilotActionToolDefinitions,
} from "../api/modules/missionPilot/agent/mission-pilot-task-action.registry";
import { projectMissionPilotAgentVisibleItems } from "../api/modules/missionPilot/mission-pilot-execution-query.service";

describe("Mission Pilot autonomous agent hardening contract", () => {
	it("uses registry execution metadata instead of runtime action-name wait lists", () => {
		expect(
			getMissionPilotActionDefinition("run.implementation.start"),
		).toMatchObject({
			execution: {
				effect: "mutation",
				completion: "wait_for_event",
				expectedEventTypes: expect.arrayContaining(["task_run.terminal"]),
				reconciliation: "query_resource",
			},
		});
		expect(
			getMissionPilotActionDefinition("task.message.send")?.execution,
		).toMatchObject({
			completion: "immediate",
		});
	});

	it("exposes explicit wait and finish controls alongside registered actions", () => {
		const names = [
			...missionPilotActionToolDefinitions().map((tool) => tool.name),
			...MISSION_PILOT_AGENT_CONTROL_TOOL_DEFINITIONS.map((tool) => tool.name),
		];
		expect(names).toContain("agent.wait_for_event");
		expect(names).toContain("agent.finish");
	});

	it("requires the Questionnaire intervention timer before submission", () => {
		expect(
			missionPilotActionToolDefinitions().map((tool) => tool.name),
		).not.toContain("questionnaire_submit");
		expect(
			getMissionPilotActionUnavailableReason("questionnaire.submit"),
		).toContain("20秒");
	});

	it("projects only visible assistant messages and control states", () => {
		expect(
			projectMissionPilotAgentVisibleItems([
				{
					kind: "assistant",
					sequence: 1,
					bodyJson: {
						content: "ユーザーへ進捗を通知しました。",
						reasoning: "hidden",
					},
				},
				{
					kind: "tool_call",
					sequence: 2,
					bodyJson: { content: "internal" },
				},
				{
					kind: "tool_result",
					sequence: 3,
					bodyJson: {
						content: JSON.stringify({
							ok: true,
							data: {
								kind: "wait_for_event",
								eventTypes: ["task_run.terminal"],
								reason: "Runの終了を待ちます。",
							},
						}),
					},
				},
			]),
		).toEqual([
			{
				kind: "assistant",
				sequence: 1,
				content: "ユーザーへ進捗を通知しました。",
			},
			{
				kind: "wait",
				sequence: 3,
				eventTypes: ["task_run.terminal"],
				reason: "Runの終了を待ちます。",
			},
		]);
	});
});
