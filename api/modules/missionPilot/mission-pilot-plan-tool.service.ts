import {
	type MissionPilotPlanRoutingToolCall,
	missionPilotPlanRoutingToolCallSchema,
} from "../../../shared/schemas/plan-mode-routing.schema";
import { executeMissionPilotPlanRoutingTool } from "./planning/plan-mode-routing.service";

type ToolHandler = (
	taskId: string,
	call: MissionPilotPlanRoutingToolCall,
) => Promise<unknown>;

const PLAN_TOOL_REGISTRY: Record<
	MissionPilotPlanRoutingToolCall["tool"],
	ToolHandler
> = {
	edit_plan_artifact_routing: executeMissionPilotPlanRoutingTool,
};

export async function dispatchMissionPilotPlanToolCall(
	taskId: string,
	input: unknown,
) {
	const call = missionPilotPlanRoutingToolCallSchema.parse(input);
	return PLAN_TOOL_REGISTRY[call.tool](taskId, call);
}
