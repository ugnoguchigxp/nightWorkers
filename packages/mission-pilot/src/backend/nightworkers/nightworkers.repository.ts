import { callMissionPilotHost } from "../host-bindings";

export const getTask = (...args: unknown[]) =>
	callMissionPilotHost("getTask", ...args);
export const appendActivityEvent = (...args: unknown[]) =>
	callMissionPilotHost("appendActivityEvent", ...args);
export const createTaskMessage = (...args: unknown[]) =>
	callMissionPilotHost("createTaskMessage", ...args);
