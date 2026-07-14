import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
	"x-nightworkers-e2e": "1",
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
		const fixtureResponse = await request.post(
			"/api/e2e/fixtures/mission-candidates",
			{
				headers,
				data: {
					repositoryId,
					goalId,
					candidates: [
						{
							title: "Approved mission task",
							summary: "summary",
							rationale: "rationale",
							taskPrompt: "Approved mission task",
							acceptanceCriteria: "acceptance",
							verificationPlan: "verification",
							status: "selected",
						},
						{
							title: "Dismissed mission task",
							summary: "summary",
							rationale: "rationale",
							taskPrompt: "Dismissed mission task",
							acceptanceCriteria: "acceptance",
							verificationPlan: "verification",
							status: "dismissed",
						},
					],
				},
			},
		);
		expect(fixtureResponse.status(), await fixtureResponse.text()).toBe(201);
		const candidateIds = (
			(await fixtureResponse.json()) as { candidateIds: string[] }
		).candidateIds;
		const selectedId = candidateIds[0];
		const dismissedId = candidateIds[1];
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
