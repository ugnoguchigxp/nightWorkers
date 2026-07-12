import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import {
	createDisposableGitWorkspace,
	createE2eWorkspaceDirectory,
} from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
};

test.describe("Repository safety @regression", () => {
	test("does not expose a file outside the repository root", {
		tag: ["@deterministic", "@p0", "@scenario:NW-E2E-REPO-001"],
	}, async ({ request }) => {
		const { workspace } = await createDisposableGitWorkspace({
			prefix: "repo-path-boundary-",
		});
		const secretDirectory =
			await createE2eWorkspaceDirectory("outside-secret-");
		const secretPath = path.join(secretDirectory, "secret.txt");
		const secret = "nightworkers-e2e-outside-secret";
		await fs.writeFile(secretPath, secret, "utf8");
		const repository = await request.post("/api/repositories", {
			headers,
			data: {
				name: "Repository path boundary",
				localPath: workspace,
				branch: "main",
				allowed: true,
			},
		});
		expect(repository.status(), await repository.text()).toBe(201);
		const repositoryId = ((await repository.json()) as { id: string }).id;
		try {
			const response = await request.get(
				`/api/repositories/${repositoryId}/file`,
				{ headers, params: { path: path.relative(workspace, secretPath) } },
			);
			const body = await response.text();
			expect(response.status()).toBe(400);
			expect(body).not.toContain(secret);
			expect(body).toContain("PATH_OUTSIDE_PROJECT");
		} finally {
			await Promise.allSettled([
				request.delete(`/api/repositories/${repositoryId}`, { headers }),
				fs.rm(workspace, { recursive: true, force: true }),
				fs.rm(secretDirectory, { recursive: true, force: true }),
			]);
		}
	});
});

test.describe("Activity replay @regression", () => {
	test("replays only strictly newer activity events without duplicates", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-ACTIVITY-001"],
	}, async ({ request }) => {
		const { workspace } = await createDisposableGitWorkspace({
			prefix: "activity-replay-",
		});
		const repository = await request.post("/api/repositories", {
			headers,
			data: {
				name: "Activity replay",
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
				title: "Activity replay fixture",
				description: "[fixture:success]",
				objective: "[fixture:success]",
				acceptanceCriteria: "Activity event replay is monotonic.",
				timeoutSeconds: 60,
			},
		});
		expect(task.status(), await task.text()).toBe(201);
		const taskId = ((await task.json()) as { id: string }).id;
		try {
			const databasePath = process.env.NIGHTWORKERS_E2E_DATABASE_PATH;
			if (!databasePath) throw new Error("E2E database path is required");
			const db = new Database(databasePath);
			const insert = db.prepare(
				"insert into activity_events (id, task_id, run_id, seq, kind, source, visibility, created_at) values (?, ?, null, ?, 'fixture.replay', 'e2e', 'visible', ?)",
			);
			for (const seq of [1001, 1002, 1003])
				insert.run(randomUUID(), taskId, seq, Date.now());
			db.close();
			const all = await request.get(`/api/tasks/${taskId}/activity-events`, {
				headers,
			});
			expect(all.status(), await all.text()).toBe(200);
			const first = (await all.json()) as { events: Array<{ seq: number }> };
			expect(first.events.length).toBeGreaterThan(1);
			const sequences = first.events.map((event) => event.seq);
			expect(sequences).toEqual([...new Set(sequences)].sort((a, b) => a - b));
			const cursor = sequences[0];
			const replay = await request.get(`/api/tasks/${taskId}/activity-events`, {
				headers,
				params: { afterSeq: String(cursor) },
			});
			const replayEvents = (
				(await replay.json()) as { events: Array<{ seq: number }> }
			).events;
			expect(replayEvents.map((event) => event.seq)).toEqual(
				sequences.filter((sequence) => sequence > cursor),
			);
		} finally {
			await Promise.allSettled([
				request.delete(`/api/tasks/${taskId}`, { headers }),
				request.delete(`/api/repositories/${repositoryId}`, { headers }),
				fs.rm(workspace, { recursive: true, force: true }),
			]);
		}
	});
});
