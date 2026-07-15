import crypto from "node:crypto";
import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
	"x-nightworkers-e2e": "1",
};

test("persistent agent requires UI approval before a destructive action", {
	tag: ["@deterministic", "@p0", "@scenario:NW-E2E-MISSION-PILOT-AGENT-001"],
}, async ({ page, request }) => {
	const { workspace } = await createDisposableGitWorkspace({
		prefix: "mission-pilot-agent-approval-",
	});
	const repositoryResponse = await request.post("/api/repositories", {
		headers,
		data: {
			name: "Mission Pilot persistent agent",
			localPath: workspace,
			branch: "main",
			allowed: true,
		},
	});
	expect(repositoryResponse.status(), await repositoryResponse.text()).toBe(
		201,
	);
	const repositoryId = ((await repositoryResponse.json()) as { id: string }).id;
	let taskId = "";
	try {
		const taskResponse = await request.post("/api/tasks", {
			headers,
			data: {
				repositoryId,
				title: "Persistent agent approval",
				objective: "ユーザー確認なしに不可逆操作を実行しない",
				acceptanceCriteria: "拒否後もTaskが存在する",
			},
		});
		expect(taskResponse.status(), await taskResponse.text()).toBe(201);
		const created = (await taskResponse.json()) as {
			id: string;
			missionPilot: { version: number; runtimeKind: string };
		};
		taskId = created.id;
		expect(created.missionPilot.runtimeKind).toBe("agent");
		const fixtureResponse = await request.post(
			"/api/e2e/fixtures/mission-pilot-agent-turns",
			{
				headers,
				data: {
					taskId,
					turns: [
						{
							content: "Task削除の確認をユーザーへ求めます。",
							toolCalls: [
								{
									id: crypto.randomUUID(),
									name: "task_delete",
									arguments: {},
								},
							],
						},
						{
							content: "拒否を尊重し、Taskを削除せず待機します。",
							toolCalls: [],
						},
					],
				},
			},
		);
		expect(fixtureResponse.status(), await fixtureResponse.text()).toBe(201);
		const playResponse = await request.post(
			`/api/mission-pilot/tasks/${taskId}/play`,
			{
				headers,
				data: { expectedVersion: created.missionPilot.version },
			},
		);
		expect(playResponse.status(), await playResponse.text()).toBe(200);
		expect((await playResponse.json()) as object).toMatchObject({
			missionPilot: { runtimeKind: "agent", runtimeState: "attention" },
		});
		const pendingResponse = await request.get(
			`/api/mission-pilot/tasks/${taskId}/action-confirmations`,
			{ headers },
		);
		expect(pendingResponse.status(), await pendingResponse.text()).toBe(200);
		expect((await pendingResponse.json()) as unknown[]).toHaveLength(1);

		await page.goto(`/sessions/${taskId}`);
		const confirmation = page.getByText("実行前の確認が必要です");
		await expect(confirmation).toBeVisible();
		await page.getByRole("button", { name: "拒否", exact: true }).click();
		await expect(confirmation).toHaveCount(0);
		await expect
			.poll(async () => {
				const response = await request.get("/api/tasks", { headers });
				return ((await response.json()) as Array<{ id: string }>).some(
					(task) => task.id === taskId,
				);
			})
			.toBe(true);
	} finally {
		await Promise.allSettled([
			taskId ? request.delete(`/api/tasks/${taskId}`, { headers }) : null,
			request.delete(`/api/repositories/${repositoryId}`, { headers }),
			fs.rm(workspace, { recursive: true, force: true }),
		]);
	}
});
