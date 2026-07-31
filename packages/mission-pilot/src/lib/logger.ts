import { callMissionPilotHost } from "../backend/host-bindings";

export function logEvent(input: Record<string, unknown>) {
	return callMissionPilotHost("logEvent", input);
}
