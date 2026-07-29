import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	activityArtifacts,
	repositories,
	taskEvents,
	taskMessages,
	taskOperatorCommandReceipts,
	taskRunCommitRecords,
	taskRuns,
	taskRunTodos,
	tasks,
} from "../api/db/schema";
import { verificationEvidenceRuns } from "../api/db/verification-schema";
import { associatePreparedTaskRun } from "../api/modules/agentsShare";
import {
	CODING_AGENT_REQUEST_ASSOCIATION_KIND,
	initializeCodingAgentRunHandlers,
} from "../api/modules/codingAgent/application/coding-agent-run.handler";
import {
	executeIdempotentTaskOperatorCommand,
	readTaskOperatorCommandReceipt,
} from "../api/modules/commandDelivery";
import {
	humanTaskOperatorQueryContext,
	readTaskOperatorResource,
} from "../api/modules/taskOperator";
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
			context: humanTaskOperatorQueryContext(),
		});
		expect(first.hasMore).toBe(true);
		expect(first.content.text.length).toBeGreaterThan(0);
		expect(first.content.text.length).toBeLessThanOrEqual(4_000);
		expect(first.nextCursor).toBeGreaterThan(first.cursor);
		let collected = first.content.text;
		let cursor = first.nextCursor;
		while (cursor !== null) {
			const page = await readTaskOperatorResource({
				taskId: task.id,
				resourceKind: "task_text",
				resourceId: "objective",
				cursor,
				context: humanTaskOperatorQueryContext(),
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

	it("recovers a timeline entry's full canonical message through task_message paging", async () => {
		const { task } = await taskFixture();
		const content = "長文メッセージ".repeat(3_000);
		const [message] = await db
			.insert(taskMessages)
			.values({
				taskId: task.id,
				role: "user",
				content,
				messageType: "text",
			})
			.returning();
		if (!message) throw new Error("message fixture was not created");
		const timeline = await readTaskOperatorResource({
			taskId: task.id,
			resourceKind: "task_timeline",
			context: humanTaskOperatorQueryContext(),
		});
		expect(timeline.content.entries[0]).toMatchObject({
			id: message.id,
			contentTruncated: true,
		});
		let collected = "";
		let cursor: number | null = 0;
		let digest: string | null = null;
		while (cursor !== null) {
			const page = await readTaskOperatorResource({
				taskId: task.id,
				resourceKind: "task_message",
				resourceId: message.id,
				cursor,
				context: humanTaskOperatorQueryContext(),
			});
			digest ??= page.sourceDigest;
			expect(page.sourceDigest).toBe(digest);
			collected += page.content.text;
			cursor = page.nextCursor;
		}
		expect(collected).toBe(content);
	});

	it("keeps escaped timeline and message pages within budget while advancing", async () => {
		const { task } = await taskFixture();
		const content = '"quoted"\\path\\\n\t'.repeat(2_000);
		const [message] = await db
			.insert(taskMessages)
			.values({
				taskId: task.id,
				role: "user",
				content,
				messageType: "text",
			})
			.returning();
		if (!message) throw new Error("message fixture was not created");

		const timeline = await readTaskOperatorResource({
			taskId: task.id,
			resourceKind: "task_timeline",
			context: humanTaskOperatorQueryContext(),
		});
		expect(timeline.content.entries).toHaveLength(1);
		expect(timeline.content.entries[0]).toMatchObject({
			id: message.id,
			contentTruncated: true,
		});
		expect(timeline.tokenEstimate).toBeLessThanOrEqual(4_000);

		let collected = "";
		let cursor: number | null = 0;
		while (cursor !== null) {
			const page = await readTaskOperatorResource({
				taskId: task.id,
				resourceKind: "task_message",
				resourceId: message.id,
				cursor,
				context: humanTaskOperatorQueryContext(),
			});
			expect(page.tokenEstimate).toBeLessThanOrEqual(4_000);
			if (page.hasMore) {
				expect(page.nextCursor).not.toBeNull();
				expect(page.nextCursor).toBeGreaterThan(cursor);
			}
			collected += page.content.text;
			cursor = page.nextCursor;
		}
		expect(collected).toBe(content);
	});

	it("projects a terminal Run outcome with blockers, verification, changed paths, and artifacts", async () => {
		const { task, repositoryId } = await taskFixture();
		const [run] = await db
			.insert(taskRuns)
			.values({
				taskId: task.id,
				repositoryId,
				status: "failed",
				summary: "verification failed",
				finalReport: "One check failed.",
			})
			.returning();
		if (!run) throw new Error("run fixture was not created");
		await Promise.all([
			db.insert(taskRunTodos).values({
				runId: run.id,
				todoKey: "verify",
				seq: 1,
				title: "Verify",
				taskType: "verification",
				status: "needs_human",
				lastFailure: "A credential is required.",
			}),
			db.insert(taskRunCommitRecords).values({
				runId: run.id,
				repositoryId,
				ownedCandidatePathsJson: ["src/changed.ts"],
				stageableOwnedPathsJson: ["src/changed.ts"],
				verificationStatus: "failed",
			}),
			db.insert(verificationEvidenceRuns).values({
				taskId: task.id,
				runId: run.id,
				checkKind: "test",
				command: "redacted from operator outcome",
				cwd: "/registered/repository",
				exitCode: 1,
				runner: "test",
				rawStdoutArtifactId: "stdout-1",
				rawStderrArtifactId: "stderr-1",
				summaryJson: { passed: 0, failed: 1 },
				commandLevelConditionIdsJson: [],
				startedAt: new Date(),
				finishedAt: new Date(),
			}),
			db.insert(activityArtifacts).values({
				taskId: task.id,
				runId: run.id,
				kind: "diff",
				path: "artifacts/change.diff",
			}),
		]);
		const page = await readTaskOperatorResource({
			taskId: task.id,
			resourceKind: "run_outcome",
			resourceId: run.id,
			context: humanTaskOperatorQueryContext(),
		});
		const outcome = JSON.parse(page.content.json);
		expect(outcome).toMatchObject({
			id: run.id,
			status: "failed",
			blocker: {
				status: "needs_human",
				reason: "A credential is required.",
			},
			verification: {
				status: "failed",
				checks: [{ checkKind: "test", exitCode: 1 }],
			},
			changedPaths: ["src/changed.ts"],
			artifactRefs: [{ kind: "diff", path: "artifacts/change.diff" }],
		});
		expect(page.content.json).not.toContain("redacted from operator outcome");
	});

	it("reconstructs an escaping-heavy Run outcome from progressing bounded pages", async () => {
		const { task, repositoryId } = await taskFixture();
		const finalReport = '"failure"\\trace\\\n\t'.repeat(2_000);
		const [run] = await db
			.insert(taskRuns)
			.values({
				taskId: task.id,
				repositoryId,
				status: "failed",
				summary: "escaped outcome",
				finalReport,
			})
			.returning();
		if (!run) throw new Error("run fixture was not created");

		let serialized = "";
		let cursor: number | null = 0;
		let sourceDigest: string | null = null;
		while (cursor !== null) {
			const page = await readTaskOperatorResource({
				taskId: task.id,
				resourceKind: "run_outcome",
				resourceId: run.id,
				cursor,
				context: humanTaskOperatorQueryContext(),
			});
			sourceDigest ??= page.sourceDigest;
			expect(page.sourceDigest).toBe(sourceDigest);
			expect(page.tokenEstimate).toBeLessThanOrEqual(4_000);
			if (page.hasMore) {
				expect(page.nextCursor).not.toBeNull();
				expect(page.nextCursor).toBeGreaterThan(cursor);
			}
			serialized += page.content.json;
			cursor = page.nextCursor;
		}
		expect(JSON.parse(serialized)).toMatchObject({
			id: run.id,
			finalReport,
		});
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
		expect(replay.data).toEqual(first.data);
		expect(replay.receipt).toEqual({
			...first.receipt,
			replayed: true,
		});
		expect(execute).toHaveBeenCalledTimes(1);
		await expect(
			executeIdempotentTaskOperatorCommand({
				...input,
				arguments: { fields: { title: "different" } },
			}),
		).rejects.toMatchObject({ code: "TASK_OPERATOR_IDEMPOTENCY_CONFLICT" });
	});

	it("looks up command receipts by actor kind as well as actor id", async () => {
		const actorId = crypto.randomUUID();
		const idempotencyKey = crypto.randomUUID();
		await db.insert(taskOperatorCommandReceipts).values([
			{
				actorKind: "human",
				actorId,
				taskId: "human-task",
				actionId: "task.update",
				idempotencyKey,
				argumentsDigest: "human",
				status: "succeeded",
			},
			{
				actorKind: "delegated_user",
				actorId,
				taskId: "delegated-task",
				actionId: "task.message.send",
				idempotencyKey,
				argumentsDigest: "delegated",
				status: "pending",
			},
		]);
		await expect(
			readTaskOperatorCommandReceipt({
				actorKind: "delegated_user",
				actorId,
				idempotencyKey,
			}),
		).resolves.toMatchObject({
			actorKind: "delegated_user",
			taskId: "delegated-task",
		});
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
