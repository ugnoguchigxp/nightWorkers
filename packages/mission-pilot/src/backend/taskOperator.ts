import { callMissionPilotHost } from "./host-bindings";

// These are public Task Operator resource identifiers, copied as a stable wire contract.
export const TASK_OPERATOR_RESOURCE_KINDS = [
	"task_text",
	"task_timeline",
	"task_message",
	"artifact_index",
	"artifact",
	"questionnaire",
	"questionnaire_decisions",
	"run_outcome",
	"current_todo",
	"queue",
] as const;

export type TaskOperatorActionDefinition = {
	actionId: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execution?: { completion?: string };
};

export type TaskOperatorProjectionV1 = {
	task: { id: string; revision: number; status: string };
	project: { id: string };
	sourceDigest: string;
	questionnaire: { id: string; revision: number } | null;
	activeRun: {
		id: string;
		revision: number;
		status: string;
		currentTodoRef: {
			id: string;
			revision: number;
			status: string;
			blockerDigest: string | null;
		} | null;
	} | null;
	latestTerminalRun: {
		id: string;
		revision: number;
		status: string;
	} | null;
	commandCatalog: { availableIds: string[] };
	[key: string]: unknown;
};
export type TaskOperatorPrincipal =
	| {
			kind: "human";
			actorId: string;
			authorizationRef: string;
	  }
	| {
			kind: "delegated_user";
			actorId: string;
			authorizationRef: string;
			subjectUserId: string;
			delegationRef: {
				sessionId: string;
				taskId: string;
				grantedAt: string;
				capabilityDigest: string;
			};
	  };
// biome-ignore lint/suspicious/noExplicitAny: package boundary adapter for the public Task Operator contract
export type TaskOperatorCommandRuntime = any;
// biome-ignore lint/suspicious/noExplicitAny: package boundary adapter for delegated authorization
export type TaskOperatorCapability = any;
export type TaskOperatorDelegatedAuthorizationPort = {
	authorize(input: {
		principal: TaskOperatorPrincipal;
		taskId: string;
	}): Promise<unknown>;
};

export const executeTaskOperatorCommand = (...args: unknown[]) =>
	callMissionPilotHost("executeTaskOperatorCommand", ...args);
export const readTaskOperatorProjection = (...args: unknown[]) =>
	callMissionPilotHost("readTaskOperatorProjection", ...args);
export const readTaskOperatorResource = (...args: unknown[]) =>
	callMissionPilotHost("readTaskOperatorResource", ...args);
export const getTaskOperatorActionDefinition = (
	actionId: string,
): TaskOperatorActionDefinition | null =>
	callMissionPilotHost("getTaskOperatorActionDefinition", actionId);
export const validateTaskOperatorJsonSchema = (...args: unknown[]) =>
	callMissionPilotHost("validateTaskOperatorJsonSchema", ...args);
export const humanTaskOperatorPrincipal = (...args: unknown[]) =>
	callMissionPilotHost("humanTaskOperatorPrincipal", ...args);
export const humanTaskOperatorQueryContext = (...args: unknown[]) =>
	callMissionPilotHost("humanTaskOperatorQueryContext", ...args);
export const humanTaskOperatorCommandContext = (...args: unknown[]) =>
	callMissionPilotHost("humanTaskOperatorCommandContext", ...args);
export const initializeTaskOperatorExecutionEvents = (...args: unknown[]) =>
	callMissionPilotHost("initializeTaskOperatorExecutionEvents", ...args);
export function registerTaskOperatorExecutionEventListener(
	listener: (event: {
		eventId: string;
		type: "task.run.started" | "task.run.failed" | "task.run.terminal";
		status: string;
		occurredAt: string;
		taskRef: { id: string; revision: number };
		resourceRef: { id: string; revision: number };
	}) => void | Promise<void>,
) {
	return callMissionPilotHost(
		"registerTaskOperatorExecutionEventListener",
		listener,
	);
}
export const digestTaskOperatorCapabilityGrant = (...args: unknown[]) =>
	callMissionPilotHost("digestTaskOperatorCapabilityGrant", ...args);
export const readCurrentTaskOperatorUserCapabilities = (...args: unknown[]) =>
	callMissionPilotHost("readCurrentTaskOperatorUserCapabilities", ...args);
export const taskOperatorPermissionDenied = (...args: unknown[]) =>
	callMissionPilotHost("taskOperatorPermissionDenied", ...args);
