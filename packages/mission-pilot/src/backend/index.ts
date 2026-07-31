import { Hono } from "hono";
import type { MissionPilotHostPorts } from "../contracts";

export type MissionPilotBackendDependencies = {
	host: MissionPilotHostPorts;
};

export type MissionPilotStorageDependencies = {
	client: unknown;
	logger: MissionPilotHostPorts["logger"];
};

export type MissionPilotRuntimeDependencies = MissionPilotBackendDependencies;

export function createMissionPilotRouter(
	_dependencies: MissionPilotBackendDependencies,
): Hono {
	return new Hono();
}

export async function bootstrapMissionPilotStorage(
	_dependencies: MissionPilotStorageDependencies,
): Promise<void> {}

export async function startMissionPilotRuntime(
	_dependencies: MissionPilotRuntimeDependencies,
): Promise<{ stop(): Promise<void> }> {
	return {
		async stop() {},
	};
}
