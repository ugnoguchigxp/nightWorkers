import type { TaskOperatorCommandContext } from "../../../../shared/modules/taskOperator";

export function taskOperatorRequestProvenance(
	context: TaskOperatorCommandContext,
) {
	return {
		requestedBy: {
			kind:
				context.principal.kind === "delegated_user"
					? ("automation" as const)
					: context.principal.kind,
			actorId: context.principal.actorId,
		},
		orchestrationRef: {
			kind: "task_operator_command",
			id: context.idempotencyKey,
		},
	};
}
