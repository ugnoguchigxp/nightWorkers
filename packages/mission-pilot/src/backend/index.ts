import { Hono } from "hono";
import type { MissionPilotHostPorts } from "../contracts";
import {
	bootstrapMissionPilotTables,
	type MissionPilotSqlClient,
} from "./storage/bootstrap";
import { configureMissionPilotDatabase } from "./storage/database";

export * from "./storage/agent-schema";
export * from "./storage/repository";
export {
	configureMissionPilotDatabase,
	createMissionPilotDatabase,
	getMissionPilotDatabase,
	type MissionPilotDatabase,
	type MissionPilotTransaction,
} from "./storage/database";
export * from "./storage/schema";

export type MissionPilotBackendDependencies = {
	host: MissionPilotHostPorts;
};

export type MissionPilotStorageDependencies = {
	client: MissionPilotSqlClient;
	logger: MissionPilotHostPorts["logger"];
};

export type MissionPilotRuntimeDependencies = MissionPilotBackendDependencies;

export function createMissionPilotRouter(
	_dependencies: MissionPilotBackendDependencies,
): Hono {
	return new Hono();
}

export async function bootstrapMissionPilotStorage(
	dependencies: MissionPilotStorageDependencies,
): Promise<void> {
	await bootstrapMissionPilotTables(dependencies.client);
	configureMissionPilotDatabase(dependencies.client as never);
}

export async function startMissionPilotRuntime(
	_dependencies: MissionPilotRuntimeDependencies,
): Promise<{ stop(): Promise<void> }> {
	return {
		async stop() {},
	};
}
