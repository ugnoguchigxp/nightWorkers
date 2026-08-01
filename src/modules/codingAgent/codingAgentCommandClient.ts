import {
	CODING_AGENT_COMMAND_WS_CAPABILITY,
	type CodingAgentCommandRequestV1,
	type CodingAgentCommandResponseV1,
	codingAgentCommandRequestV1Schema,
	codingAgentCommandResponseV1Schema,
} from "../../../shared/modules/codingAgent";
import type { TaskOperatorFailure } from "../../../shared/modules/taskOperator";
import { apiFetch } from "../../lib/api-base";
import { jsonRequest } from "../../lib/api-request";

export type CodingAgentCommandConnection = {
	hasCapability(capability: string): boolean;
	requestCodingAgentCommand(
		request: CodingAgentCommandRequestV1,
		timeoutMs: number,
	): Promise<CodingAgentCommandResponseV1>;
};

export const CODING_AGENT_COMMAND_TIMEOUT_MS = 10_000;

export class CodingAgentCommandError extends Error {
	constructor(public readonly failure: TaskOperatorFailure) {
		super(failure.message);
		this.name = "CodingAgentCommandError";
	}
}

export type CodingAgentCommandClientOptions = {
	getConnection: () => CodingAgentCommandConnection | null;
	restSender?: (
		request: CodingAgentCommandRequestV1,
	) => Promise<CodingAgentCommandResponseV1>;
	timeoutMs?: number;
};

export class CodingAgentCommandClient {
	private disposed = false;
	private readonly pendingRequestIds = new Set<string>();

	constructor(private readonly options: CodingAgentCommandClientOptions) {}

	async execute(request: CodingAgentCommandRequestV1) {
		this.assertActive();
		if (this.pendingRequestIds.has(request.requestId))
			throw new Error("Coding Agent command request is already pending.");
		this.pendingRequestIds.add(request.requestId);
		try {
			const connection = this.options.getConnection();
			let response: CodingAgentCommandResponseV1;
			if (connection?.hasCapability(CODING_AGENT_COMMAND_WS_CAPABILITY)) {
				try {
					response = await connection.requestCodingAgentCommand(
						request,
						this.options.timeoutMs ?? CODING_AGENT_COMMAND_TIMEOUT_MS,
					);
				} catch {
					this.assertActive();
					response = await (this.options.restSender ?? sendRestCommand)(
						request,
					);
				}
			} else {
				response = await (this.options.restSender ?? sendRestCommand)(request);
			}
			this.assertActive();
			if (response.requestId !== request.requestId)
				throw new Error(
					"Coding Agent command response does not match the request.",
				);
			if (!response.result.ok)
				throw new CodingAgentCommandError(response.result.error);
			return response.result;
		} finally {
			this.pendingRequestIds.delete(request.requestId);
		}
	}

	dispose() {
		this.disposed = true;
		this.pendingRequestIds.clear();
	}

	private assertActive() {
		if (this.disposed)
			throw new Error("Coding Agent command client is disposed.");
	}
}

export function createCodingAgentCommandRequest<
	Action extends CodingAgentCommandRequestV1["actionId"],
>(
	input: Omit<
		Extract<CodingAgentCommandRequestV1, { actionId: Action }>,
		"version" | "type" | "requestId" | "idempotencyKey"
	>,
): Extract<CodingAgentCommandRequestV1, { actionId: Action }> {
	const requestId = crypto.randomUUID();
	return codingAgentCommandRequestV1Schema.parse({
		...input,
		version: 1,
		type: "coding_agent.command.execute",
		requestId,
		idempotencyKey: requestId,
	}) as Extract<CodingAgentCommandRequestV1, { actionId: Action }>;
}

async function sendRestCommand(request: CodingAgentCommandRequestV1) {
	const response = await apiFetch(
		"/api/coding-agent/commands",
		jsonRequest("POST", request),
	);
	const payload = await response.json();
	return codingAgentCommandResponseV1Schema.parse(payload);
}
