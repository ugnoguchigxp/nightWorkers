import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import type { Transaction } from "@libsql/client";
import { client } from "../../db/client";
import { logEvent } from "../../lib/logger";
import {
	decodePersistenceOwnerValue,
	encodePersistenceOwnerValue,
	isPersistenceOwnerRequest,
	PERSISTENCE_OWNER_PROTOCOL_VERSION,
	PERSISTENCE_OWNER_RESPONSE_TYPE,
	type PersistenceOwnerRemoteError,
	type PersistenceOwnerRequest,
	type PersistenceOwnerResponse,
} from "./persistence-owner-ipc-protocol";

export type PersistenceOwnerIpcServerHandle = {
	close: () => Promise<void>;
};

export function attachPersistenceOwnerIpcServer(
	child: ChildProcess,
): PersistenceOwnerIpcServerHandle {
	const transactions = new Map<string, Transaction>();
	let cleanupPromise: Promise<void> | null = null;

	const onMessage = (message: unknown) => {
		if (!isPersistenceOwnerRequest(message)) return;
		void executeRequest(message, transactions)
			.then((result) =>
				sendResponse(child, {
					type: PERSISTENCE_OWNER_RESPONSE_TYPE,
					version: PERSISTENCE_OWNER_PROTOCOL_VERSION,
					requestId: message.requestId,
					ok: true,
					result: encodePersistenceOwnerValue(result),
				}),
			)
			.catch((error) =>
				sendResponse(child, {
					type: PERSISTENCE_OWNER_RESPONSE_TYPE,
					version: PERSISTENCE_OWNER_PROTOCOL_VERSION,
					requestId: message.requestId,
					ok: false,
					error: serializeError(error),
				}),
			);
	};

	const cleanup = () => {
		if (cleanupPromise) return cleanupPromise;
		child.off("message", onMessage);
		child.off("exit", onExit);
		child.off("disconnect", onDisconnect);
		cleanupPromise = closeTransactions(transactions);
		return cleanupPromise;
	};
	const onExit = () => void cleanup();
	const onDisconnect = () => void cleanup();
	child.on("message", onMessage);
	child.once("exit", onExit);
	child.once("disconnect", onDisconnect);
	return { close: cleanup };
}

async function executeRequest(
	request: PersistenceOwnerRequest,
	transactions: Map<string, Transaction>,
) {
	const args = decodePersistenceOwnerValue(request.arguments) as unknown[];
	switch (request.operation) {
		case "client.execute":
			return Reflect.apply(client.execute, client, args);
		case "client.batch":
			return Reflect.apply(client.batch, client, args);
		case "client.execute_multiple":
			return Reflect.apply(client.executeMultiple, client, args);
		case "client.migrate":
			return Reflect.apply(client.migrate, client, args);
		case "transaction.open": {
			const transaction = await Reflect.apply(client.transaction, client, args);
			const transactionId = crypto.randomUUID();
			transactions.set(transactionId, transaction);
			return { transactionId };
		}
		case "transaction.execute":
			return applyTransaction(request, transactions, "execute");
		case "transaction.batch":
			return applyTransaction(request, transactions, "batch");
		case "transaction.execute_multiple":
			return applyTransaction(request, transactions, "executeMultiple");
		case "transaction.commit":
			return finishTransaction(request, transactions, "commit");
		case "transaction.rollback":
			return finishTransaction(request, transactions, "rollback");
		case "transaction.close":
			return finishTransaction(request, transactions, "close");
	}
}

function applyTransaction(
	request: PersistenceOwnerRequest,
	transactions: Map<string, Transaction>,
	method: "execute" | "batch" | "executeMultiple",
) {
	const transaction = requireTransaction(request, transactions);
	const args = decodePersistenceOwnerValue(request.arguments) as unknown[];
	return Reflect.apply(transaction[method], transaction, args);
}

async function finishTransaction(
	request: PersistenceOwnerRequest,
	transactions: Map<string, Transaction>,
	method: "commit" | "rollback" | "close",
) {
	const transaction = requireTransaction(request, transactions);
	try {
		return await Reflect.apply(transaction[method], transaction, []);
	} catch (error) {
		await closeFailedTransaction(transaction, method);
		throw error;
	} finally {
		transactions.delete(request.transactionId as string);
	}
}

async function closeFailedTransaction(
	transaction: Transaction,
	method: "commit" | "rollback" | "close",
) {
	if (method === "commit" && !transaction.closed) {
		await transaction.rollback().catch(() => undefined);
	}
	if (!transaction.closed) {
		try {
			await transaction.close();
		} catch {
			// Preserve the original transaction failure.
		}
	}
}

function requireTransaction(
	request: PersistenceOwnerRequest,
	transactions: Map<string, Transaction>,
) {
	if (!request.transactionId)
		throw new Error("Persistence transaction id is required");
	const transaction = transactions.get(request.transactionId);
	if (!transaction)
		throw new Error(
			`Persistence transaction is not active: ${request.transactionId}`,
		);
	return transaction;
}

async function closeTransactions(transactions: Map<string, Transaction>) {
	const active = [...transactions.values()];
	transactions.clear();
	await Promise.allSettled(
		active.map(async (transaction) => {
			try {
				await transaction.rollback();
			} finally {
				if (!transaction.closed) await transaction.close();
			}
		}),
	);
}

function sendResponse(child: ChildProcess, response: PersistenceOwnerResponse) {
	if (!child.connected) return;
	child.send?.(response, (error) => {
		if (!error) return;
		logEvent({
			channel: "worker",
			level: "warn",
			message: "persistence owner IPC response failed",
			meta: { errorMessage: error.message },
		});
	});
}

function serializeError(
	error: unknown,
	depth = 0,
): PersistenceOwnerRemoteError {
	if (!(error instanceof Error))
		return { name: "Error", message: String(error) };
	const code = (error as Error & { code?: unknown }).code;
	return {
		name: error.name,
		message: error.message,
		...(typeof code === "string" ? { code } : {}),
		...(error.stack ? { stack: error.stack } : {}),
		...(depth < 4 && error.cause
			? { cause: serializeError(error.cause, depth + 1) }
			: {}),
	};
}
