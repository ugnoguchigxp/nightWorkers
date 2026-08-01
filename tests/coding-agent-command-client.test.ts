import { describe, expect, it, vi } from "vitest";
import type { CodingAgentCommandRequestV1 } from "../shared/modules/codingAgent";
import {
	CodingAgentCommandClient,
	CodingAgentCommandError,
	createCodingAgentCommandRequest,
} from "../src/modules/codingAgent";

const request: CodingAgentCommandRequestV1 = {
	version: 1,
	type: "coding_agent.command.execute",
	requestId: "00000000-0000-4000-8000-000000000001",
	idempotencyKey: "00000000-0000-4000-8000-000000000001",
	taskId: "00000000-0000-4000-8000-000000000002",
	actionId: "run.implementation.start",
	expectedTaskRevision: 1,
	arguments: {},
};

function success(replayed = false) {
	return {
		version: 1 as const,
		type: "coding_agent.command.result" as const,
		requestId: request.requestId,
		result: {
			ok: true as const,
			receipt: {
				commandId: "command-1",
				idempotencyKey: request.idempotencyKey,
				actionId: request.actionId,
				operationRef: null,
				resourceRefs: [],
				replayed,
			},
			data: {
				taskId: request.taskId,
				runId: "00000000-0000-4000-8000-000000000003",
			},
		},
	};
}

function connection(input: {
	capability: boolean;
	response?: ReturnType<typeof success>;
	error?: Error;
}) {
	return {
		hasCapability: vi.fn(() => input.capability),
		requestCodingAgentCommand: vi.fn(async () => {
			if (input.error) throw input.error;
			return input.response ?? success();
		}),
	};
}

describe("CodingAgentCommandClient", () => {
	it("validates a generated command before selecting a transport", () => {
		expect(() =>
			createCodingAgentCommandRequest({
				taskId: "not-a-task-id",
				actionId: "run.implementation.start",
				expectedTaskRevision: 1,
				arguments: {},
			}),
		).toThrow();
	});

	it("uses WebSocket when the server advertises the capability", async () => {
		const realtime = connection({ capability: true });
		const restSender = vi.fn(async () => success());
		const client = new CodingAgentCommandClient({
			getConnection: () => realtime as never,
			restSender,
		});

		await expect(client.execute(request)).resolves.toMatchObject({ ok: true });
		expect(realtime.requestCodingAgentCommand).toHaveBeenCalledWith(
			request,
			10_000,
		);
		expect(restSender).not.toHaveBeenCalled();
	});

	it.each([
		false,
		null,
	])("uses REST when WebSocket capability/connection is %s", async (available) => {
		const realtime = connection({ capability: Boolean(available) });
		const restSender = vi.fn(async () => success());
		const client = new CodingAgentCommandClient({
			getConnection: () => (available === null ? null : (realtime as never)),
			restSender,
		});

		await client.execute(request);
		expect(restSender).toHaveBeenCalledWith(request);
		expect(realtime.requestCodingAgentCommand).not.toHaveBeenCalled();
	});

	it("falls back with the exact same request after WebSocket failure", async () => {
		const realtime = connection({
			capability: true,
			error: new Error("timeout"),
		});
		const restSender = vi.fn(async (fallbackRequest) => {
			expect(fallbackRequest).toBe(request);
			return success(true);
		});
		const client = new CodingAgentCommandClient({
			getConnection: () => realtime as never,
			restSender,
		});

		await expect(client.execute(request)).resolves.toMatchObject({
			receipt: { replayed: true },
		});
		expect(restSender).toHaveBeenCalledTimes(1);
	});

	it("does not retry a revision conflict with a new request", async () => {
		const restSender = vi.fn(async () => ({
			version: 1 as const,
			type: "coding_agent.command.result" as const,
			requestId: request.requestId,
			result: {
				ok: false as const,
				error: {
					kind: "revision_conflict" as const,
					code: "TASK_REVISION_CONFLICT",
					message: "Task revision changed.",
					retryable: false,
					currentRevision: 2,
				},
			},
		}));
		const client = new CodingAgentCommandClient({
			getConnection: () => null,
			restSender,
		});

		await expect(client.execute(request)).rejects.toBeInstanceOf(
			CodingAgentCommandError,
		);
		expect(restSender).toHaveBeenCalledTimes(1);
	});

	it("rejects a response correlated to a different request", async () => {
		const restSender = vi.fn(async () => ({
			...success(),
			requestId: "00000000-0000-4000-8000-000000000099",
		}));
		const client = new CodingAgentCommandClient({
			getConnection: () => null,
			restSender,
		});

		await expect(client.execute(request)).rejects.toThrow(
			"does not match the request",
		);
	});

	it("does not start REST fallback after the client is disposed", async () => {
		let rejectWebSocket: ((error: Error) => void) | undefined;
		const realtime = {
			hasCapability: vi.fn(() => true),
			requestCodingAgentCommand: vi.fn(
				() =>
					new Promise<ReturnType<typeof success>>((_resolve, reject) => {
						rejectWebSocket = reject;
					}),
			),
		};
		const restSender = vi.fn(async () => success());
		const client = new CodingAgentCommandClient({
			getConnection: () => realtime,
			restSender,
		});
		const pending = client.execute(request);
		client.dispose();
		rejectWebSocket?.(new Error("connection closed"));

		await expect(pending).rejects.toThrow("disposed");
		expect(restSender).not.toHaveBeenCalled();
	});

	it("ignores a completed response after the client is disposed", async () => {
		let resolveRest:
			| ((response: ReturnType<typeof success>) => void)
			| undefined;
		const restSender = vi.fn(
			() =>
				new Promise<ReturnType<typeof success>>((resolve) => {
					resolveRest = resolve;
				}),
		);
		const client = new CodingAgentCommandClient({
			getConnection: () => null,
			restSender,
		});
		const pending = client.execute(request);
		client.dispose();
		resolveRest?.(success());

		await expect(pending).rejects.toThrow("disposed");
	});
});
