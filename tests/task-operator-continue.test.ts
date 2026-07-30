import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, taskMessages, taskRuns, tasks } from "../api/db/schema";
import { taskRunTodos } from "../api/db/schema-task-execution";
import {
	type ResumeCodingAgentRunTodoCommand,
	registerCodingAgentRunHandlers,
} from "../api/modules/agentsShare";
import {
	executeTaskOperatorCommand,
	humanTaskOperatorCommandContext,
	humanTaskOperatorQueryContext,
	readTaskOperatorProjection,
} from "../api/modules/taskOperator";

const repositoryIds: string[] = [];
let unregisterRunHandlers: (() => void) | null = null;

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	unregisterRunHandlers?.();
	unregisterRunHandlers = null;
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
});

describe("Task Operator continue", () => {
	it("projects needs_human as resumable and sends continue before resuming", async () => {
		const fixture = await createNeedsHumanFixture();
		let visibleMessageAtResume: typeof taskMessages.$inferSelect | null = null;
		const resume = vi.fn(async (command: ResumeCodingAgentRunTodoCommand) => {
			const [message] = await db
				.select()
				.from(taskMessages)
				.where(
					and(
						eq(taskMessages.taskId, fixture.taskId),
						eq(taskMessages.role, "user"),
					),
				);
			visibleMessageAtResume = message ?? null;
			return {
				runId: command.runId,
				taskId: fixture.taskId,
				status: "running",
			};
		});
		unregisterRunHandlers = registerCodingAgentRunHandlers({
			start: async (command) => ({
				runId: crypto.randomUUID(),
				taskId: command.taskId,
				status: "running",
			}),
			resume,
		});
		const projection = await readTaskOperatorProjection(
			fixture.taskId,
			humanTaskOperatorQueryContext(),
		);

		expect(projection.activeRun).toMatchObject({
			id: fixture.runId,
			status: "needs_human",
			currentTodoRef: {
				id: fixture.todoId,
				status: "needs_human",
			},
		});
		expect(projection.commandCatalog.availableIds).toContain("run.todo.resume");
		expect(projection.commandCatalog.availableIds).not.toContain(
			"run.implementation.start",
		);

		const result = await executeTaskOperatorCommand({
			taskId: fixture.taskId,
			actionId: "run.todo.resume",
			expectedTaskRevision: projection.task.revision,
			arguments: {
				runId: fixture.runId,
				todoId: fixture.todoId,
				expectedTodoRevision: fixture.todoRevision,
				userContext: "continue",
			},
			context: humanTaskOperatorCommandContext({
				idempotencyKey: `continue:${crypto.randomUUID()}`,
			}),
		});

		expect(visibleMessageAtResume).toMatchObject({
			id: result.data.messageId,
			content: "continue",
			metadataJson: expect.objectContaining({
				source: "task_operator",
				intent: "todo_resume_request",
				actor: expect.objectContaining({ kind: "human" }),
			}),
		});
		expect(resume).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: fixture.runId,
				todoId: fixture.todoId,
				userContext: "continue",
				requestProvenance: expect.objectContaining({
					requestedBy: expect.objectContaining({ kind: "human" }),
				}),
			}),
		);
	});
});

async function createNeedsHumanFixture() {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	await db.insert(repositories).values({
		id: repositoryId,
		name: "Task Operator continue",
		localPath: "/tmp/task-operator-continue",
		branch: "main",
	});
	const [task] = await db
		.insert(tasks)
		.values({
			id: taskId,
			repositoryId,
			title: "Continue a paused Coding Agent",
			objective: "実装を継続する",
			acceptanceCriteria: "Coding Agentが再開する",
			status: "ready",
		})
		.returning();
	const [run] = await db
		.insert(taskRuns)
		.values({
			taskId,
			repositoryId,
			status: "needs_human",
		})
		.returning();
	const [todo] = await db
		.insert(taskRunTodos)
		.values({
			runId: run.id,
			todoKey: "continue",
			seq: 1,
			title: "実装を継続する",
			taskType: "implementation",
			status: "needs_human",
		})
		.returning();
	return {
		taskId: task.id,
		runId: run.id,
		todoId: todo.id,
		todoRevision: todo.revision,
	};
}
