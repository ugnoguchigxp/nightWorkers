import { createHash } from "node:crypto";
import type { TaskOperatorPrincipal } from "../../../../shared/modules/taskOperator";
import { AppError } from "../../../lib/errors";
import {
	TASK_OPERATOR_ACTION_DEFINITIONS,
	type TaskOperatorCapability,
} from "./task-operator-action.registry";

export const LOCAL_TASK_OPERATOR_USER_ID = "local-task-operator-user";
export const LOCAL_TASK_OPERATOR_USER_AUTHORIZATION_REF = "local-user";

export const TASK_OPERATOR_USER_CAPABILITIES = Object.freeze(
	Array.from(
		new Set(
			TASK_OPERATOR_ACTION_DEFINITIONS.map(
				(definition) => definition.capability,
			),
		),
	),
);

type DelegatedPrincipal = Extract<
	TaskOperatorPrincipal,
	{ kind: "delegated_user" }
>;

export type TaskOperatorDelegatedAuthorizationPort = {
	authorize(input: {
		principal: DelegatedPrincipal;
		taskId: string;
	}): Promise<{ capabilities: readonly TaskOperatorCapability[] }>;
};

export function readCurrentTaskOperatorUserCapabilities(input: {
	subjectUserId: string;
	authorizationRef: string;
}): readonly TaskOperatorCapability[] {
	return input.subjectUserId === LOCAL_TASK_OPERATOR_USER_ID &&
		input.authorizationRef === LOCAL_TASK_OPERATOR_USER_AUTHORIZATION_REF
		? TASK_OPERATOR_USER_CAPABILITIES
		: [];
}

export function digestTaskOperatorCapabilityGrant(input: {
	subjectUserId: string;
	authorizationRef: string;
	sessionId: string;
	taskId: string;
	grantedAt: string;
	capabilities: readonly TaskOperatorCapability[];
}) {
	const canonical = JSON.stringify({
		subjectUserId: input.subjectUserId,
		authorizationRef: input.authorizationRef,
		sessionId: input.sessionId,
		taskId: input.taskId,
		grantedAt: input.grantedAt,
		capabilities: [...input.capabilities].sort(),
	});
	return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export async function resolveTaskOperatorPrincipalCapabilities(input: {
	principal: TaskOperatorPrincipal;
	taskId: string;
	delegatedAuthorization?: TaskOperatorDelegatedAuthorizationPort;
}): Promise<readonly TaskOperatorCapability[]> {
	if (input.principal.kind !== "delegated_user")
		return readCurrentTaskOperatorUserCapabilities({
			subjectUserId: input.principal.actorId,
			authorizationRef: input.principal.authorizationRef,
		});
	if (input.principal.delegationRef.taskId !== input.taskId)
		throw permissionDenied("Delegation does not belong to the requested Task.");
	if (!input.delegatedAuthorization)
		throw permissionDenied(
			"Delegated Task Operator authorization could not be verified.",
		);
	const authorization = await input.delegatedAuthorization.authorize({
		principal: input.principal,
		taskId: input.taskId,
	});
	const known = new Set(TASK_OPERATOR_USER_CAPABILITIES);
	return authorization.capabilities.filter((capability) =>
		known.has(capability),
	);
}

export function permissionDenied(message: string) {
	return new AppError(403, "TASK_OPERATOR_PERMISSION_DENIED", message);
}
