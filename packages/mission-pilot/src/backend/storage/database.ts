import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as agentSchema from "./agent-schema";
import * as stateSchema from "./schema";

export function createMissionPilotDatabase(client: Client) {
	return drizzle(client, {
		schema: {
			...stateSchema,
			...agentSchema,
		},
	});
}

export type MissionPilotDatabase = ReturnType<
	typeof createMissionPilotDatabase
>;
export type MissionPilotTransaction = Parameters<
	Parameters<MissionPilotDatabase["transaction"]>[0]
>[0];

let configuredDatabase: MissionPilotDatabase | null = null;

export function configureMissionPilotDatabase(client: Client) {
	configuredDatabase = createMissionPilotDatabase(client);
	return configuredDatabase;
}

export function getMissionPilotDatabase() {
	if (!configuredDatabase) {
		throw new Error("Mission Pilot database is not configured");
	}
	return configuredDatabase;
}
