import { mcpClientService } from '../../services/mcp-client';
import { openHandsProcessRunner } from '../../services/runner/OpenHandsProcessRunner';
import * as repo from './nightworkers.repository';

// --- Repositories ---
export async function createRepository(data: {
  name: string;
  localPath: string;
  branch: string;
  // biome-ignore lint/suspicious/noExplicitAny: arbitrary JSON
  safetyPolicy?: any;
}) {
  return repo.createRepository(data);
}

export async function getRepository(id: string) {
  return repo.getRepository(id);
}

export async function listRepositories() {
  return repo.listRepositories();
}

export async function deleteRepository(id: string) {
  return repo.deleteRepository(id);
}

// --- Tasks ---
export async function createTask(data: {
  repositoryId: string;
  title: string;
  description?: string | null;
  timeoutSeconds?: number;
}) {
  return repo.createTask({
    ...data,
    status: 'draft',
  });
}

export async function getTask(id: string) {
  return repo.getTask(id);
}

export async function listTasks() {
  return repo.listTasks();
}

export async function deleteTask(id: string) {
  return repo.deleteTask(id);
}

// --- Execution Orchestration (Runner Integration) ---
export async function startTaskRun(taskId: string) {
  const task = await repo.getTask(taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  // 1. Update status to compiling_context
  await repo.updateTaskStatus(taskId, 'compiling_context');

  // 2. Fetch repo information and compile context
  const repoInfo = await repo.getRepository(task.repositoryId);
  let compiledPromptText = '';
  try {
    const compileResult = (await mcpClientService.contextCompile(
      repoInfo?.localPath || '',
      task.title,
      task.description || ''
    )) as any;
    if (compileResult?.content?.[0]) {
      compiledPromptText = compileResult.content[0].text;
    } else {
      compiledPromptText = task.description || '';
    }
  } catch (err) {
    console.error('Failed to compile context, falling back to original description', err);
    compiledPromptText = task.description || '';
  }

  await repo.updateTaskCompiledPrompt(taskId, compiledPromptText);

  // 3. Create a Run record
  const run = await repo.createTaskRun({
    taskId,
    status: 'running',
    startedAt: new Date(),
  });

  await repo.createTaskEvent({
    taskRunId: run.id,
    type: 'info',
    message: `Task run started. Compiling context completed.`,
  });

  // Track logs in memory and create database event entries
  let accumulativeLog = '';
  openHandsProcessRunner.onLog(run.id, async (logChunk) => {
    accumulativeLog += logChunk;
    await repo.createTaskEvent({
      taskRunId: run.id,
      type: 'info',
      message: logChunk.trim().slice(0, 500),
    });
  });

  // Asynchronously execute runner so that startTaskRun returns immediately
  (async () => {
    try {
      await repo.updateTaskStatus(taskId, 'running');

      await openHandsProcessRunner.start(run.id, repoInfo?.localPath || '', compiledPromptText, {
        timeoutSeconds: task.timeoutSeconds,
      });

      // Poll until process is no longer running
      let runnerStatus = await openHandsProcessRunner.getStatus(run.id);
      while (runnerStatus.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        runnerStatus = await openHandsProcessRunner.getStatus(run.id);
      }

      // Collect diff output from the repository workspace
      const diff = await openHandsProcessRunner.getGitDiff(repoInfo?.localPath || '');

      // Update the run record
      await repo.updateTaskRun(run.id, {
        status: runnerStatus.status,
        endedAt: new Date(),
        logContent: accumulativeLog,
        diffPatch: diff,
      });

      // Status goes to needs_review upon success, failed otherwise
      const finalTaskStatus = runnerStatus.status === 'completed' ? 'needs_review' : 'failed';
      await repo.updateTaskStatus(taskId, finalTaskStatus);

      await repo.createTaskEvent({
        taskRunId: run.id,
        type: 'checkpoint',
        message: `Execution finished with runner status: ${runnerStatus.status}. Task status: ${finalTaskStatus}`,
      });

      // Feedback evaluation back to contextStill
      await mcpClientService.compileEval(
        run.id,
        `Task run execution completed with status: ${runnerStatus.status}. Diff size: ${diff.length} bytes.`,
        runnerStatus.status === 'completed'
      );
      // biome-ignore lint/suspicious/noExplicitAny: catch error
    } catch (err: any) {
      console.error(`Error during OpenHands execution for run ${run.id}:`, err);
      await repo.updateTaskStatus(taskId, 'failed');
      await repo.updateTaskRun(run.id, {
        status: 'failed',
        endedAt: new Date(),
        logContent: `${accumulativeLog}\n[System Error] ${err.message}`,
      });

      await mcpClientService.compileEval(run.id, `Execution crashed: ${err.message}`, false);
    }
  })();

  return run;
}

export async function getTaskRun(runId: string) {
  const run = await repo.getTaskRun(runId);
  if (!run) return null;
  const events = await repo.listTaskEventsForRun(runId);
  return { ...run, events };
}

export async function getTaskRunsForTask(taskId: string) {
  return repo.listTaskRunsForTask(taskId);
}
