import { useCallback } from "react";
import type {
	EditablePlanModeRoutingView,
	PlanModeRoutingSnapshot,
} from "../../../shared/schemas/plan-mode-routing.schema";
import { updatePlanModeRouting } from "../specification";
import type { PlanWorkspaceActionResult } from "./PlanModeWorkspace.controller";

export function usePlanModeRoutingEditor(input: {
	sessionId: string | null;
	routing: PlanModeRoutingSnapshot | undefined;
	runAction: (
		action: string,
		fn: () => Promise<PlanWorkspaceActionResult>,
	) => Promise<boolean>;
}) {
	return useCallback(
		async (view: EditablePlanModeRoutingView, decision: "include" | "omit") => {
			if (!input.sessionId || !input.routing) return;
			await input.runAction(`routing:${view}`, async () => {
				const response = await updatePlanModeRouting(
					input.sessionId as string,
					{
						expectedRevision: input.routing?.revision ?? 0,
						idempotencyKey: crypto.randomUUID(),
						changes: [{ view, decision }],
					},
				);
				if (!response.ok) throw new Error(await response.text());
				return undefined;
			});
		},
		[input.routing, input.runAction, input.sessionId],
	);
}
