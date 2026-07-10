import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
};

test("creates a task only from the selected deterministic mission candidate", {
	tag: ["@deterministic", "@p2", "@scenario:NW-E2E-MISSION-001"],
}, async ({ request }) => {
	const { workspace } = await createDisposableGitWorkspace({
		prefix: "mission-workflow-",
	});
	const repository = await request.post("/api/repositories", {
		headers,
		data: {
			name: "Mission workflow",
			localPath: workspace,
			branch: "main",
			allowed: true,
		},
	});
	expect(repository.status(), await repository.text()).toBe(201);
	const repositoryId = ((await repository.json()) as { id: string }).id;
	try {
		const goalResponse = await request.post(
			`/api/repositories/${repositoryId}/mission-goals`,
			{
				headers,
				data: {
					title: "Keep fixtures reliable",
					goalText: "Create only approved tasks",
					active: true,
				},
			},
		);
		expect(goalResponse.status(), await goalResponse.text()).toBe(201);
		const goalId = ((await goalResponse.json()) as { id: string }).id;
		const databasePath = process.env.NIGHTWORKERS_E2E_DATABASE_PATH;
		if (!databasePath) throw new Error("E2E database path is required");
		const db = new Database(databasePath);
		const now = Date.now();
		const batchId = randomUUID();
		db.prepare(
			"insert into mission_task_candidate_batches (id, created_at, updated_at, repository_id, status, requested_goal_ids_json, signal_snapshot_json, started_at, completed_at) values (?, ?, ?, ?, 'completed', ?, '{}', ?, ?)",
		).run(batchId, now, now, repositoryId, JSON.stringify([goalId]), now, now);
		const insertCandidate = db.prepare(
			"insert into mission_task_candidates (id, created_at, updated_at, batch_id, repository_id, goal_id, candidate_kind, secondary_modules_json, routing_confidence_percent, constraint_goal_ids_json, plan_mode_open_questions_json, title, summary, rationale, evidence_json, importance_percent, confidence_percent, token_size, complexity, task_prompt, acceptance_criteria, verification_plan, status) values (?, ?, ?, ?, ?, ?, 'feature_followup', '[]', 100, ?, '[]', ?, ?, ?, '[]', 70, 90, 'small', 'simple', ?, ?, ?, ?)",
		);
		const selectedId = randomUUID();
		const dismissedId = randomUUID();
		for (const [id, title, status] of [
			[selectedId, "Approved mission task", "selected"],
			[dismissedId, "Dismissed mission task", "dismissed"],
		] as const)
			insertCandidate.run(
				id,
				now,
				now,
				batchId,
				repositoryId,
				goalId,
				JSON.stringify([goalId]),
				title,
				"summary",
				"rationale",
				title,
				"acceptance",
				"verification",
				status,
			);
		db.close();
		const created = await request.post(
			`/api/repositories/${repositoryId}/mission-task-candidates/create-tasks`,
			{ headers, data: { candidateIds: [selectedId], mode: "ready" } },
		);
		expect(created.status(), await created.text()).toBe(201);
		expect(await created.json()).toMatchObject({
			tasks: [{ title: "Approved mission task", status: "ready" }],
			candidates: [{ id: selectedId, status: "task_created" }],
		});
		const candidates = await request.get(
			`/api/repositories/${repositoryId}/mission-task-candidates`,
			{ headers },
		);
		expect(await candidates.json()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: selectedId,
					status: "task_created",
					goalId,
				}),
				expect.objectContaining({
					id: dismissedId,
					status: "dismissed",
					taskId: null,
				}),
			]),
		);
	} finally {
		await Promise.allSettled([
			request.delete(`/api/repositories/${repositoryId}`, { headers }),
			fs.rm(workspace, { recursive: true, force: true }),
		]);
	}
});
