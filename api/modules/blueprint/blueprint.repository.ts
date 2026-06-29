import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  blueprintArtifactAdoptions,
  blueprintDbDesignAdoptions,
  blueprintDesignSettings,
  blueprintDesignTokenAdoptions,
} from '../../db/schema';

export async function getBlueprintDesignSettings(taskId: string) {
  const [settings] = await db
    .select()
    .from(blueprintDesignSettings)
    .where(eq(blueprintDesignSettings.taskId, taskId));
  return settings;
}

export async function upsertBlueprintDesignSettings(taskId: string, settingsJson: unknown) {
  const now = new Date();
  const [settings] = await db
    .insert(blueprintDesignSettings)
    .values({
      taskId,
      settingsJson,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: blueprintDesignSettings.taskId,
      set: {
        settingsJson,
        updatedAt: now,
      },
    })
    .returning();
  return settings;
}

export async function getBlueprintArtifactAdoption(taskId: string, messageId: string) {
  const [adoption] = await db
    .select()
    .from(blueprintArtifactAdoptions)
    .where(
      and(
        eq(blueprintArtifactAdoptions.taskId, taskId),
        eq(blueprintArtifactAdoptions.messageId, messageId)
      )
    );
  return adoption;
}

export async function upsertBlueprintArtifactAdoption(
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  const now = new Date();
  const [adoption] = await db
    .insert(blueprintArtifactAdoptions)
    .values({
      taskId,
      messageId,
      adopted,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [blueprintArtifactAdoptions.taskId, blueprintArtifactAdoptions.messageId],
      set: {
        adopted,
        updatedAt: now,
      },
    })
    .returning();
  return adoption;
}

export async function getBlueprintDbDesignAdoption(taskId: string, messageId: string) {
  const [adoption] = await db
    .select()
    .from(blueprintDbDesignAdoptions)
    .where(
      and(
        eq(blueprintDbDesignAdoptions.taskId, taskId),
        eq(blueprintDbDesignAdoptions.messageId, messageId)
      )
    );
  return adoption;
}

export async function upsertBlueprintDbDesignAdoption(
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  const now = new Date();
  const [adoption] = await db
    .insert(blueprintDbDesignAdoptions)
    .values({
      taskId,
      messageId,
      adopted,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [blueprintDbDesignAdoptions.taskId, blueprintDbDesignAdoptions.messageId],
      set: {
        adopted,
        updatedAt: now,
      },
    })
    .returning();
  return adoption;
}

export async function getBlueprintDesignTokenAdoption(taskId: string, messageId: string) {
  const [adoption] = await db
    .select()
    .from(blueprintDesignTokenAdoptions)
    .where(
      and(
        eq(blueprintDesignTokenAdoptions.taskId, taskId),
        eq(blueprintDesignTokenAdoptions.messageId, messageId)
      )
    );
  return adoption;
}

export async function upsertBlueprintDesignTokenAdoption(
  taskId: string,
  messageId: string,
  adopted: boolean
) {
  const now = new Date();
  const [adoption] = await db
    .insert(blueprintDesignTokenAdoptions)
    .values({
      taskId,
      messageId,
      adopted,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [blueprintDesignTokenAdoptions.taskId, blueprintDesignTokenAdoptions.messageId],
      set: {
        adopted,
        updatedAt: now,
      },
    })
    .returning();
  return adoption;
}
