import { callMissionPilotHost } from "../../backend/host-bindings";

export const nightWorkersRealtimeBroker = {
	publish(taskId: string, event: unknown) {
		return callMissionPilotHost("publishRealtime", taskId, event);
	},
};
