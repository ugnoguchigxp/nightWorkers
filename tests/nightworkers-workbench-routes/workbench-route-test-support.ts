import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as repo from "../../api/modules/nightworkers/nightworkers.repository";
import { initializeE2eGitRepository } from "../e2e/helpers";

export const sameOriginHeaders = { Origin: "http://localhost:39174" };

const disposableRepositoryRoots: string[] = [];

export function trackDisposableRepositoryRoot(root: string) {
	disposableRepositoryRoots.push(root);
}

export async function cleanupDisposableRepositories() {
	await Promise.all(
		disposableRepositoryRoots.splice(0).map((root) =>
			rm(root, {
				recursive: true,
				force: true,
			}),
		),
	);
}

export async function createWorkbenchTask(
	input: {
		title?: string;
		status?: string;
		objective?: string;
		createdBy?: "project-evaluation";
		repositoryPath?: string;
	} = {},
) {
	const project = await repo.createRepository({
		name: `TEST: Workbench Project ${crypto.randomUUID()}`,
		localPath: input.repositoryPath ?? "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
	});
	const task = await repo.createTask({
		repositoryId: project.id,
		title: input.title || "Workbench task",
		objective: input.objective ?? "Implement chat-first workbench",
		acceptanceCriteria:
			"Draft conversation, queue, and run are separate task-queue steps",
		status: input.status || "draft",
		createdBy: input.createdBy,
	});
	return { project, task };
}

export async function createDisposableRepository() {
	const root = await mkdtemp(
		path.join(os.tmpdir(), "nightworkers-workbench-route-"),
	);
	trackDisposableRepositoryRoot(root);
	await writeFile(
		path.join(root, "README.md"),
		"# Workbench fixture\n",
		"utf8",
	);
	initializeE2eGitRepository(root);
	execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
	execFileSync(
		"git",
		[
			"-c",
			"user.email=workbench@example.test",
			"-c",
			"user.name=NightWorkers Test",
			"commit",
			"-m",
			"initial fixture",
		],
		{ cwd: root, stdio: "ignore" },
	);
	return root;
}

export async function waitForTerminalRun(runId: string) {
	const terminalStatuses = new Set([
		"completed",
		"failed",
		"cancelled",
		"timed_out",
		"needs_review",
		"needs_human",
	]);
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const run = await repo.getTaskRun(runId);
		if (run && terminalStatuses.has(run.status)) return run;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Run ${runId} did not reach a terminal status.`);
}
