import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import {
	TASK_OPERATOR_ACTION_DEFINITIONS,
	TASK_OPERATOR_COMMAND_IDS,
	validateTaskOperatorJsonSchema,
} from "../api/modules/taskOperator";
import { composeTaskOperatorCommandCatalog } from "../api/modules/taskOperator/policies/task-operator-command-catalog";
import {
	humanTaskOperatorCommandContext,
	humanTaskOperatorQueryContext,
} from "../api/modules/taskOperator/task-operator-http-context";
import {
	TASK_OPERATOR_HEAD_TOKEN_BUDGET,
	TASK_OPERATOR_MAX_LATEST_ARTIFACT_KINDS,
	taskOperatorCommandContextSchema,
	taskOperatorCommandResultSchema,
	taskOperatorContentPageSchema,
	taskOperatorProjectionV1Schema,
	taskOperatorQueryContextSchema,
} from "../shared/modules/taskOperator";
import { taskStatusSchema } from "../shared/schemas/nightworkers/repository-task.schema";

function projectionFixture() {
	return {
		version: 1 as const,
		sourceRevision: 12,
		sourceDigest: "task:12",
		task: {
			id: "task-1",
			revision: 12,
			status: "running" as const,
			title: "Task Operator projectionを実装する",
			objective: {
				text: "人間とautomationが同じbounded projectionを読む。",
				truncated: false,
				sourceRevision: 12,
				sourceDigest: "objective:12",
			},
			acceptanceCriteria: {
				text: "raw DB rowをproviderへ渡さない。",
				truncated: false,
				sourceRevision: 12,
				sourceDigest: "acceptance:12",
			},
		},
		project: {
			id: "project-1",
			revision: 10,
			repositoryState: "registered" as const,
		},
		questionnaire: {
			id: "questionnaire-1",
			revision: 3,
			status: "accepted",
			decisionDigest: "questionnaire:3",
			blockingQuestionCount: 0,
		},
		artifactIndex: {
			revision: 4,
			totalCount: 2,
			nextCursor: null,
			latestByKind: [
				{
					id: "artifact-1",
					kind: "implementation_plan",
					revision: 4,
					digest: "artifact:4",
					status: "ready",
				},
			],
		},
		queue: {
			id: "queue-1",
			revision: 2,
			status: "claimed",
			activeRunId: "run-1",
		},
		activeRun: {
			id: "run-1",
			revision: 7,
			status: "running",
			currentTodoRef: {
				id: "todo-1",
				revision: 2,
				status: "in_progress",
				blockerDigest: null,
			},
		},
		latestTerminalRun: {
			id: "run-0",
			revision: 9,
			status: "completed",
			outcomeDigest: "run:9",
		},
		commandCatalog: {
			revision: 8,
			availableIds: ["task.update", "run.stop"],
			confirmationRequiredIds: [],
			unavailableCount: 3,
		},
		unreadEvents: { from: 20, through: 22, types: ["task_run.started"] },
	};
}

describe("Task Operator contracts", () => {
	it("derives every advertised command ID from the canonical action definitions", () => {
		expect(TASK_OPERATOR_COMMAND_IDS).toEqual(
			TASK_OPERATOR_ACTION_DEFINITIONS.map((definition) => definition.actionId),
		);
		expect(new Set(TASK_OPERATOR_COMMAND_IDS).size).toBe(
			TASK_OPERATOR_COMMAND_IDS.length,
		);
		expect(TASK_OPERATOR_COMMAND_IDS).not.toContain(
			"questionnaire.draft.update",
		);
	});

	it("keeps every status accepted by the public Task patch route in task.update", () => {
		const definition = TASK_OPERATOR_ACTION_DEFINITIONS.find(
			(candidate) => candidate.actionId === "task.update",
		);
		expect(definition).toBeDefined();
		for (const status of taskStatusSchema.options) {
			expect(
				validateTaskOperatorJsonSchema(definition?.inputSchema ?? {}, {
					fields: { status },
				}),
			).toBeNull();
		}
		expect(
			validateTaskOperatorJsonSchema(definition?.inputSchema ?? {}, {
				fields: { status: "unknown" },
			}),
		).toContain("allowed values");
	});

	it("accepts an optional human note and keeps terminal Run review available", () => {
		const definition = TASK_OPERATOR_ACTION_DEFINITIONS.find(
			(candidate) => candidate.actionId === "run.review.submit",
		);
		expect(
			validateTaskOperatorJsonSchema(definition?.inputSchema ?? {}, {
				runId: "00000000-0000-4000-8000-000000000001",
				action: "complete",
				note: "Verified by the local operator.",
			}),
		).toBeNull();
		const catalog = composeTaskOperatorCommandCatalog({
			taskRevision: 2,
			taskStatus: "completed",
			repositoryAvailable: true,
			hasActiveRun: false,
			hasTerminalRun: true,
			currentTodoStatus: null,
		});
		expect(
			catalog.find((command) => command.id === "run.review.submit"),
		).toMatchObject({ availability: "available" });
	});

	it("accepts the public archive route's closeout-discard flag", () => {
		const definition = TASK_OPERATOR_ACTION_DEFINITIONS.find(
			(candidate) => candidate.actionId === "task.archive",
		);
		expect(
			validateTaskOperatorJsonSchema(definition?.inputSchema ?? {}, {
				discardPendingCloseouts: false,
			}),
		).toBeNull();
		expect(
			validateTaskOperatorJsonSchema(definition?.inputSchema ?? {}, {
				discardPendingCloseouts: "false",
			}),
		).toContain("boolean");
	});

	it("uses the stable local operator identity for HTTP command delivery", () => {
		const first = humanTaskOperatorCommandContext({
			idempotencyKey: "delivery-1",
		});
		const second = humanTaskOperatorCommandContext({
			idempotencyKey: "delivery-1",
		});

		expect(first.principal.actorId).toBe("local-task-operator-user");
		expect(second.principal.actorId).toBe("local-task-operator-user");
		expect(first.idempotencyKey).toBe(second.idempotencyKey);
		expect(humanTaskOperatorQueryContext().principal.actorId).toBe(
			"local-task-operator-user",
		);
	});

	it.each([
		"failed",
		"timed_out",
	])("does not advertise mutable commands for a %s Task", (status) => {
		const catalog = composeTaskOperatorCommandCatalog({
			taskRevision: 1,
			taskStatus: status,
			repositoryAvailable: true,
			hasActiveRun: false,
			hasTerminalRun: true,
			currentTodoStatus: null,
		});
		expect(
			catalog.find((command) => command.id === "questionnaire.submit"),
		).toMatchObject({
			availability: "unavailable",
			unavailableReasonCode: "task_terminal",
		});
	});

	it("round-trips a bounded head projection through the public schema", () => {
		const fixture = projectionFixture();
		expect(taskOperatorProjectionV1Schema.parse(fixture)).toEqual(fixture);
	});

	it("rejects unknown fields at the head and nested resource boundaries", () => {
		expect(() =>
			taskOperatorProjectionV1Schema.parse({
				...projectionFixture(),
				metadataJson: { provider: "must-not-leak" },
			}),
		).toThrow();

		expect(() =>
			taskOperatorProjectionV1Schema.parse({
				...projectionFixture(),
				activeRun: {
					...projectionFixture().activeRun,
					contextSnapshot: { transcript: "must-not-leak" },
				},
			}),
		).toThrow();
	});

	it("keeps query identity separate from mutation delivery metadata", () => {
		const principal = {
			kind: "automation" as const,
			actorId: "mission-pilot-session-1",
			authorizationRef: "grant-1",
		};

		expect(taskOperatorQueryContextSchema.parse({ principal })).toEqual({
			principal,
		});
		expect(() =>
			taskOperatorQueryContextSchema.parse({
				principal,
				idempotencyKey: "query-must-not-own-delivery-metadata",
			}),
		).toThrow();
		expect(
			taskOperatorCommandContextSchema.parse({
				principal,
				requestId: "request-1",
				idempotencyKey: "tool-call-1",
			}),
		).toMatchObject({ requestId: "request-1", idempotencyKey: "tool-call-1" });
	});

	it("strictly validates content pages and typed command results", () => {
		const pageSchema = taskOperatorContentPageSchema(
			z.object({ entries: z.array(z.string()) }).strict(),
		);
		expect(
			pageSchema.parse({
				sourceRef: { kind: "timeline", id: "task-1" },
				sourceRevision: 12,
				sourceDigest: "timeline:12",
				cursor: 0,
				nextCursor: 20,
				hasMore: true,
				tokenEstimate: 200,
				content: { entries: ["message-1"] },
			}),
		).toMatchObject({ hasMore: true, nextCursor: 20 });

		const resultSchema = taskOperatorCommandResultSchema(
			z.object({ revision: z.number().int().nonnegative() }).strict(),
		);
		const receipt = {
			commandId: "command-1",
			idempotencyKey: "key-1",
			actionId: "task.update",
			operationRef: { kind: "task", id: "task-1", revision: 13 },
			resourceRefs: [{ kind: "task", id: "task-1", revision: 13 }],
			replayed: false,
		};
		expect(
			resultSchema.parse({
				ok: true,
				receipt,
				data: { revision: 13 },
			}),
		).toEqual({
			ok: true,
			receipt,
			data: { revision: 13 },
		});
		expect(() =>
			resultSchema.parse({
				ok: false,
				error: {
					kind: "revision_conflict",
					code: "task_revision_conflict",
					message: "Task revision changed.",
					retryable: true,
					currentRevision: 13,
					rawRow: { id: "must-not-leak" },
				},
			}),
		).toThrow();
	});

	it("keeps the worst-case bounded fixture within the initial head budget", () => {
		const fixture = projectionFixture();
		fixture.task.objective = {
			...fixture.task.objective,
			text: "目".repeat(1_000),
			truncated: true,
		};
		fixture.task.acceptanceCriteria = {
			...fixture.task.acceptanceCriteria,
			text: "完".repeat(1_000),
			truncated: true,
		};
		fixture.artifactIndex.latestByKind = Array.from(
			{ length: TASK_OPERATOR_MAX_LATEST_ARTIFACT_KINDS },
			(_, index) => ({
				id: `artifact-${index}`,
				kind: `kind-${index}`,
				revision: index,
				digest: `digest-${index}`,
				status: "ready",
			}),
		);

		const parsed = taskOperatorProjectionV1Schema.parse(fixture);
		const tokenEstimate = Math.ceil(JSON.stringify(parsed).length / 4);
		expect(tokenEstimate).toBeLessThanOrEqual(TASK_OPERATOR_HEAD_TOKEN_BUDGET);
	});
});
