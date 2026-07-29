import { expect, test } from "@playwright/test";
import {
	agentScenarioHeaders,
	cleanupAgentScenario,
	createAgentScenario,
	playAgentScenario,
	readAgentExecution,
	waitForTaskStatus,
} from "./mission-pilot-agent-scenario.helpers";

test("Agent can read a failed Run, request repair, and complete the Task", {
	tag: [
		"@deterministic",
		"@p0",
		"@scenario:NW-E2E-MISSION-PILOT-AGENT-REPAIR-001",
	],
}, async ({ request }) => {
	test.setTimeout(90_000);
	const fixture = await createAgentScenario(
		request,
		"repair",
		"mission-pilot-agent-repair-",
	);
	try {
		await playAgentScenario(request, fixture);
		await waitForTaskStatus(request, fixture.taskId, "completed");
		let execution: {
			version: 2;
			executionModel: "task_operator_v1";
			agent?: { visibleItems?: Array<{ kind: string; content?: string }> };
			legacyPostQueueState: { status: "retired" };
		} | null = null;
		await expect
			.poll(
				async () => {
					execution = await readAgentExecution(request, fixture.taskId);
					return (
						execution?.agent?.visibleItems
							?.filter((item) => item.kind === "assistant")
							.map((item) => item.content ?? "")
							.join("\n") ?? ""
					);
				},
				{ timeout: 20_000 },
			)
			.toContain("修正");
		try {
			await expect
				.poll(
					async () => {
						execution = await readAgentExecution(request, fixture.taskId);
						return execution?.agent?.visibleItems?.at(-1)?.kind ?? null;
					},
					{ timeout: 20_000 },
				)
				.toBe("finish");
		} catch (error) {
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(execution)}`,
			);
		}
		expect(execution).toMatchObject({
			version: 2,
			executionModel: "task_operator_v1",
			legacyPostQueueState: { status: "retired" },
		});
		expect(execution).not.toHaveProperty("phaseRuns");
		const runsResponse = await request.get(
			`/api/tasks/${fixture.taskId}/runs`,
			{
				headers: agentScenarioHeaders,
			},
		);
		expect(runsResponse.status(), await runsResponse.text()).toBe(200);
		const runs = (await runsResponse.json()) as Array<{
			status: string;
			finalReport?: string | null;
		}>;
		expect(runs).toHaveLength(3);
		expect(
			runs.filter((run) => run.finalReport?.includes("tool failure")),
		).toHaveLength(2);
		expect(
			runs.filter((run) => !run.finalReport?.includes("tool failure")),
		).toHaveLength(1);
	} finally {
		await cleanupAgentScenario(request, fixture);
	}
});
