import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
};

async function createCompletedRun(
	request: APIRequestContext,
	workspace: string,
) {
	const repository = await request.post("/api/repositories", {
		headers,
		data: {
			name: `Git closeout ${Date.now()}`,
			localPath: workspace,
			branch: "main",
			allowed: true,
		},
	});
	expect(repository.status(), await repository.text()).toBe(201);
	const repositoryId = ((await repository.json()) as { id: string }).id;
	const task = await request.post("/api/tasks", {
		headers,
		data: {
			repositoryId,
			title: "Git closeout fixture",
			description: "[fixture:success]",
			objective: "[fixture:success]",
			acceptanceCriteria: "Runtime diff is committed.",
			timeoutSeconds: 60,
		},
	});
	expect(task.status(), await task.text()).toBe(201);
	const taskId = ((await task.json()) as { id: string }).id;
	await request.patch(`/api/tasks/${taskId}`, {
		headers,
		data: { status: "ready" },
	});
	const started = await request.post(`/api/workbench/sessions/${taskId}/run`, {
		headers,
	});
	const run = (await started.json()) as { id: string };
	for (let index = 0; index < 200; index += 1) {
		const detail = await request.get(`/api/runs/${run.id}`, { headers });
		const current = (await detail.json()) as { status: string };
		if (current.status === "completed")
			return { repositoryId, taskId, runId: run.id };
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("Fixture run did not complete");
}

async function cleanup(
	request: APIRequestContext,
	value: { repositoryId: string; taskId: string },
	paths: string[],
) {
	await Promise.allSettled([
		request.delete(`/api/tasks/${value.taskId}`, { headers }),
		request.delete(`/api/repositories/${value.repositoryId}`, { headers }),
	]);
	await Promise.all(
		paths.map((item) => fs.rm(item, { recursive: true, force: true })),
	);
}

test.describe("Git closeout @regression", () => {
	test.describe.configure({ mode: "serial", timeout: 60_000 });

	test("commits only the runtime-owned diff and persists its SHA", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-GIT-001"],
	}, async ({ request }) => {
		const { workspace } = await createDisposableGitWorkspace({
			prefix: "git-commit-",
		});
		const value = await createCompletedRun(request, workspace);
		try {
			const review = await request.post(
				`/api/runs/${value.runId}/review-sessions`,
				{ headers },
			);
			expect(review.status(), await review.text()).toBe(201);
			const reviewSession = (await review.json()) as {
				session: { id: string };
			};
			const reviewRun = await request.post(
				`/api/review-sessions/${reviewSession.session.id}/run`,
				{ headers },
			);
			expect(reviewRun.status(), await reviewRun.text()).toBe(200);
			const before = await request.get(
				`/api/runs/${value.runId}/git/closeout`,
				{
					headers,
				},
			);
			const beforeState = await before.json();
			if (!(beforeState as { canCommit?: boolean }).canCommit) {
				throw new Error(`Closeout blocked: ${JSON.stringify(beforeState)}`);
			}
			const closeout = await request.post(
				`/api/runs/${value.runId}/git/commit`,
				{ headers },
			);
			expect(closeout.status(), await closeout.text()).toBe(200);
			const state = (await closeout.json()) as {
				commitRecord: { commitSha: string | null; status: string };
			};
			expect(state.commitRecord.status).toBe("committed");
			expect(state.commitRecord.commitSha).toBe(
				execFileSync("git", ["rev-parse", "HEAD"], {
					cwd: workspace,
					encoding: "utf8",
				}).trim(),
			);
			expect(
				execFileSync("git", ["status", "--porcelain"], {
					cwd: workspace,
					encoding: "utf8",
				}),
			).toBe("");
		} finally {
			await cleanup(request, value, [workspace]);
		}
	});

	test("pre-existing dirty paths block closeout without committing them", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-GIT-002"],
	}, async ({ request }) => {
		const { workspace } = await createDisposableGitWorkspace({
			prefix: "git-ownership-",
			dirty: true,
		});
		const baselineHead = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: workspace,
			encoding: "utf8",
		}).trim();
		const value = await createCompletedRun(request, workspace);
		try {
			const closeout = await request.post(
				`/api/runs/${value.runId}/git/commit`,
				{ headers },
			);
			expect(closeout.status(), await closeout.text()).toBe(200);
			const state = (await closeout.json()) as {
				canCommit: boolean;
				blockingCode: string | null;
				commitRecord: { commitSha: string | null; status: string };
			};
			expect(state.canCommit).toBe(false);
			expect(state.commitRecord.commitSha).toBeNull();
			expect(
				execFileSync("git", ["rev-parse", "HEAD"], {
					cwd: workspace,
					encoding: "utf8",
				}).trim(),
			).toBe(baselineHead);
			expect(
				execFileSync("git", ["status", "--porcelain"], {
					cwd: workspace,
					encoding: "utf8",
				}),
			).toContain("pre-existing.txt");
		} finally {
			await cleanup(request, value, [workspace]);
		}
	});

	test("pushes the committed SHA to a local bare remote", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-GIT-003"],
	}, async ({ request }) => {
		const { workspace, remotePath } = await createDisposableGitWorkspace({
			prefix: "git-push-",
			withBareRemote: true,
		});
		if (!remotePath) throw new Error("Local bare remote was not created");
		const value = await createCompletedRun(request, workspace);
		try {
			const review = await request.post(
				`/api/runs/${value.runId}/review-sessions`,
				{ headers },
			);
			const session = (await review.json()) as { session: { id: string } };
			await request.post(`/api/review-sessions/${session.session.id}/run`, {
				headers,
			});
			const committed = await request.post(
				`/api/runs/${value.runId}/git/commit`,
				{ headers },
			);
			const commitState = (await committed.json()) as {
				commitRecord: { commitSha: string };
			};
			const pushed = await request.post(`/api/runs/${value.runId}/git/push`, {
				headers,
			});
			expect(pushed.status(), await pushed.text()).toBe(200);
			const pushState = (await pushed.json()) as {
				commitRecord: { pushStatus: string; commitSha: string };
			};
			expect(pushState.commitRecord.pushStatus).toBe("pushed");
			expect(
				execFileSync("git", ["--git-dir", remotePath, "rev-parse", "HEAD"], {
					encoding: "utf8",
				}).trim(),
			).toBe(commitState.commitRecord.commitSha);
		} finally {
			await cleanup(request, value, [workspace, remotePath]);
		}
	});

	test("archives a task and restores it to ready", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-ARCHIVE-001"],
	}, async ({ request }) => {
		const { workspace } = await createDisposableGitWorkspace({
			prefix: "archive-",
		});
		const value = await createCompletedRun(request, workspace);
		try {
			const archive = await request.patch(
				`/api/workbench/sessions/${value.taskId}/archive`,
				{ headers },
			);
			expect(archive.status(), await archive.text()).toBe(200);
			expect(((await archive.json()) as { status: string }).status).toBe(
				"completed",
			);
			const restore = await request.patch(`/api/tasks/${value.taskId}`, {
				headers,
				data: { status: "ready" },
			});
			expect(restore.status(), await restore.text()).toBe(200);
			expect(((await restore.json()) as { status: string }).status).toBe(
				"ready",
			);
		} finally {
			await cleanup(request, value, [workspace]);
		}
	});
});
