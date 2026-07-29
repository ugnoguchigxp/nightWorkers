import type {
	TaskOperatorCommandContext,
	TaskOperatorQueryContext,
} from "../../../shared/modules/taskOperator";

const LOCAL_TASK_OPERATOR_ACTOR_ID = "local-task-operator-user";

export function humanTaskOperatorQueryContext(): TaskOperatorQueryContext {
	return {
		principal: {
			kind: "human",
			actorId: LOCAL_TASK_OPERATOR_ACTOR_ID,
			authorizationRef: "local-user",
		},
	};
}

export function humanTaskOperatorCommandContext(input: {
	idempotencyKey?: string;
}): TaskOperatorCommandContext {
	const requestId = input.idempotencyKey || crypto.randomUUID();
	return {
		...humanTaskOperatorQueryContext(),
		requestId,
		idempotencyKey: requestId,
	};
}
