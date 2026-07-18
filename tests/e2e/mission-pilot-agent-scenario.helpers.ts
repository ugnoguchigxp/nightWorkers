import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { createDisposableGitWorkspace } from "./helpers";

export const agentScenarioHeaders = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
	"x-nightworkers-e2e": "1",
};

export type AgentExecution = {
	agent?: {
		visibleItems?: Array<{ kind: string; content?: string }>;
	};
	phaseRuns: unknown[];
};

type TaskResponse = {
	status: string;
	missionPilot?: { version: number };
};

export async function createAgentScenario(
	request: APIRequestContext,
	scenario: "autopilot" | "repair" | "restart" | "user-interruption",
	prefix: string,
) {
	const { workspace } = await createDisposableGitWorkspace({ prefix });
	const branch = execFileSync("git", ["branch", "--show-current"], {
		cwd: workspace,
		encoding: "utf8",
	}).trim();
	const repositoryResponse = await request.post("/api/repositories", {
		headers: agentScenarioHeaders,
		data: {
			name: `Mission Pilot Agent ${scenario}`,
			localPath: workspace,
			branch,
			allowed: true,
		},
	});
	expect(repositoryResponse.status(), await repositoryResponse.text()).toBe(
		201,
	);
	const repositoryId = ((await repositoryResponse.json()) as { id: string }).id;
	const taskResponse = await request.post("/api/tasks", {
		headers: agentScenarioHeaders,
		data: {
			repositoryId,
			title: `Mission Pilot Agent ${scenario}`,
			description: `deterministic ${scenario} scenario`,
			objective: "[fixture:success] Mission Pilot Agent scenario",
			acceptanceCriteria: "The deterministic Agent scenario is observed.",
			timeoutSeconds: 60,
		},
	});
	expect(taskResponse.status(), await taskResponse.text()).toBe(201);
	const task = (await taskResponse.json()) as {
		id: string;
		missionPilot: { version: number };
	};
	const fixtureResponse = await request.post(
		"/api/e2e/fixtures/mission-pilot-agent-scenario",
		{
			headers: agentScenarioHeaders,
			data: { taskId: task.id, scenario },
		},
	);
	expect(fixtureResponse.status(), await fixtureResponse.text()).toBe(201);
	return {
		workspace,
		repositoryId,
		taskId: task.id,
		sessionId: ((await fixtureResponse.json()) as { sessionId: string })
			.sessionId,
		version: task.missionPilot.version,
	};
}

export async function playAgentScenario(
	request: APIRequestContext,
	fixture: { taskId: string },
) {
	const taskResponse = await request.get(`/api/tasks/${fixture.taskId}`, {
		headers: agentScenarioHeaders,
	});
	expect(taskResponse.status(), await taskResponse.text()).toBe(200);
	const task = (await taskResponse.json()) as {
		missionPilot: { version: number };
	};
	const response = await request.post(
		`/api/mission-pilot/tasks/${fixture.taskId}/play`,
		{
			headers: agentScenarioHeaders,
			data: { expectedVersion: task.missionPilot.version },
		},
	);
	expect(response.status(), await response.text()).toBe(200);
}

export async function waitForTaskStatus(
	request: APIRequestContext,
	taskId: string,
	status: string,
	timeout = 60_000,
) {
	let task: TaskResponse = { status: "" };
	try {
		await expect
			.poll(
				async () => {
					const response = await request.get(`/api/tasks/${taskId}`, {
						headers: agentScenarioHeaders,
					});
					expect(response.status(), await response.text()).toBe(200);
					task = (await response.json()) as TaskResponse;
					return task.status;
				},
				{ timeout },
			)
			.toBe(status);
	} catch (error) {
		const execution = await readAgentExecution(request, taskId).catch(
			() => null,
		);
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify({ execution })}`,
		);
	}
	return task;
}

export async function readAgentExecution(
	request: APIRequestContext,
	taskId: string,
): Promise<AgentExecution> {
	const response = await request.get(
		`/api/mission-pilot/tasks/${taskId}/execution`,
		{
			headers: agentScenarioHeaders,
		},
	);
	expect(response.status(), await response.text()).toBe(200);
	return (await response.json()) as AgentExecution;
}

export async function cleanupAgentScenario(
	request: APIRequestContext,
	fixture: { taskId: string; repositoryId: string; workspace: string },
) {
	await Promise.allSettled([
		request.delete(`/api/tasks/${fixture.taskId}`, {
			headers: agentScenarioHeaders,
		}),
		request.delete(`/api/repositories/${fixture.repositoryId}`, {
			headers: agentScenarioHeaders,
		}),
		fs.rm(fixture.workspace, { recursive: true, force: true }),
	]);
}
