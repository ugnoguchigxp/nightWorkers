import type { PlanModeRoutingSnapshot } from "../../../shared/schemas/plan-mode-routing.schema";
import type { PlanModeTask } from "../nightworkers/nightworkers.plan-mode-core.port";
import { getPlanModeRouting } from "../planMode";

export async function resolvePlanModeRoutingSnapshot(
	task: PlanModeTask,
): Promise<PlanModeRoutingSnapshot> {
	return getPlanModeRouting(task.id, {
		taskStatus: task.status,
	});
}
