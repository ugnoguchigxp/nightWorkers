import type {
	PlanModeRoutingSnapshot,
	UpdatePlanModeRoutingRequest,
} from "../../../../shared/schemas/plan-mode-routing.schema";

export type PlanModeRoutingUserWriter = (input: {
	taskId: string;
	request: UpdatePlanModeRoutingRequest;
}) => Promise<PlanModeRoutingSnapshot>;

let writer: PlanModeRoutingUserWriter | null = null;

export function registerPlanModeRoutingUserWriter(
	nextWriter: PlanModeRoutingUserWriter,
) {
	writer = nextWriter;
	return () => {
		if (writer === nextWriter) writer = null;
	};
}

export async function writePlanModeRoutingForUser(input: {
	taskId: string;
	request: UpdatePlanModeRoutingRequest;
}) {
	if (!writer) throw new Error("Plan Mode routing writer is not registered.");
	return writer(input);
}
