import { NotFoundError } from '../../lib/errors';
import * as repo from './nightworkers.repository';

type BlueprintAdoptionKind = 'blueprint' | 'dbDesign' | 'designTokens';

function serializeBlueprintAdoption(input: {
  taskId: string;
  messageId: string;
  adopted: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    sessionId: input.taskId,
    messageId: input.messageId,
    adopted: input.adopted,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

async function assertTaskMessageBelongsToTask(taskId: string, messageId: string) {
  const task = await repo.getTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  const message = await repo.getTaskMessage(messageId);
  if (!message || message.taskId !== taskId) {
    throw new NotFoundError('Task message not found');
  }
}

async function getBlueprintAdoption(
  kind: BlueprintAdoptionKind,
  taskId: string,
  messageId: string
) {
  await assertTaskMessageBelongsToTask(taskId, messageId);
  const row =
    kind === 'blueprint'
      ? await repo.getBlueprintArtifactAdoption(taskId, messageId)
      : kind === 'dbDesign'
        ? await repo.getBlueprintDbDesignAdoption(taskId, messageId)
        : await repo.getBlueprintDesignTokenAdoption(taskId, messageId);
  return serializeBlueprintAdoption({
    taskId,
    messageId,
    adopted: row?.adopted ?? false,
    createdAt: row?.createdAt,
    updatedAt: row?.updatedAt,
  });
}

async function saveBlueprintAdoption(
  kind: BlueprintAdoptionKind,
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  await assertTaskMessageBelongsToTask(taskId, messageId);
  const row =
    kind === 'blueprint'
      ? await repo.upsertBlueprintArtifactAdoption(taskId, messageId, adopted)
      : kind === 'dbDesign'
        ? await repo.upsertBlueprintDbDesignAdoption(taskId, messageId, adopted)
        : await repo.upsertBlueprintDesignTokenAdoption(taskId, messageId, adopted);
  return serializeBlueprintAdoption({
    taskId,
    messageId,
    adopted: row.adopted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export async function getBlueprintArtifactAdoption(taskId: string, messageId: string) {
  return getBlueprintAdoption('blueprint', taskId, messageId);
}

export async function saveBlueprintArtifactAdoption(
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  return saveBlueprintAdoption('blueprint', taskId, messageId, adopted);
}

export async function getBlueprintDbDesignAdoption(taskId: string, messageId: string) {
  return getBlueprintAdoption('dbDesign', taskId, messageId);
}

export async function saveBlueprintDbDesignAdoption(
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  return saveBlueprintAdoption('dbDesign', taskId, messageId, adopted);
}

export async function getBlueprintDesignTokenAdoption(taskId: string, messageId: string) {
  return getBlueprintAdoption('designTokens', taskId, messageId);
}

export async function saveBlueprintDesignTokenAdoption(
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  return saveBlueprintAdoption('designTokens', taskId, messageId, adopted);
}
