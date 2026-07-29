import { planModeRoutingTerminalReason } from "../../agentsShare";
import {
	humanTaskOperatorQueryContext,
	readTaskOperatorProjection,
} from "../../taskOperator";

export { planModeRoutingTerminalReason } from "../../agentsShare";

export async function readPlanModeRoutingLockedReason(taskId: string) {
	const projection = await readTaskOperatorProjection(
		taskId,
		humanTaskOperatorQueryContext(),
	);
	return planModeRoutingTerminalReason(projection.task.status);
}
