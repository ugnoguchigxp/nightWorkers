import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, taskEvents, taskRuns, tasks } from "../api/db/schema";
import { associatePreparedTaskRun } from "../api/modules/agentsShare";
import {
	CODING_AGENT_REQUEST_ASSOCIATION_KIND,
	initializeCodingAgentRunHandlers,
} from "../api/modules/codingAgent/application/coding-agent-run.handler";
import { executeIdempotentTaskOperatorCommand } from "../api/modules/commandDelivery";
import { readTaskOperatorResource } from "../api/modules/taskOperator";
import { composeTaskOperatorCommandCatalog } from "../api/modules/taskOperator/policies/task-operator-command-catalog";
import { overlayTaskOperatorSession } from "../src/modules/nightworkers/hooks/taskOperatorSessionProjection";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
});

async function taskFixture(objective = "objective") {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	await db.insert(repositories).values({
		id: repositoryId,
		name: "Task Operator regression",
		localPath: "/tmp/task-operator-regression",
		branch: "main",
	});
	const [task] = await db
		.insert(tasks)
		.values({
			id: taskId,
			repositoryId,
			title: "Task Operator regression",
			objective,
			acceptanceCriteria: objective,
			status: "ready",
		})
		.returning();
	if (!task) throw new Error("Task fixture was not created");
	return { task, repositoryId };
}

describe("Task Operator review regressions", () => {
	it("registers the requester-neutral Run association before runtime launch", async () => {
		initializeCodingAgentRunHandlers();
		const { task, repositoryId } = await taskFixture();
		const [run] = await db
			.insert(taskRuns)
			.values({
				taskId: task.id,
				repositoryId,
				status: "running",
				workerKind: "native-api",
			})
			.returning();
		if (!run) throw new Error("Run fixture was not created");
		await associatePreparedTaskRun({
			taskId: task.id,
			runId: run.id,
			request: {
				kind: CODING_AGENT_REQUEST_ASSOCIATION_KIND,
				payload: {
					requestProvenance: {
						requestedBy: { kind: "human", actorId: "ui" },
						orchestrationRef: {
							kind: "task_operator_command",
							id: "delivery-1",
						},
					},
				},
			},
		});
		const events = await db
			.select()
			.from(taskEvents)
			.where(eq(taskEvents.taskRunId, run.id));
		expect(JSON.stringify(events)).toContain("delivery-1");
	});

	it("pages full Task text and preserves the untruncated UI value", async () => {
		const objective = "目標".repeat(8_000);
		const { task } = await taskFixture(objective);
		const first = await readTaskOperatorResource({
			taskId: task.id,
			resourceKind: "task_text",
			resourceId: "objective",
			context: {
				principal: {
					kind: "human",
					actorId: "ui",
					authorizationRef: "test",
				},
			},
		});
		expect(first.hasMore).toBe(true);
		expect(first.content.text.length).toBe(4_000);
		let collected = first.content.text;
		let cursor = first.nextCursor;
		while (cursor !== null) {
			const page = await readTaskOperatorResource({
				taskId: task.id,
				resourceKind: "task_text",
				resourceId: "objective",
				cursor,
				context: {
					principal: {
						kind: "human",
						actorId: "ui",
						authorizationRef: "test",
					},
				},
			});
			expect(page.sourceDigest).toBe(first.sourceDigest);
			collected += page.content.text;
			cursor = page.nextCursor;
		}
		expect(collected).toBe(objective);

		const overlaid = overlayTaskOperatorSession(
			task as never,
			{
				task: {
					id: task.id,
					title: task.title,
					status: task.status,
					objective: {
						text: objective.slice(0, 1_000),
						truncated: true,
						sourceRevision: task.updatedAt.getTime(),
						sourceDigest: "digest",
					},
					acceptanceCriteria: null,
				},
			} as never,
		);
		expect(overlaid?.objective).toBe(objective);
	});

	it("replays one command delivery and rejects key reuse", async () => {
		const execute = vi.fn(async () => ({ value: crypto.randomUUID() }));
		const context = {
			principal: {
				kind: "human" as const,
				actorId: crypto.randomUUID(),
				authorizationRef: "test",
			},
			requestId: crypto.randomUUID(),
			idempotencyKey: crypto.randomUUID(),
		};
		const input = {
			taskId: crypto.randomUUID(),
			actionId: "task.update",
			expectedTaskRevision: 1,
			arguments: { fields: { title: "same" } },
			context,
			execute,
		};
		const first = await executeIdempotentTaskOperatorCommand(input);
		const replay = await executeIdempotentTaskOperatorCommand(input);
		expect(replay).toEqual(first);
		expect(execute).toHaveBeenCalledTimes(1);
		await expect(
			executeIdempotentTaskOperatorCommand({
				...input,
				arguments: { fields: { title: "different" } },
			}),
		).rejects.toMatchObject({ code: "TASK_OPERATOR_IDEMPOTENCY_CONFLICT" });
	});

	it("exposes archive only at its valid completed precondition", () => {
		const catalog = composeTaskOperatorCommandCatalog({
			taskRevision: 1,
			taskStatus: "completed",
			repositoryAvailable: true,
			hasActiveRun: false,
			hasTerminalRun: true,
			currentTodoStatus: null,
		});
		expect(
			catalog.find((command) => command.id === "task.archive")?.availability,
		).toBe("available");
	});
});
