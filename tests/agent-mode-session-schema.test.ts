import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { agentModeSessions, taskRuns } from "../api/db/schema";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import {
	buildAgentModeSessionRouteIdentity,
	resolveOrOpenAgentModeSession,
} from "../api/services/agent-runtime/agent-mode-session";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("AgentModeSession schema and resolver", () => {
	it("reuses same route, opens mode epochs, and never reuses a re-entered mode", async () => {
		const repository = await repo.createRepository({
			name: `TEST: agent mode session ${crypto.randomUUID()}`,
			localPath: "/tmp/agent-mode-session",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: agent mode session",
			status: "draft",
		});
		const route = (executionMode: "implementation" | "test") => ({
			runtimeLane: "codex-sdk",
			provider: "codex",
			providerEndpointId: "codex-default",
			model: "gpt-5",
			thinkingDepth: "high",
			fingerprint: buildAgentModeSessionRouteIdentity({
				executionMode,
				llmRole: executionMode,
				runtimeLane: "codex-sdk",
				provider: "codex",
				providerEndpointId: "codex-default",
				model: "gpt-5",
				thinkingDepth: "high",
			}),
			continuationEligible: true,
		});
		const open = async (executionMode: "implementation" | "test") =>
			db.transaction(async (tx) => {
				const result = await resolveOrOpenAgentModeSession(tx, {
					taskId: task.id,
					repositoryId: repository.id,
					executionMode,
					llmRole: executionMode,
					routeIdentity: route(executionMode),
				});
				const [run] = await tx
					.insert(taskRuns)
					.values({
						taskId: task.id,
						repositoryId: repository.id,
						agentModeSessionId: result.session.id,
						status: "running",
						startedAt: new Date(),
					})
					.returning();
				return { result, run };
			});

		const first = await open("implementation");
		const retry = await open("implementation");
		const test = await open("test");
		const reentered = await open("implementation");

		expect(first.result.transition).toBe("opened");
		expect(retry.result.transition).toBe("reused");
		expect(retry.result.session.id).toBe(first.result.session.id);
		expect(test.result.session.id).not.toBe(first.result.session.id);
		expect(reentered.result.session.id).not.toBe(first.result.session.id);
		expect(reentered.result.session.epoch).toBe(3);
		expect(reentered.run?.agentModeSessionId).toBe(reentered.result.session.id);

		const sessions = await db
			.select()
			.from(agentModeSessions)
			.where(eq(agentModeSessions.taskId, task.id));
		expect(sessions.map((session) => session.epoch)).toEqual([1, 2, 3]);
		expect(
			sessions.filter((session) => session.status === "active"),
		).toHaveLength(1);
	});
});
