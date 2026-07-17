import crypto from "node:crypto";
import type { Client, Transaction } from "@libsql/client";
import {
	isPersistenceOwnerResponse,
	PERSISTENCE_OWNER_PROTOCOL_VERSION,
	PERSISTENCE_OWNER_REQUEST_TYPE,
	type PersistenceOwnerOperation,
	type PersistenceOwnerRemoteError,
	type PersistenceOwnerRequest,
} from "./persistence-owner-ipc-protocol";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_IN_FLIGHT_REQUESTS = 256;

type ProcessTransport = Pick<
	NodeJS.Process,
	"connected" | "send" | "on" | "off"
>;

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
};

export function createPersistenceOwnerIpcClient(
	transport: ProcessTransport = process,
): Client {
	const pending = new Map<string, PendingRequest>();
	let closed = false;

	const onMessage = (message: unknown) => {
		if (!isPersistenceOwnerResponse(message)) return;
		const request = pending.get(message.requestId);
		if (!request) return;
		pending.delete(message.requestId);
		clearTimeout(request.timer);
		if (message.ok) request.resolve(message.result);
		else request.reject(remoteError(message.error));
	};
	transport.on("message", onMessage);

	const request = (
		operation: PersistenceOwnerOperation,
		args: unknown[],
		transactionId?: string,
	) => {
		if (closed)
			return Promise.reject(new Error("Persistence IPC client is closed"));
		if (!transport.connected || typeof transport.send !== "function")
			return Promise.reject(
				new Error("Persistence Owner IPC channel is not connected"),
			);
		if (pending.size >= MAX_IN_FLIGHT_REQUESTS)
			return Promise.reject(
				new Error("Persistence Owner IPC backpressure limit exceeded"),
			);
		const requestId = crypto.randomUUID();
		const message: PersistenceOwnerRequest = {
			type: PERSISTENCE_OWNER_REQUEST_TYPE,
			version: PERSISTENCE_OWNER_PROTOCOL_VERSION,
			requestId,
			operation,
			transactionId,
			arguments: args,
		};
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(requestId);
				reject(new Error(`Persistence Owner request timed out: ${operation}`));
			}, DEFAULT_REQUEST_TIMEOUT_MS);
			timer.unref?.();
			pending.set(requestId, { resolve, reject, timer });
			transport.send?.(message, (error) => {
				if (!error) return;
				const active = pending.get(requestId);
				if (!active) return;
				pending.delete(requestId);
				clearTimeout(active.timer);
				reject(error);
			});
		});
	};

	const close = () => {
		if (closed) return;
		closed = true;
		transport.off("message", onMessage);
		for (const entry of pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(new Error("Persistence Owner IPC client closed"));
		}
		pending.clear();
	};

	return {
		execute: (...args: unknown[]) => request("client.execute", args),
		batch: (...args: unknown[]) => request("client.batch", args),
		executeMultiple: (...args: unknown[]) =>
			request("client.execute_multiple", args),
		migrate: (...args: unknown[]) => request("client.migrate", args),
		transaction: async (...args: unknown[]) => {
			const opened = (await request("transaction.open", args)) as {
				transactionId: string;
			};
			return createRemoteTransaction(opened.transactionId, request);
		},
		sync: async () => undefined,
		reconnect: async () => undefined,
		close,
		get closed() {
			return closed;
		},
		protocol: "file",
	} as unknown as Client;
}

function createRemoteTransaction(
	transactionId: string,
	request: (
		operation: PersistenceOwnerOperation,
		args: unknown[],
		transactionId?: string,
	) => Promise<unknown>,
): Transaction {
	let closed = false;
	const finish = async (
		operation:
			| "transaction.commit"
			| "transaction.rollback"
			| "transaction.close",
	) => {
		if (closed) return;
		closed = true;
		await request(operation, [], transactionId);
	};
	return {
		execute: (...args: unknown[]) =>
			request("transaction.execute", args, transactionId),
		batch: (...args: unknown[]) =>
			request("transaction.batch", args, transactionId),
		executeMultiple: (...args: unknown[]) =>
			request("transaction.execute_multiple", args, transactionId),
		commit: () => finish("transaction.commit"),
		rollback: () => finish("transaction.rollback"),
		close: () => finish("transaction.close"),
		get closed() {
			return closed;
		},
	} as unknown as Transaction;
}

function remoteError(value: PersistenceOwnerRemoteError | undefined): Error {
	const error: Error = new Error(
		value?.message ?? "Persistence Owner request failed",
		{
			cause: value?.cause ? remoteError(value.cause) : undefined,
		},
	);
	error.name = value?.name ?? "PersistenceOwnerRemoteError";
	if (value?.stack) error.stack = value.stack;
	if (value?.code) (error as Error & { code?: string }).code = value.code;
	return error;
}
