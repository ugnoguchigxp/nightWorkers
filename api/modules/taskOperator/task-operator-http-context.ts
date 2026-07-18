import type {
	TaskOperatorCommandContext,
	TaskOperatorQueryContext,
} from "../../../shared/modules/taskOperator";

const LOCAL_TASK_OPERATOR_ACTOR_ID = "local-task-operator-user";

export function humanTaskOperatorQueryContext(
	userId?: string,
): TaskOperatorQueryContext {
	const actorId = userId || LOCAL_TASK_OPERATOR_ACTOR_ID;
	return {
		principal: {
			kind: "human",
			actorId,
			authorizationRef: userId ? `authenticated-user:${actorId}` : "local-user",
		},
	};
}

export function humanTaskOperatorCommandContext(input: {
	userId?: string;
	idempotencyKey?: string;
}): TaskOperatorCommandContext {
	const requestId = input.idempotencyKey || crypto.randomUUID();
	return {
		...humanTaskOperatorQueryContext(input.userId),
		requestId,
		idempotencyKey: requestId,
	};
}
