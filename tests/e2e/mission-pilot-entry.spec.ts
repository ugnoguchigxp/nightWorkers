import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
};

test("creates and restores the Mission Pilot Task variant without live LLM calls", {
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
		await page.route("**/api/mission-pilot/tasks/*/play", async (route) => {
			const taskId = route
				.request()
				.url()
				.match(/tasks\/([^/]+)\/play$/)?.[1];
			if (!taskId) throw new Error("Mission Pilot task id is required");
			const playingDb = new Database(databasePath);
			const session = playingDb
				.prepare("select version from mission_pilot_sessions where task_id = ?")
				.get(taskId) as { version: number };
			const now = Date.now();
			const nextWakeAt = now + 60_000;
			const nextWakeAtSeconds = Math.floor(nextWakeAt / 1000);
			playingDb
				.prepare(
					"update mission_pilot_sessions set desired_state = 'playing', phase = 'initial_intake', authorization_version = 2, initial_prompt_state = 'sent', next_wake_at = ?, version = version + 1, updated_at = ? where task_id = ?",
				)
				.run(nextWakeAtSeconds, now, taskId);
			playingDb.close();
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					missionPilot: {
						taskId,
						desiredState: "playing",
						activityState: "idle",
						phase: "initial_intake",
						authorizationVersion: 2,
						initialPromptState: "sent",
						initialPromptMessageId: null,
						activeRunId: null,
						nextWakeAt: new Date(nextWakeAt).toISOString(),
						version: session.version + 1,
						lastError: null,
						updatedAt: new Date(now).toISOString(),
					},
					run: null,
					messages: [],
				}),
			});
		});

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
		).toBeVisible();
		await candidateRow
			.getByRole("button", { name: "Mission Pilotを開始", exact: true })
			.click();
		await expect(page).toHaveURL(
			new RegExp(`/projects/${repositoryId}/detail/mission$`),
		);
		const taskLink = page.getByRole("link", {
			name: "Mission Pilot browser task",
		});
		await expect(taskLink).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Mission Pilotを一時停止" }),
		).toBeVisible();

		const tasksResponse = await request.get("/api/tasks", { headers });
		const task = (
			(await tasksResponse.json()) as Array<{
				id: string;
				title: string;
				missionPilot: { version: number } | null;
			}>
		).find((item) => item.title === "Mission Pilot browser task");
		expect(task?.missionPilot).not.toBeNull();
		if (!task) throw new Error("Mission Pilot task was not created");

		await taskLink.click({ position: { x: 20, y: 10 } });
		await expect(page).toHaveURL(`/sessions/${task.id}`);
		const composerControls = page.locator(".mission-pilot-composer-controls");
		await expect(
			composerControls.getByRole("button", {
				name: "Mission Pilotを一時停止",
				exact: true,
			}),
		).toBeEnabled();
		const countdown = composerControls.locator(".mission-pilot-countdown");
		await expect(countdown).toBeVisible();
		const playingRow = page.locator(".mission-pilot-task-row-playing");
		await expect(playingRow).toBeVisible();
		for (const theme of [
			"light",
			"dark",
			"eclipse",
			"macosclassic",
			"campfire",
			"mint",
			"bloom",
			"mocha",
		]) {
			await page.locator(".nightworkers-shell").evaluate((element, value) => {
				element.setAttribute("data-theme", value);
			}, theme);
			const style = await playingRow.evaluate((element) => {
				const computed = window.getComputedStyle(element);
				return {
					backgroundColor: computed.backgroundColor,
					borderColor: computed.borderColor,
					color: computed.color,
				};
			});
			expect(style.backgroundColor, theme).not.toBe("rgba(0, 0, 0, 0)");
			expect(style.borderColor, theme).not.toBe("rgba(0, 0, 0, 0)");
			expect(style.color, theme).not.toBe("");
		}
		await countdown.click();
		await expect(
			composerControls.getByRole("button", { name: "Mission Pilotを再生" }),
		).toBeEnabled();
		await page.reload();
		await expect(page.locator(".mission-pilot-task-row-playing")).toHaveCount(
			0,
		);
		const stoppedDb = new Database(databasePath, { readonly: true });
		const state = stoppedDb
			.prepare(
				"select desired_state as desiredState, phase from mission_pilot_sessions where task_id = ?",
			)
			.get(task.id) as { desiredState: string; phase: string };
		stoppedDb.close();
		expect(state).toEqual({ desiredState: "stopped", phase: "paused" });
	} finally {
		await Promise.allSettled([
			request.delete(`/api/repositories/${repositoryId}`, { headers }),
			fs.rm(workspace, { recursive: true, force: true }),
		]);
	}
});
