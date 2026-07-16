import { expect, test } from "@playwright/test";
import {
	agentScenarioHeaders,
	cleanupAgentScenario,
	createAgentScenario,
	playAgentScenario,
	readAgentExecution,
	waitForTaskStatus,
} from "./mission-pilot-agent-scenario.helpers";

test("Agent ownership survives an execution reconciliation without legacy phase work", {
	tag: [
		"@deterministic",
		"@p0",
		"@scenario:NW-E2E-MISSION-PILOT-AGENT-RESTART-001",
	],
}, async ({ request }) => {
	test.setTimeout(90_000);
	const fixture = await createAgentScenario(
		request,
		"restart",
		"mission-pilot-agent-restart-",
	);
	try {
		await playAgentScenario(request, fixture);
		await expect
			.poll(
				async () => {
					const execution = await readAgentExecution(request, fixture.taskId);
					return (
						execution.agent?.visibleItems?.some(
							(item: { kind: string; content: string }) =>
								item.kind === "assistant" &&
								item.content.includes("conversation checkpoint"),
						) ?? false
					);
				},
				{ timeout: 20_000 },
			)
			.toBe(true);
		const restarted = await request.post(
			"/api/e2e/fixtures/mission-pilot-agent-runtime-restart",
			{
				headers: agentScenarioHeaders,
				data: { taskId: fixture.taskId },
			},
		);
		expect(restarted.status(), await restarted.text()).toBe(200);
		await waitForTaskStatus(request, fixture.taskId, "completed");
		const task = await request.get(`/api/tasks/${fixture.taskId}`, {
			headers: agentScenarioHeaders,
		});
		expect((await task.json()).status).toBe("completed");
		const execution = await readAgentExecution(request, fixture.taskId);
		expect(execution.phaseRuns).toHaveLength(0);
		expect(execution.agent.visibleItems.at(-1).kind).toBe("finish");
	} finally {
		await cleanupAgentScenario(request, fixture);
	}
});
