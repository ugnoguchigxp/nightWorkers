import { callMissionPilotHost } from "./host-bindings";

export const enqueueTaskActivityEvent = (...args: unknown[]) =>
	callMissionPilotHost("enqueueTaskActivityEvent", ...args);
export const readTaskActivityEvents = (...args: unknown[]) =>
	callMissionPilotHost("readTaskActivityEvents", ...args);
export function registerTaskMessageCreatedListener(
	listener: (message: {
		id: string;
		taskId: string;
		role: string;
		content: string;
		metadataJson: unknown;
	}) => void | Promise<void>,
) {
	return callMissionPilotHost("registerTaskMessageCreatedListener", listener);
}
