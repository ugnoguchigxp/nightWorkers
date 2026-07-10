import { missionGoalTemplates } from "../../../shared/mission-goal-templates";
import type {
	CreateMissionGoalRequest,
	UpdateMissionGoalRequest,
} from "../../../shared/schemas/task-generation.schema";
import { NotFoundError } from "../../lib/errors";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as repo from "./task-generation.repository";

export const missionGoalPresets = missionGoalTemplates;

async function requireRepository(repositoryId: string) {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	return repository;
}

export async function listMissionGoals(repositoryId: string) {
	await requireRepository(repositoryId);
	return repo.listMissionGoals(repositoryId);
}

export async function createMissionGoal(
	repositoryId: string,
	input: CreateMissionGoalRequest,
) {
	await requireRepository(repositoryId);
	return repo.createMissionGoal({
		repositoryId,
		...input,
		source: "user",
	});
}

export async function updateMissionGoal(
	repositoryId: string,
	goalId: string,
	input: UpdateMissionGoalRequest,
) {
	await requireRepository(repositoryId);
	const existing = await repo.getMissionGoal(goalId);
	if (!existing || existing.repositoryId !== repositoryId) {
		throw new NotFoundError("Mission goal not found");
	}
	const updated = await repo.updateMissionGoal(goalId, input);
	if (!updated) throw new NotFoundError("Mission goal not found");
	return updated;
}

export async function deleteMissionGoal(repositoryId: string, goalId: string) {
	await requireRepository(repositoryId);
	const existing = await repo.getMissionGoal(goalId);
	if (!existing || existing.repositoryId !== repositoryId) {
		throw new NotFoundError("Mission goal not found");
	}
	const deleted = await repo.deleteMissionGoal(goalId);
	if (!deleted) throw new NotFoundError("Mission goal not found");
	return deleted;
}

export function listMissionGoalPresets() {
	return missionGoalPresets.map((preset) => ({ ...preset }));
}

export async function createMissionGoalFromPreset(
	repositoryId: string,
	input: { presetId: string; active: boolean },
) {
	const preset = missionGoalPresets.find((item) => item.id === input.presetId);
	if (!preset) throw new NotFoundError("Mission goal preset not found");
	await requireRepository(repositoryId);
	return repo.createMissionGoal({
		repositoryId,
		title: preset.title,
		goalText: preset.goalText,
		active: input.active,
		source: "preset",
	});
}
