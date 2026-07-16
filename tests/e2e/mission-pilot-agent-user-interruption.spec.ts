import { expect, test } from "@playwright/test";
import {
	agentScenarioHeaders,
	cleanupAgentScenario,
	createAgentScenario,
	playAgentScenario,
	readAgentExecution,
} from "./mission-pilot-agent-scenario.helpers";

test("Agent shows a visible question, waits, and resumes on a user message", {
	tag: [
		"@deterministic",
		"@p0",
		"@scenario:NW-E2E-MISSION-PILOT-AGENT-USER-INTERRUPTION-001",
	],
}, async ({ request }) => {
	test.setTimeout(90_000);
	const fixture = await createAgentScenario(
		request,
		"user-interruption",
		"mission-pilot-agent-user-interruption-",
	);
	try {
		await playAgentScenario(request, fixture);
		await expect
			.poll(
				async () => {
					const execution = await readAgentExecution(request, fixture.taskId);
					return (
						execution.agent?.visibleItems?.some(
							(item) => item.kind === "wait",
						) ?? false
					);
				},
				{ timeout: 30_000 },
			)
			.toBe(true);
		const message = await request.post(
			`/api/tasks/${fixture.taskId}/messages`,
			{
				headers: agentScenarioHeaders,
				data: { prompt: "追加指示: 現在の判断を維持して続けてください。" },
			},
		);
		expect(message.status(), await message.text()).toBe(200);
		try {
			await expect
				.poll(
					async () => {
						const execution = await readAgentExecution(request, fixture.taskId);
						return (
							execution.agent?.visibleItems?.some(
								(item) =>
									item.kind === "assistant" &&
									item.content?.includes("追加指示を反映しました") === true,
							) ?? false
						);
					},
					{ timeout: 30_000 },
				)
				.toBe(true);
		} catch (error) {
			const execution = await readAgentExecution(request, fixture.taskId);
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(execution)}`,
			);
		}
		const task = await request.get(`/api/tasks/${fixture.taskId}`, {
			headers: agentScenarioHeaders,
		});
		expect((await task.json()).status).not.toBe("completed");
	} finally {
		await cleanupAgentScenario(request, fixture);
	}
});
