import {
	TASK_OPERATOR_ACTION_DEFINITIONS,
	type TaskOperatorActionDefinition,
	validateTaskOperatorJsonSchema,
} from "../../taskOperator";
import { missionPilotActionUnavailableReasons } from "./mission-pilot-task-action-unavailable";

export type MissionPilotActionDefinition = TaskOperatorActionDefinition;

export const MISSION_PILOT_ACTION_DEFINITIONS =
	TASK_OPERATOR_ACTION_DEFINITIONS;
const byActionId = new Map(
	TASK_OPERATOR_ACTION_DEFINITIONS.map((entry) => [entry.actionId, entry]),
);

export function getMissionPilotActionDefinition(actionId: string) {
	return byActionId.get(actionId) ?? null;
}

export function getMissionPilotActionUnavailableReason(actionId: string) {
	return missionPilotActionUnavailableReasons.get(actionId) ?? null;
}

export function validateMissionPilotActionArguments(
	definition: Pick<TaskOperatorActionDefinition, "inputSchema">,
	value: unknown,
):
	| { success: true; data: Record<string, unknown> }
	| { success: false; message: string } {
	const result = validateTaskOperatorJsonSchema(definition.inputSchema, value);
	return result === null &&
		value &&
		typeof value === "object" &&
		!Array.isArray(value)
		? { success: true, data: value as Record<string, unknown> }
		: { success: false, message: result ?? "arguments must be an object" };
}
