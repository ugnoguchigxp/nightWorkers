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
		await expect
			.poll(
				async () => {
					execution = await readAgentExecution(request, fixture.taskId);
					return execution.agent?.visibleItems?.at(-1)?.kind ?? null;
				},
				{ timeout: 20_000 },
			)
			.toBe("finish");
		expect(
			execution.agent?.visibleItems?.some((item) => item.kind === "assistant"),
		).toBe(true);
		expect(execution.phaseRuns).toHaveLength(0);
	} finally {
		await cleanupAgentScenario(request, fixture);
	}
});
