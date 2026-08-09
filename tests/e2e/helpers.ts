import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext } from "@playwright/test";

export async function pollUntil<T>(
	fn: () => Promise<T>,
	predicate: (value: T) => boolean,
	timeoutMs = 15000,
	intervalMs = 500,
): Promise<T> {
	const started = Date.now();
	let lastValue = await fn();
	while (!predicate(lastValue)) {
		if (Date.now() - started > timeoutMs) {
			return lastValue;
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
		lastValue = await fn();
	}
	return lastValue;
}

export async function getJson<T>(
	request: APIRequestContext,
	path: string,
): Promise<T> {
	const res = await request.get(path);
	if (!res.ok()) {
		throw new Error(`GET ${path} failed: ${res.status()} ${await res.text()}`);
	}
	return (await res.json()) as T;
}

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.resolve(e2eDir, "..");

export async function readTestFixture(...segments: string[]) {
	return readFile(path.join(testsDir, "fixtures", ...segments), "utf8");
}

export async function createE2eWorkspaceDirectory(prefix: string) {
	const workspaceRoot = process.env.NIGHTWORKERS_E2E_WORKSPACE_ROOT?.trim();
	if (!workspaceRoot) {
		throw new Error(
			"NIGHTWORKERS_E2E_WORKSPACE_ROOT is required. Run E2E through the package script.",
		);
	}
	await mkdir(workspaceRoot, { recursive: true });
	return mkdtemp(path.join(workspaceRoot, prefix));
}

export function initializeE2eGitRepository(cwd: string) {
	try {
		execFileSync("git", ["init", "--initial-branch=main"], {
			cwd,
			stdio: "ignore",
		});
	} catch {
		execFileSync("git", ["init"], { cwd, stdio: "ignore" });
		execFileSync("git", ["branch", "-M", "main"], {
			cwd,
			stdio: "ignore",
		});
	}
}

export async function createDisposableGitWorkspace(options: {
	prefix: string;
	dirty?: boolean;
	withBareRemote?: boolean;
}) {
	const workspace = await createE2eWorkspaceDirectory(options.prefix);
	await mkdir(path.join(workspace, "src"), { recursive: true });
	await writeFile(path.join(workspace, "src", "greeting.txt"), "TODO\n");
	initializeE2eGitRepository(workspace);
	execFileSync("git", ["add", "."], { cwd: workspace, stdio: "ignore" });
	execFileSync(
		"git",
		[
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"user.email=e2e@example.test",
			"-c",
			"user.name=NightWorkers E2E",
			"commit",
			"-m",
			"initial fixture",
		],
		{ cwd: workspace, stdio: "ignore" },
	);
	let remotePath: string | null = null;
	if (options.withBareRemote) {
		remotePath = await createE2eWorkspaceDirectory("bare-remote-");
		execFileSync("git", ["init", "--bare"], {
			cwd: remotePath,
			stdio: "ignore",
		});
		execFileSync("git", ["remote", "add", "origin", remotePath], {
			cwd: workspace,
			stdio: "ignore",
		});
		execFileSync("git", ["push", "-u", "origin", "HEAD"], {
			cwd: workspace,
			stdio: "ignore",
		});
	}
	if (options.dirty) {
		await writeFile(path.join(workspace, "pre-existing.txt"), "dirty\n");
	}
	return { workspace, remotePath };
}
