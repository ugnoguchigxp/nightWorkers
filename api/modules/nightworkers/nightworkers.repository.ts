import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { repositories, taskEvents, taskRuns, tasks } from '../../db/schema';

// --- Repositories ---
export async function createRepository(data: {
  name: string;
  localPath: string;
  branch: string;
  // biome-ignore lint/suspicious/noExplicitAny: safetyPolicy is an arbitrary JSON object
  safetyPolicy?: any;
}) {
  const [repo] = await db.insert(repositories).values(data).returning();
  return repo;
}

export async function getRepository(id: string) {
  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id));
  return repo;
}

export async function listRepositories() {
  return db.select().from(repositories).orderBy(desc(repositories.createdAt));
}

export async function deleteRepository(id: string) {
  const [repo] = await db.delete(repositories).where(eq(repositories.id, id)).returning();
  return repo;
}

// --- Tasks ---
export async function createTask(data: {
  repositoryId: string;
  title: string;
  description?: string | null;
  status?: string;
  timeoutSeconds?: number;
}) {
  const [task] = await db.insert(tasks).values(data).returning();
  return task;
}

export async function getTask(id: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  return task;
}

export async function listTasks() {
  return db.select().from(tasks).orderBy(desc(tasks.createdAt));
}

export async function updateTaskStatus(id: string, status: string) {
  const [task] = await db
    .update(tasks)
    .set({ status, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return task;
}

export async function updateTaskCompiledPrompt(id: string, compiledPrompt: string) {
  const [task] = await db
    .update(tasks)
    .set({ compiledPrompt, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return task;
}

export async function deleteTask(id: string) {
  const [task] = await db.delete(tasks).where(eq(tasks.id, id)).returning();
  return task;
}

// --- Task Runs ---
export async function createTaskRun(data: { taskId: string; status?: string; startedAt?: Date }) {
  const [run] = await db.insert(taskRuns).values(data).returning();
  return run;
}

export async function getTaskRun(id: string) {
  const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, id));
  return run;
}

export async function listTaskRunsForTask(taskId: string) {
  return db
    .select()
    .from(taskRuns)
    .where(eq(taskRuns.taskId, taskId))
    .orderBy(desc(taskRuns.startedAt));
}

export async function updateTaskRun(
  id: string,
  data: {
    status?: string;
    endedAt?: Date;
    logContent?: string;
    diffPatch?: string;
    // biome-ignore lint/suspicious/noExplicitAny: arbitrary json
    testResults?: any;
    // biome-ignore lint/suspicious/noExplicitAny: arbitrary json
    contextEval?: any;
  }
) {
  const [run] = await db
    .update(taskRuns)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(taskRuns.id, id))
    .returning();
  return run;
}

// --- Task Events ---
export async function createTaskEvent(data: { taskRunId: string; type: string; message: string }) {
  const [event] = await db.insert(taskEvents).values(data).returning();
  return event;
}

export async function listTaskEventsForRun(taskRunId: string) {
  return db
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskRunId, taskRunId))
    .orderBy(taskEvents.timestamp);
}
