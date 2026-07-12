import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
};

test("creates every Task with a stopped Mission Pilot without a variant action", {
	tag: ["@deterministic", "@p1", "@scenario:NW-E2E-MISSION-PILOT-001"],
}, async ({ page, request }) => {
	const { workspace } = await createDisposableGitWorkspace({
		prefix: "mission-pilot-entry-",
	});
	const repositoryResponse = await request.post("/api/repositories", {
		headers,
		data: {
			name: "Mission Pilot entry",
			localPath: workspace,
			branch: "main",
			allowed: true,
		},
	});
	expect(repositoryResponse.status(), await repositoryResponse.text()).toBe(
		201,
	);
	const repositoryId = ((await repositoryResponse.json()) as { id: string }).id;
	try {
		const goalResponse = await request.post(
			`/api/repositories/${repositoryId}/mission-goals`,
			{
				headers,
				data: {
					title: "Mission Pilot goal",
					goalText: "Verify the Mission Pilot entry flow",
					active: true,
				},
			},
		);
		expect(goalResponse.status(), await goalResponse.text()).toBe(201);
		const goalId = ((await goalResponse.json()) as { id: string }).id;
		const databasePath = process.env.NIGHTWORKERS_E2E_DATABASE_PATH;
		if (!databasePath) throw new Error("E2E database path is required");
		const candidateId = randomUUID();
		const batchId = randomUUID();
		const now = Date.now();
		const db = new Database(databasePath);
		db.prepare(
			"insert into mission_task_candidate_batches (id, created_at, updated_at, repository_id, status, requested_goal_ids_json, signal_snapshot_json, started_at, completed_at) values (?, ?, ?, ?, 'completed', ?, '{}', ?, ?)",
		).run(batchId, now, now, repositoryId, JSON.stringify([goalId]), now, now);
		db.prepare(
			"insert into mission_task_candidates (id, created_at, updated_at, batch_id, repository_id, goal_id, candidate_kind, secondary_modules_json, routing_confidence_percent, constraint_goal_ids_json, plan_mode_open_questions_json, title, summary, rationale, evidence_json, importance_percent, confidence_percent, token_size, complexity, task_prompt, acceptance_criteria, verification_plan, status) values (?, ?, ?, ?, ?, ?, 'feature_followup', '[]', 100, '[]', '[]', ?, ?, ?, '[]', 90, 95, 'small', 'simple', ?, ?, ?, 'candidate')",
		).run(
			candidateId,
			now,
			now,
			batchId,
			repositoryId,
			goalId,
			"Mission Pilot browser task",
			"Create the Mission Pilot task variant",
			"The entry flow needs deterministic coverage",
			"Start Mission Pilot from the Task Generation screen",
			"The stopped Task variant is visible",
			"Create, reload, and stop are verified",
		);
		db.close();
		await page.goto(`/projects/${repositoryId}/detail/mission`);
		const candidateRow = page.getByRole("row", {
			name: /Mission Pilot browser task/,
		});
		await expect(candidateRow).toBeVisible();
		await expect(
			candidateRow.getByRole("button", { name: "タスク化" }),
		).toBeVisible();
		await expect(
			candidateRow.getByRole("button", {
				name: "Mission Pilotを開始",
				exact: true,
			}),
		).toHaveCount(0);
		await candidateRow.getByRole("button", { name: "タスク化" }).click();
		await expect(page).toHaveURL(
			new RegExp(`/projects/${repositoryId}/detail/mission$`),
		);
		const taskLink = page.getByRole("link", {
			name: "Mission Pilot browser task",
		});
		await expect(taskLink).toBeVisible();

		const tasksResponse = await request.get("/api/tasks", { headers });
		const task = (
			(await tasksResponse.json()) as Array<{
				id: string;
				title: string;
				missionPilot: {
					version: number;
					desiredState: string;
					phase: string;
				};
			}>
		).find((item) => item.title === "Mission Pilot browser task");
		expect(task?.missionPilot).toMatchObject({
			desiredState: "stopped",
			phase: "created",
		});
		if (!task) throw new Error("Mission Pilot task was not created");

		await taskLink.click({ position: { x: 20, y: 10 } });
		await expect(page).toHaveURL(`/sessions/${task.id}`);
		const composerControls = page.locator(".mission-pilot-composer-controls");
		await expect(
			composerControls.getByRole("button", {
				name: "Mission Pilotを再生",
				exact: true,
			}),
		).toBeEnabled();
		await page.reload();
		await expect(page.locator(".mission-pilot-task-row-playing")).toHaveCount(
			0,
		);
		await expect(
			page
				.locator(".mission-pilot-composer-controls")
				.getByRole("button", { name: "Mission Pilotを再生" }),
		).toBeEnabled();
	} finally {
		await Promise.allSettled([
			request.delete(`/api/repositories/${repositoryId}`, { headers }),
			fs.rm(workspace, { recursive: true, force: true }),
		]);
	}
});
