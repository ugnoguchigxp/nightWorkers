import { z } from "@hono/zod-openapi";
import type {
	MissionPilotActionFailure,
	MissionPilotTaskEventType,
} from "../../../contracts";
import {
	MISSION_PILOT_TASK_EVENT_TYPES,
	missionPilotTaskEventTypeSchema,
} from "../../../contracts";
import type { ProviderToolCall } from "../../../services/structured-llm/public";
import { callMissionPilotPersistence } from "../../persistence-port";

export const MISSION_PILOT_AGENT_CONTROL_TOOL_DEFINITIONS = [
	{
		name: "agent.wait_for_event",
		description:
			"明示したtask eventが到着するまで、このturnをwait状態にする。ユーザーへ見えるmessage送信など必要な前処理を同じturnで完了してから呼ぶ。",
		inputSchema: {
			type: "object",
			properties: {
				eventTypes: {
					type: "array",
					items: {
						type: "string",
						enum: MISSION_PILOT_TASK_EVENT_TYPES,
					},
					minItems: 1,
				},
				reason: { type: "string", minLength: 1 },
			},
			required: ["eventTypes", "reason"],
			additionalProperties: false,
		},
	},
	{
		name: "agent.finish",
		description:
			"現在のTask目的が達成されたと判断し、未確定receipt・未処理event・未完了tool callがないときにMission Pilotを完了する。",
		inputSchema: {
			type: "object",
			properties: { summary: { type: "string", minLength: 1 } },
			required: ["summary"],
			additionalProperties: false,
		},
	},
] as const;

export type MissionPilotAgentControlResult =
	| {
			ok: true;
			actionId: "agent.wait_for_event";
			data: unknown;
			directive: "wait";
			waitFor: MissionPilotTaskEventType[];
	  }
	| {
			ok: true;
			actionId: "agent.finish";
			data: unknown;
			directive: "finish";
	  }
	| { ok: false; failure: MissionPilotActionFailure; directive: "continue" };

export function executeMissionPilotAgentControlTool(input: {
	call: ProviderToolCall;
	toolCallId: string;
	turnId?: string;
	leaseOwner: string;
	sessionId: string;
	taskId: string;
}): Promise<MissionPilotAgentControlResult> {
	return callMissionPilotPersistence(
		"executeMissionPilotAgentControlTool",
		input,
	);
}

export function isMissionPilotAgentControlTool(name: string) {
	return name === "agent.wait_for_event" || name === "agent.finish";
}

export function readMissionPilotAgentControlEventTypes(value: unknown) {
	const parsed = z.array(missionPilotTaskEventTypeSchema).safeParse(value);
	return parsed.success ? (parsed.data as MissionPilotTaskEventType[]) : null;
}
