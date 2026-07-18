import type { PlanModeRoutingSnapshot } from "../../../../shared/schemas/plan-mode-routing.schema";

export type PlanModeRoutingReader = (input: {
	taskId: string;
	taskStatus?: string;
}) => Promise<PlanModeRoutingSnapshot>;

let reader: PlanModeRoutingReader | null = null;

export function registerPlanModeRoutingReader(
	nextReader: PlanModeRoutingReader,
) {
	reader = nextReader;
	return () => {
		if (reader === nextReader) reader = null;
	};
}

export async function readPlanModeRouting(input: {
	taskId: string;
	taskStatus?: string;
}) {
	return reader?.(input) ?? null;
}
