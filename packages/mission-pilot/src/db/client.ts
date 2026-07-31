import {
	getMissionPilotDatabase,
	type MissionPilotDatabase,
	type MissionPilotTransaction,
} from "../backend/storage/database";

export type DbTransaction = MissionPilotTransaction;

export const db = new Proxy({} as MissionPilotDatabase, {
	get(_target, property) {
		const database = getMissionPilotDatabase();
		const value = Reflect.get(database, property);
		return typeof value === "function" ? value.bind(database) : value;
	},
});
