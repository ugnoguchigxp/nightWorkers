import type {
	TaskOperatorCommandContext,
	TaskOperatorQueryContext,
} from "../../../shared/modules/taskOperator";
import {
	LOCAL_TASK_OPERATOR_USER_AUTHORIZATION_REF,
	LOCAL_TASK_OPERATOR_USER_ID,
} from "./policies/task-operator-authorization";

export function humanTaskOperatorPrincipal() {
	return {
		kind: "human" as const,
		actorId: LOCAL_TASK_OPERATOR_USER_ID,
		authorizationRef: LOCAL_TASK_OPERATOR_USER_AUTHORIZATION_REF,
	};
}

export function humanTaskOperatorQueryContext(): TaskOperatorQueryContext {
	return {
		principal: humanTaskOperatorPrincipal(),
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
