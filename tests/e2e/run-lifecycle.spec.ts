import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { type APIRequestContext, expect, test } from "@playwright/test";
import {
	createE2eWorkspaceDirectory,
	initializeE2eGitRepository,
} from "./helpers";

const sameOriginHeaders = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
};

type Run = { id: string; status: string; finalReport?: string | null };

async function createFixture(
	request: APIRequestContext,
	behavior: string,
	timeoutSeconds = 60,
) {
	const workspace = await createE2eWorkspaceDirectory("run-lifecycle-");
	await fs.mkdir(path.join(workspace, "src"), { recursive: true });
	await fs.writeFile(path.join(workspace, "src", "greeting.txt"), "TODO\n");
	initializeE2eGitRepository(workspace);
	execFileSync("git", ["add", "."], { cwd: workspace, stdio: "ignore" });
	execFileSync(
		"git",
		[
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
	const repositoryRes = await request.post("/api/repositories", {
		headers: sameOriginHeaders,
		data: {
			name: `Run lifecycle ${Date.now()}`,
			localPath: workspace,
			branch: "main",
			allowed: true,
		},
	});
	expect(repositoryRes.status(), await repositoryRes.text()).toBe(201);
	const repositoryId = ((await repositoryRes.json()) as { id: string }).id;
	const taskRes = await request.post("/api/tasks", {
		headers: sameOriginHeaders,
		data: {
			repositoryId,
			title: `Run lifecycle ${behavior}`,
			description: `[fixture:${behavior}]`,
			objective: `[fixture:${behavior}]`,
			acceptanceCriteria: "Deterministic lifecycle evidence is persisted.",
			timeoutSeconds,
		},
	});
	expect(taskRes.status(), await taskRes.text()).toBe(201);
	const taskId = ((await taskRes.json()) as { id: string }).id;
	return { workspace, repositoryId, taskId };
}

async function start(request: APIRequestContext, taskId: string) {
	const ready = await request.patch(`/api/tasks/${taskId}`, {
		headers: sameOriginHeaders,
		data: { status: "ready" },
	});
	expect(ready.status(), await ready.text()).toBe(200);
	const started = await request.post(`/api/workbench/sessions/${taskId}/run`, {
		headers: sameOriginHeaders,
	});
	expect(started.status(), await started.text()).toBe(201);
	return (await started.json()) as { id: string };
}

async function runs(
	request: APIRequestContext,
	taskId: string,
): Promise<Run[]> {
	const response = await request.get(`/api/tasks/${taskId}/runs`, {
		headers: sameOriginHeaders,
	});
	expect(response.status(), await response.text()).toBe(200);
	return (await response.json()) as Run[];
}

async function waitForRun(
	request: APIRequestContext,
	taskId: string,
	statuses: string[],
) {
	const startedAt = Date.now();
	let latest: Run | undefined;
	while (Date.now() - startedAt < 15_000) {
		latest = (await runs(request, taskId))[0];
		if (latest && statuses.includes(latest.status)) return latest;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(
		`Timed out waiting for ${statuses.join(", ")}; latest=${JSON.stringify(latest)}`,
	);
}

async function waitForStatus(
	request: APIRequestContext,
	runId: string,
	statuses: string[],
) {
	const startedAt = Date.now();
	let latest: Run | undefined;
	while (Date.now() - startedAt < 15_000) {
		const response = await request.get(`/api/runs/${runId}`, {
			headers: sameOriginHeaders,
		});
		expect(response.status(), await response.text()).toBe(200);
		latest = (await response.json()) as Run;
		if (statuses.includes(latest.status)) return latest;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(
		`Timed out waiting for ${statuses.join(", ")}; latest=${JSON.stringify(latest)}`,
	);
}

async function cleanup(
	request: APIRequestContext,
	fixture: Awaited<ReturnType<typeof createFixture>>,
) {
	await Promise.allSettled([
		request.delete(`/api/tasks/${fixture.taskId}`, {
			headers: sameOriginHeaders,
		}),
		request.delete(`/api/repositories/${fixture.repositoryId}`, {
			headers: sameOriginHeaders,
		}),
	]);
	await fs.rm(fixture.workspace, { recursive: true, force: true });
}

test.describe("Run lifecycle recovery @regression", () => {
	test.describe.configure({ mode: "serial", timeout: 60_000 });

	test("needs_human run can be retried into a separate completed run", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-RUN-003"],
	}, async ({ request }) => {
		const fixture = await createFixture(request, "policy-block");
		try {
			await start(request, fixture.taskId);
			const first = await waitForRun(request, fixture.taskId, ["needs_human"]);
			const update = await request.patch(`/api/tasks/${fixture.taskId}`, {
				headers: sameOriginHeaders,
				data: {
					status: "ready",
				},
			});
			expect(update.status(), await update.text()).toBe(200);
			const retryMessage = await request.post(
				`/api/tasks/${fixture.taskId}/messages`,
				{
					headers: sameOriginHeaders,
					data: { prompt: "[fixture:success] Retry after the policy block." },
				},
			);
			expect(retryMessage.status(), await retryMessage.text()).toBe(200);
			const rerun = await request.post(
				`/api/workbench/sessions/${fixture.taskId}/run`,
				{ headers: sameOriginHeaders },
			);
			expect(rerun.status(), await rerun.text()).toBe(201);
			const rerunStarted = (await rerun.json()) as Run;
			const second = await waitForStatus(request, rerunStarted.id, [
				"completed",
			]);
			expect(second.id).not.toBe(first.id);
			const allRuns = await runs(request, fixture.taskId);
			expect(allRuns.map((run) => run.status)).toEqual(
				expect.arrayContaining(["completed", "needs_human"]),
			);
		} finally {
			await cleanup(request, fixture);
		}
	});

	test("running run can be stopped and leaves no active run", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-RUN-004"],
	}, async ({ request }) => {
		const fixture = await createFixture(request, "hold_until_stopped");
		try {
			await start(request, fixture.taskId);
			const running = await waitForRun(request, fixture.taskId, ["running"]);
			const stop = await request.post(`/api/runs/${running.id}/stop`, {
				headers: sameOriginHeaders,
			});
			expect(stop.status(), await stop.text()).toBe(200);
			await waitForRun(request, fixture.taskId, ["cancelled"]);
			const events = await request.get(`/api/runs/${running.id}/events`, {
				headers: sameOriginHeaders,
			});
			expect(await events.text()).toContain("run.stop_requested");
		} finally {
			await cleanup(request, fixture);
		}
	});

	test("timed out run persists timeout evidence and releases the task", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-RUN-005"],
	}, async ({ request }) => {
		const fixture = await createFixture(request, "timeout", 1);
		try {
			await start(request, fixture.taskId);
			const timedOut = await waitForRun(request, fixture.taskId, ["timed_out"]);
			expect(timedOut.finalReport).toContain("timed out");
		} finally {
			await cleanup(request, fixture);
		}
	});

	test("tool failure reaches failed without a workspace diff", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-RUN-006"],
	}, async ({ request }) => {
		const fixture = await createFixture(request, "tool_failure");
		try {
			await start(request, fixture.taskId);
			const failed = await waitForRun(request, fixture.taskId, ["failed"]);
			expect(failed.finalReport).toContain("tool failure");
			expect(
				execFileSync("git", ["diff", "--", "."], {
					cwd: fixture.workspace,
					encoding: "utf8",
				}),
			).toBe("");
		} finally {
			await cleanup(request, fixture);
		}
	});

	test("a task does not create duplicate active runs", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-RUN-007"],
	}, async ({ request }) => {
		const fixture = await createFixture(request, "hold_until_stopped");
		try {
			await start(request, fixture.taskId);
			const running = await waitForRun(request, fixture.taskId, ["running"]);
			const second = await request.post(
				`/api/workbench/sessions/${fixture.taskId}/run`,
				{ headers: sameOriginHeaders },
			);
			expect(second.status()).toBe(409);
			expect(
				(await runs(request, fixture.taskId)).filter(
					(run) => run.status === "running",
				),
			).toHaveLength(1);
			await request.post(`/api/runs/${running.id}/stop`, {
				headers: sameOriginHeaders,
			});
			await waitForRun(request, fixture.taskId, ["cancelled"]);
		} finally {
			await cleanup(request, fixture);
		}
	});
});
