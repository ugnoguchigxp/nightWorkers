import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
	"x-nightworkers-e2e": "1",
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
		const fixtureResponse = await request.post(
			"/api/e2e/fixtures/mission-candidates",
			{
				headers,
				data: {
					repositoryId,
					goalId,
					candidates: [
						{
							title: "Mission Pilot browser task",
							summary: "Create the Mission Pilot task variant",
							rationale: "The entry flow needs deterministic coverage",
							taskPrompt: "Start Mission Pilot from the Task Generation screen",
							acceptanceCriteria: "The stopped Task variant is visible",
							verificationPlan: "Create, reload, and stop are verified",
							status: "candidate",
						},
					],
				},
			},
		);
		expect(fixtureResponse.status(), await fixtureResponse.text()).toBe(201);
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
