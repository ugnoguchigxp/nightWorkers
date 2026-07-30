import {
	type PlanModeRoutingSnapshot,
	planModeRoutingChangedRealtimePayloadSchema,
} from "../../../shared/schemas/plan-mode-routing.schema";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";

export function publishPlanModeRoutingChanged(
	taskId: string,
	routing: PlanModeRoutingSnapshot,
) {
	if (!routing.updatedBy) return;
	nightWorkersRealtimeBroker.publish(taskId, {
		type: "plan_mode.routing_changed",
		payload: planModeRoutingChangedRealtimePayloadSchema.parse({
			taskId,
			revision: routing.revision,
			updatedBy: routing.updatedBy,
		}),
	});
}
