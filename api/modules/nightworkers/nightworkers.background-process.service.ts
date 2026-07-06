import { NotFoundError } from "../../lib/errors";
import {
	getBackgroundProcess,
	listBackgroundProcesses,
	startBackgroundCommand,
	stopBackgroundProcess,
} from "../../services/background-processes";
import * as repo from "./nightworkers.repository";

async function resolveRepoRoot(input: {
	repositoryId?: string;
	taskId?: string;
	runId?: string;
}) {
	if (input.repositoryId) {
		const repository = await repo.getRepository(input.repositoryId);
		if (!repository) throw new NotFoundError("Repository not found");
		return { repoRoot: repository.localPath, repositoryId: repository.id };
	}

	if (input.runId) {
		const run = await repo.getTaskRun(input.runId);
		if (!run) throw new NotFoundError("Run not found");
		if (run.repositoryId) {
			const repository = await repo.getRepository(run.repositoryId);
			if (!repository) throw new NotFoundError("Repository not found");
			return { repoRoot: repository.localPath, repositoryId: repository.id };
		}
		const task = await repo.getTask(run.taskId);
		if (!task) throw new NotFoundError("Task not found");
		const repository = await repo.getRepository(task.repositoryId);
		if (!repository) throw new NotFoundError("Repository not found");
		return { repoRoot: repository.localPath, repositoryId: repository.id };
	}

	if (input.taskId) {
		const task = await repo.getTask(input.taskId);
		if (!task) throw new NotFoundError("Task not found");
		const repository = await repo.getRepository(task.repositoryId);
		if (!repository) throw new NotFoundError("Repository not found");
		return { repoRoot: repository.localPath, repositoryId: repository.id };
	}

	throw new NotFoundError("Repository not found");
}

export async function startTaskBackgroundProcess(input: {
	command: string;
	cwd?: string;
	repositoryId?: string;
	taskId?: string;
	runId?: string;
}) {
	const { repoRoot, repositoryId } = await resolveRepoRoot(input);
	const repository = await repo.getRepository(repositoryId);
	return startBackgroundCommand({
		...input,
		repositoryId,
		repoRoot,
		allowedPaths: repository?.safetyPolicy?.allowedPaths,
		externalAllowedPaths: repository?.safetyPolicy?.externalAllowedPaths,
		deniedPaths: repository?.safetyPolicy?.deniedPaths,
		blockedCommands: repository?.safetyPolicy?.blockedCommands,
	});
}

export async function listTaskBackgroundProcesses(filters?: {
	repositoryId?: string;
	taskId?: string;
	runId?: string;
}) {
	return listBackgroundProcesses(filters);
}

export async function getTaskBackgroundProcess(id: string) {
	return getBackgroundProcess(id);
}

export async function stopTaskBackgroundProcess(id: string) {
	const stopped = await stopBackgroundProcess(id);
	if (!stopped) throw new NotFoundError("Background process not found");
	return stopped;
}
