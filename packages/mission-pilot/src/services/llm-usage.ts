import { callMissionPilotHost } from "../backend/host-bindings";

export function recordLlmUsage(input: unknown) {
	return callMissionPilotHost("recordLlmUsage", input);
}
