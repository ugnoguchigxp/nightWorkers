import { callMissionPilotHost } from "./host-bindings";

export const readTaskOperatorCommandReceipt = (...args: unknown[]) =>
	callMissionPilotHost("readTaskOperatorCommandReceipt", ...args);
