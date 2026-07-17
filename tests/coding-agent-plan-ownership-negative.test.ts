import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	associatePreparedTaskRun,
	continueAfterTaskRun,
	projectTaskRunParentStatus,
	registerTaskRunAssociationHandler,
	registerTaskRunCloseoutHandler,
} from "../api/modules/agentsShare";
import { codingAgentForbiddenPlanTools } from "../api/modules/codingAgent";
import {
	buildCodingAgentSystemContext,
	buildCodingAgentTaskGoal,
	CODING_AGENT_TODO_REQUIREMENT_JA,
	CODING_AGENT_TOOL_CONTRACT_JA,
	resolveCodingAgentInvocationSource,
} from "../api/modules/codingAgent/context/system-context";
import { nativeApiToolRegistrations } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-manifest";
import { projectCodingAgentTaskStatusAfterRun } from "../api/modules/codingAgent/runtime/task-status-projection";

describe("Coding Agent Plan ownership negative contract", () => {
	it("keeps objective and acceptance criteria in the standalone Task Goal", () => {
		expect(
			buildCodingAgentTaskGoal({
				title: "Agent境界を分離する",
				objective: "Mission Pilotなしでも完結させる",
				description: "既存runtimeを維持する",
				acceptanceCriteria: "計画、実装、検証が成功する",
			}),
		).toContain("目的: Mission Pilotなしでも完結させる");
		expect(
			buildCodingAgentTaskGoal({
				title: "Agent境界を分離する",
				objective: "Mission Pilotなしでも完結させる",
				acceptanceCriteria: "計画、実装、検証が成功する",
			}),
		).toContain("完了条件: 計画、実装、検証が成功する");
	});

	it("does not expose Plan mutation tools in the native runtime", () => {
		expect(
			nativeApiToolRegistrations.some((registration) =>
				codingAgentForbiddenPlanTools.includes(registration.name),
			),
		).toBe(false);
	});

	it("keeps Questionnaire, routing, and Artifact ownership out of Coding Agent context", () => {
		expect(CODING_AGENT_TODO_REQUIREMENT_JA).not.toContain(
			"Questionnaireを必ず作成",
		);
		expect(CODING_AGENT_TODO_REQUIREMENT_JA).not.toContain("request_input");
		expect(CODING_AGENT_TOOL_CONTRACT_JA).toContain(
			"Questionnaire、routing、Artifactのmutation toolはありません",
		);
	});

	it("lets a user-started Coding Agent create a plan without waiting for Mission Pilot", () => {
		const context = buildCodingAgentSystemContext({
			taskGoal: "ユーザーの変更依頼を実装する",
			registeredRepositoryRoot: "/repo",
			invocationSource: "user",
			planModeRequested: true,
		});

		expect(context).toMatchObject({
			invocationSource: "user",
			planModeRequested: true,
		});
		expect(context.todoRequirementJa).toContain(
			"Mission Pilotの起動やhandoffを待たず",
		);
		expect(context.todoRequirementJa).toContain("Plan Modeから開始されました");
		expect(context.todoRequirementJa).toContain(
			"このPlan Mode Run内では実装せず",
		);
		expect(context.todoRequirementJa).not.toContain(
			"このRunはMission Pilotからの明示的なhandoff",
		);
	});

	it("applies Mission Pilot handoff constraints only to Mission Pilot-started runs", () => {
		const context = buildCodingAgentSystemContext({
			taskGoal: "確定済み設計を実装する",
			registeredRepositoryRoot: "/repo",
			invocationSource: "mission_pilot",
		});

		expect(context.invocationSource).toBe("mission_pilot");
		expect(context.todoRequirementJa).toContain(
			"このRunはMission Pilotからの明示的なhandoff",
		);
		expect(context.todoRequirementJa).toContain(
			"具体的なblockerとしてMission Pilotへ返してください",
		);
	});

	it("resolves invocation provenance structurally instead of from user wording", () => {
		expect(
			resolveCodingAgentInvocationSource({
				codingAgentInvocation: { source: "user" },
				missionPilot: { stale: true },
			}),
		).toBe("user");
		expect(
			resolveCodingAgentInvocationSource({
				missionPilotAgent: { id: "pilot" },
			}),
		).toBe("user");
		expect(
			resolveCodingAgentInvocationSource({
				codingAgentInvocation: { source: "mission_pilot" },
			}),
		).toBe("mission_pilot");
	});

	it("returns a completed standalone Plan Mode task to ready for implementation", () => {
		expect(
			projectCodingAgentTaskStatusAfterRun({
				runStatus: "completed",
				invocationSource: "user",
				planModeRequested: true,
			}),
		).toBe("ready");
		expect(
			projectCodingAgentTaskStatusAfterRun({
				runStatus: "completed",
				invocationSource: "mission_pilot",
				planModeRequested: true,
			}),
		).toBeNull();
	});

	it("keeps the standalone run entry and association launch free of Mission Pilot imports", () => {
		for (const relativePath of [
			"../api/modules/nightworkers/run-orchestration/start-task-run-entry.ts",
			"../api/modules/nightworkers/run-orchestration/start-task-run-launch.ts",
			"../api/modules/nightworkers/run-orchestration/start-task-run.ts",
			"../api/modules/nightworkers/run-orchestration/runtime-execution.ts",
			"../api/modules/nightworkers/run-orchestration/runtime-execution-failure.ts",
			"../api/modules/nightworkers/run-orchestration/queues.ts",
		]) {
			const source = readFileSync(
				new URL(relativePath, import.meta.url),
				"utf8",
			);
			expect(source).not.toMatch(/from ["'][^"']*missionPilot/);
		}
		const workerSource = readFileSync(
			new URL("../api/workers/task-run-worker.ts", import.meta.url),
			"utf8",
		);
		expect(workerSource).not.toMatch(/import .* from ["'][^"']*missionPilot/);
		expect(workerSource).toMatch(
			/codingAgentInvocationSource\s*===\s*"mission_pilot"/,
		);
		expect(workerSource).toContain(
			"ensureNightWorkersSchema({ includeMissionPilot: missionPilotRun })",
		);
	});

	it("associates optional role-owned runs through the agent-neutral port", async () => {
		const received: unknown[] = [];
		const unregister = registerTaskRunAssociationHandler(
			"coding_agent_boundary_test",
			(input) => received.push(input),
		);
		try {
			await associatePreparedTaskRun({ taskId: "task-1", runId: "run-1" });
			await associatePreparedTaskRun({
				taskId: "task-1",
				runId: "run-1",
				request: {
					kind: "coding_agent_boundary_test",
					payload: { source: "external_role" },
				},
			});
		} finally {
			unregister();
		}
		expect(received).toEqual([
			{
				taskId: "task-1",
				runId: "run-1",
				payload: { source: "external_role" },
			},
		]);
	});

	it("uses the standalone parent status when no external role claims closeout", async () => {
		const continued: string[] = [];
		const unregister = registerTaskRunCloseoutHandler({
			continueAfterRun: ({ runId }) => continued.push(runId),
		});
		try {
			await expect(
				projectTaskRunParentStatus({
					taskId: "task-1",
					runId: "run-1",
					runStatus: "completed",
					executionMode: "implementation",
				}),
			).resolves.toEqual({ handled: false, status: "completed" });
			await continueAfterTaskRun({
				taskId: "task-1",
				runId: "run-1",
				runStatus: "completed",
				executionMode: "implementation",
			});
		} finally {
			unregister();
		}
		expect(continued).toEqual(["run-1"]);
	});
});
