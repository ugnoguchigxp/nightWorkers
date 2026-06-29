import * as repo from './nightworkers.repository';

export type PlanModeTask = NonNullable<Awaited<ReturnType<typeof repo.getTask>>>;
export type PlanModeTaskMessage = Awaited<ReturnType<typeof repo.listTaskMessages>>[number];

export async function getPlanModeTask(taskId: string) {
  return repo.getTask(taskId);
}

export async function getPlanModeTaskMessage(messageId: string) {
  return repo.getTaskMessage(messageId);
}

export async function listPlanModeTaskMessages(taskId: string) {
  return repo.listTaskMessages(taskId);
}

export async function createPlanModeTaskMessage(
  input: Parameters<typeof repo.createTaskMessage>[0]
) {
  return repo.createTaskMessage(input);
}

export async function updatePlanModeTask(
  taskId: string,
  data: Parameters<typeof repo.updateTask>[1]
) {
  return repo.updateTask(taskId, data);
}

export async function createPlanModeBlueprintActivityArtifact(
  input: Parameters<typeof repo.createBlueprintActivityArtifact>[0]
) {
  return repo.createBlueprintActivityArtifact(input);
}
