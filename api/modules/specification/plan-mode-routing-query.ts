import type { PlanModeRoutingSnapshot } from "../../../shared/schemas/plan-mode-routing.schema";
import { readGeneralSettings } from "../../services/settings/general-settings";
import {
	buildInitialPlanModeRoutingEntries,
	readPlanModeRouting,
} from "../agentsShare";
import {
	listPlanModeTaskMessages,
	type PlanModeTask,
} from "../nightworkers/nightworkers.plan-mode-core.port";

export async function resolvePlanModeRoutingSnapshot(
	task: PlanModeTask,
): Promise<PlanModeRoutingSnapshot> {
	const registered = await readPlanModeRouting({
		taskId: task.id,
		taskStatus: task.status,
	});
	if (registered) return registered;
	const messages = await listPlanModeTaskMessages(task.id);
	return {
		revision: 0,
		entries: buildInitialPlanModeRoutingEntries(
			messages,
			readGeneralSettings().planMode.capabilities,
		),
		editable: true,
		lockedReason: null,
		updatedBy: null,
		updatedAt: null,
	};
}
