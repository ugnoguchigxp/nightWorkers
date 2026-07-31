import type {
	MissionPilotPersistenceOperation,
	MissionPilotPersistenceRequest,
} from "../contracts";
import { callMissionPilotHost } from "./host-bindings";

// The dynamic return type is contained at this private host boundary. Every
// operation name is fixed by the package and checked again by the host.
export function callMissionPilotPersistence<T = unknown>(
	operation: MissionPilotPersistenceOperation,
	...args: unknown[]
): Promise<T> {
	const request: MissionPilotPersistenceRequest = {
		operation,
		args,
	};
	return callMissionPilotHost("executeMissionPilotPersistence", request);
}
