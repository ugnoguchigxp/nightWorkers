import { describe, expect, it } from "vitest";
import { MISSION_PILOT_AGENT_CONTROL_TOOL_DEFINITIONS } from "../api/modules/missionPilot/agent/mission-pilot-agent-control-tools";
import {
	getMissionPilotActionDefinition,
	getMissionPilotActionUnavailableReason,
} from "../api/modules/missionPilot/agent/mission-pilot-task-action.registry";
import { missionPilotToolDefinitions } from "../api/modules/missionPilot/agent/mission-pilot-tools";
import { projectMissionPilotAgentVisibleItems } from "../api/modules/missionPilot/mission-pilot-execution-query.service";
import {
	applyCurrentMissionPilotSystemContext,
	getMissionPilotPlanEntryContext,
	getMissionPilotSystemContext,
} from "../api/modules/missionPilot/prompts/mission-pilot-system-context";
import { MISSION_PILOT_TASK_EVENT_TYPES } from "../shared/modules/missionPilot/mission-pilot-agent.schema";

describe("Mission Pilot autonomous agent hardening contract", () => {
	it("owns Questionnaire, routing, and Artifact decisions", () => {
		const planEntryContext = getMissionPilotPlanEntryContext();
		const systemContext = getMissionPilotSystemContext();
		expect(systemContext).toContain(planEntryContext);
		expect(systemContext).toContain("QuestionnaireとArtifactを所有");
		expect(systemContext).toContain("read_task_operator_view");
		expect(systemContext).toContain("read_task_resource");
		expect(
			getMissionPilotActionUnavailableReason("questionnaire.create"),
		).toBeNull();
		expect(applyCurrentMissionPilotSystemContext("保存済みの旧Context")).toBe(
			`保存済みの旧Context\n${planEntryContext}`,
		);
		expect(applyCurrentMissionPilotSystemContext(systemContext)).toBe(
			systemContext,
		);
	});

	it("uses registry execution metadata instead of runtime action-name wait lists", () => {
		expect(
			getMissionPilotActionDefinition("task.update")?.inputSchema.properties,
		).not.toHaveProperty("expectedTaskRevision");
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
		expect(
			getMissionPilotActionDefinition("questionnaire.review.accept")?.execution,
		).toMatchObject({
			completion: "wait_for_event",
			expectedEventTypes: expect.arrayContaining([
				"questionnaire.state_changed",
			]),
			reconciliation: "query_resource",
		});
		expect(
			getMissionPilotActionDefinition("questionnaire.additional.generate")
				?.execution,
		).toMatchObject({
			completion: "immediate",
			expectedEventTypes: [],
			reconciliation: "query_receipt",
		});
		expect(
			getMissionPilotActionDefinition("background_process.stop")?.execution,
		).toMatchObject({
			completion: "immediate",
			expectedEventTypes: [],
			reconciliation: "query_receipt",
		});
		expect(
			getMissionPilotActionDefinition("run.stop")?.execution,
		).toMatchObject({
			completion: "immediate",
			expectedEventTypes: [],
			reconciliation: "query_receipt",
		});
	});

	it("exposes explicit wait and finish controls alongside registered actions", () => {
		const names = missionPilotToolDefinitions().map((tool) => tool.name);
		expect(names).toContain("agent.wait_for_event");
		expect(names).toContain("agent.finish");
		const waitTool = MISSION_PILOT_AGENT_CONTROL_TOOL_DEFINITIONS.find(
			(tool) => tool.name === "agent.wait_for_event",
		);
		expect(waitTool?.inputSchema.properties.eventTypes.items.enum).toEqual(
			MISSION_PILOT_TASK_EVENT_TYPES,
		);
	});

	it("exposes Questionnaire submission through the same Task action contract as the user", () => {
		expect(
			getMissionPilotActionUnavailableReason("questionnaire.submit"),
		).toBeNull();
		expect(missionPilotToolDefinitions().map((tool) => tool.name)).toEqual([
			"read_task_operator_view",
			"read_task_resource",
			"list_available_task_actions",
			"read_task_action_contract",
			"execute_task_action",
			"agent.wait_for_event",
			"agent.finish",
		]);
		const executeTool = missionPilotToolDefinitions().find(
			(tool) => tool.name === "execute_task_action",
		);
		expect(executeTool?.inputSchema.properties).toHaveProperty(
			"expectedTaskRevision",
		);
		expect(executeTool?.inputSchema.properties).not.toHaveProperty(
			"expectedResourceRevision",
		);
		const resourceTool = missionPilotToolDefinitions().find(
			(tool) => tool.name === "read_task_resource",
		);
		expect(resourceTool?.inputSchema.properties.resourceKind.enum).toEqual(
			expect.arrayContaining(["task_text", "task_message", "run_outcome"]),
		);
	});

	it("projects visible assistant messages, requested actions, and control states", () => {
		expect(
			projectMissionPilotAgentVisibleItems([
				{
					kind: "assistant",
					sequence: 1,
					bodyJson: {
						content: "ユーザーへ進捗を通知しました。",
						reasoning: "hidden",
						toolCalls: [
							{
								id: "call-1",
								name: "execute_task_action",
								arguments: {
									actionId: "task.update",
									arguments: {
										fields: { title: "hidden from projection" },
									},
								},
							},
						],
					},
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
				kind: "action_requested",
				sequence: 1,
				actionId: "task.update",
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
