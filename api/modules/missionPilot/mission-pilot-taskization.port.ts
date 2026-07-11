import type { MissionPilotSourceRef } from "../../../shared/schemas/mission-pilot.schema";
import * as missionPlannerRepo from "../mission-planner/mission-planner.repository";
import { createTasksFromMissionTaskProposals } from "../mission-planner/mission-planner.service";
import * as taskGenerationRepo from "../taskGeneration/task-generation.repository";
import { createTasksFromMissionCandidates } from "../taskGeneration/task-generation.service";
import { MissionPilotError } from "./mission-pilot.errors";
import { createSession } from "./mission-pilot.repository";

export async function createMissionPilotTask(
	repositoryId: string,
	sourceRef: MissionPilotSourceRef,
) {
	const onTaskCreated = async (
		task: Parameters<typeof createSession>[0]["task"],
		tx: Parameters<typeof createSession>[1],
	) => {
		await createSession(
			{ task, sourceKind: sourceRef.source, sourceId: sourceRef.id },
			tx,
		);
	};
	if (sourceRef.source === "mission_task_candidate") {
		const [source] = await taskGenerationRepo.listMissionCandidatesByIds([
			sourceRef.id,
		]);
		if (!source)
			throw new MissionPilotError(
				404,
				"MISSION_PILOT_SOURCE_NOT_FOUND",
				"Mission Pilot source not found",
			);
		if (source.repositoryId !== repositoryId)
			throw new MissionPilotError(
				409,
				"MISSION_PILOT_SOURCE_REPOSITORY_MISMATCH",
				"Mission Pilot source belongs to another repository",
			);
		if (source.status === "task_created" || source.taskId)
			throw new MissionPilotError(
				409,
				"MISSION_PILOT_SOURCE_ALREADY_TASKED",
				"Mission Pilot source already has a task",
			);
		if (source.status === "dismissed")
			throw new MissionPilotError(
				409,
				"MISSION_PILOT_CREATE_CONFLICT",
				"Dismissed sources cannot become Mission Pilot tasks",
			);
		const result = await createTasksFromMissionCandidates({
			repositoryId,
			candidateIds: [sourceRef.id],
			mode: "draft",
			onTaskCreated,
		});
		return result.tasks[0];
	}
	const source = await missionPlannerRepo.getTaskProposal(sourceRef.id);
	if (!source)
		throw new MissionPilotError(
			404,
			"MISSION_PILOT_SOURCE_NOT_FOUND",
			"Mission Pilot source not found",
		);
	if (source.repositoryId !== repositoryId)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_SOURCE_REPOSITORY_MISMATCH",
			"Mission Pilot source belongs to another repository",
		);
	if (source.status === "task_created" || source.taskId)
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_SOURCE_ALREADY_TASKED",
			"Mission Pilot source already has a task",
		);
	if (source.status === "dismissed")
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_CREATE_CONFLICT",
			"Dismissed sources cannot become Mission Pilot tasks",
		);
	const result = await createTasksFromMissionTaskProposals({
		proposalIds: [sourceRef.id],
		mode: "draft",
		onTaskCreated,
	});
	return result.tasks[0];
}
