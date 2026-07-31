import { expect, test } from "@playwright/test";
import type { AgentExecution } from "./mission-pilot-agent-scenario.helpers";
import {
	cleanupAgentScenario,
	createAgentScenario,
	playAgentScenario,
	readAgentExecution,
	waitForTaskStatus,
} from "./mission-pilot-agent-scenario.helpers";

test("Agent reads facts, completes the Task explicitly, and finishes the session", {
	tag: [
		"@deterministic",
		"@p0",
		"@scenario:NW-E2E-MISSION-PILOT-AGENT-AUTOPILOT-001",
	],
}, async ({ request }) => {
	test.setTimeout(90_000);
	const fixture = await createAgentScenario(
		request,
		"autopilot",
		"mission-pilot-agent-autopilot-",
	);
	try {
		await playAgentScenario(request, fixture);
		await waitForTaskStatus(request, fixture.taskId, "completed");
		let execution = {} as AgentExecution;
		try {
			await expect
				.poll(
					async () => {
						execution = await readAgentExecution(request, fixture.taskId);
						return execution.agent?.visibleItems?.at(-1)?.kind ?? null;
					},
					{ timeout: 60_000 },
				)
				.toBe("finish");
		} catch (error) {
			const runsResponse = await request.get(
				`/api/tasks/${fixture.taskId}/runs`,
			);
			const runs = runsResponse.ok() ? await runsResponse.json() : null;
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify({ execution, runs })}`,
			);
		}
		expect(
			execution.agent?.visibleItems?.some((item) => item.kind === "assistant"),
		).toBe(true);
		expect(execution).toMatchObject({
			version: 2,
			executionModel: "task_operator_v1",
		});
		expect(execution).not.toHaveProperty("phaseRuns");
	} finally {
		await cleanupAgentScenario(request, fixture);
	}
});
