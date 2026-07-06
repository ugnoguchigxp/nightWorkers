import { NotFoundError } from "../../lib/errors";
import { getPlanModeTask } from "../nightworkers/nightworkers.plan-mode-core.port";
import * as repo from "./blueprint.repository";

export async function getBlueprintDesignSettings(taskId: string) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	const row = await repo.getBlueprintDesignSettings(taskId);
	return {
		sessionId: taskId,
		settings: row?.settingsJson ?? null,
		createdAt: row?.createdAt,
		updatedAt: row?.updatedAt,
	};
}

export async function saveBlueprintDesignSettings(
	taskId: string,
	settings: unknown,
) {
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	const row = await repo.upsertBlueprintDesignSettings(taskId, settings);
	return {
		sessionId: taskId,
		settings: row.settingsJson,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
