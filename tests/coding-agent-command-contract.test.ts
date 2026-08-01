import { describe, expect, it } from "vitest";
import {
	codingAgentCommandRequestV1Schema,
	codingAgentCommandResponseV1Schema,
} from "../shared/modules/codingAgent";

const taskId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const todoId = "00000000-0000-4000-8000-000000000003";

function base() {
	return {
		version: 1,
		type: "coding_agent.command.execute",
		requestId: "00000000-0000-4000-8000-000000000004",
		idempotencyKey: "delivery-1",
		taskId,
		expectedTaskRevision: 2,
	};
}

describe("Coding Agent command contract", () => {
	it.each([
		{
			...base(),
			actionId: "run.implementation.start",
			arguments: {},
		},
		{
			...base(),
			actionId: "run.stop",
			arguments: { runId },
		},
		{
			...base(),
			actionId: "run.todo.resume",
			arguments: {
				runId,
				todoId,
				expectedTodoRevision: 1,
				userContext: "検証環境を使用してください。",
			},
		},
	])("accepts $actionId", (request) => {
		expect(codingAgentCommandRequestV1Schema.parse(request)).toEqual(request);
	});

	it("rejects caller-supplied principals and unknown fields", () => {
		for (const request of [
			{
				...base(),
				actionId: "run.implementation.start",
				arguments: {},
				principal: { kind: "automation", actorId: "spoofed" },
			},
			{
				...base(),
				actionId: "run.stop",
				arguments: { runId, unknown: true },
			},
		]) {
			expect(codingAgentCommandRequestV1Schema.safeParse(request).success).toBe(
				false,
			);
		}
	});

	it("enforces identifiers, revisions, and bounded instructions", () => {
		for (const request of [
			{
				...base(),
				requestId: "not-a-uuid",
				actionId: "run.implementation.start",
				arguments: {},
			},
			{
				...base(),
				expectedTaskRevision: -1,
				actionId: "run.implementation.start",
				arguments: {},
			},
			{
				...base(),
				actionId: "run.implementation.start",
				arguments: { request: "x".repeat(20_001) },
			},
		]) {
			expect(codingAgentCommandRequestV1Schema.safeParse(request).success).toBe(
				false,
			);
		}
	});

	it("validates success and failure responses", () => {
		const envelope = {
			version: 1,
			type: "coding_agent.command.result",
			requestId: base().requestId,
		};
		const receipt = {
			commandId: "command-1",
			idempotencyKey: "delivery-1",
			actionId: "run.stop",
			operationRef: null,
			resourceRefs: [],
			replayed: false,
		};
		expect(
			codingAgentCommandResponseV1Schema.safeParse({
				...envelope,
				result: { ok: true, receipt, data: { taskId, runId } },
			}).success,
		).toBe(true);
		expect(
			codingAgentCommandResponseV1Schema.safeParse({
				...envelope,
				result: {
					ok: false,
					error: {
						kind: "revision_conflict",
						code: "TASK_REVISION_CONFLICT",
						message: "Task revision changed.",
						retryable: false,
						currentRevision: 3,
					},
				},
			}).success,
		).toBe(true);
	});
});
