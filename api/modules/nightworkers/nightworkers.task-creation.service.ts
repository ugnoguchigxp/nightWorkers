import type { MissionPilotSourceRef } from "../../../shared/schemas/mission-pilot.schema";
import { type DbTransaction, db } from "../../db/client";
import {
	createSession as createMissionPilotSession,
	toControlSummary,
} from "../missionPilot/mission-pilot.repository";
import * as repo from "./nightworkers.repository";

type CreateTaskInput = Parameters<typeof repo.createTask>[0] & {
	missionPilotSourceRef?: MissionPilotSourceRef;
};

export async function createTaskWithMissionPilot(
	input: CreateTaskInput,
	transaction?: DbTransaction,
) {
	const create = async (tx: DbTransaction) => {
		const { missionPilotSourceRef, ...taskInput } = input;
		const task = await repo.createTask(taskInput, tx);
		const taskForSession = {
			...task,
			repositoryId: task.repositoryId ?? taskInput.repositoryId,
		};
		const sourceRef = missionPilotSourceRef ?? {
			source: "task" as const,
			id: task.id,
		};
		const session = await createMissionPilotSession(
			{
				task: taskForSession,
				sourceKind: sourceRef.source,
				sourceId: sourceRef.id,
				runtimeKind: "agent",
			},
			tx,
		);
		return { ...task, missionPilot: toControlSummary(session) };
	};

	return transaction ? create(transaction) : db.transaction(create);
}
