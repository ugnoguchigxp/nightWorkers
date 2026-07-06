import type { Client, Transaction } from "@libsql/client";
import { withSqliteBusyRetry } from "./retry";
import {
	batchContainsWrite,
	createWriteSerialGate,
	isWriteStatement,
	type StatementLike,
} from "./sqlite-write-gate";

function wrapTransactionWithBusyRetry(
	transaction: Transaction,
	releaseWriteLock: () => void,
): Transaction {
	return new Proxy(transaction, {
		get(target, prop, receiver) {
			if (
				prop === "execute" ||
				prop === "batch" ||
				prop === "executeMultiple"
			) {
				return (...args: unknown[]) =>
					withSqliteBusyRetry(() =>
						Reflect.apply(
							target[prop as "execute" | "batch" | "executeMultiple"],
							target,
							args,
						),
					);
			}
			if (prop === "commit" || prop === "rollback") {
				return async () => {
					try {
						return await withSqliteBusyRetry(() =>
							Reflect.apply(target[prop as "commit" | "rollback"], target, []),
						);
					} finally {
						releaseWriteLock();
					}
				};
			}
			if (prop === "close") {
				return () => {
					try {
						return Reflect.apply(target.close, target, []);
					} finally {
						releaseWriteLock();
					}
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

export function wrapClientWithBusyRetry(baseClient: Client): Client {
	const writeGate = createWriteSerialGate();

	return new Proxy(baseClient, {
		get(target, prop, receiver) {
			if (
				prop === "execute" ||
				prop === "batch" ||
				prop === "migrate" ||
				prop === "executeMultiple"
			) {
				return (...args: unknown[]) => {
					const operation = () =>
						withSqliteBusyRetry(() =>
							Reflect.apply(
								target[
									prop as "execute" | "batch" | "migrate" | "executeMultiple"
								],
								target,
								args,
							),
						);
					const shouldSerialize =
						prop === "execute"
							? isWriteStatement(args[0] as StatementLike)
							: prop === "batch" || prop === "migrate"
								? batchContainsWrite((args[0] as unknown[]) ?? [])
								: true;
					return shouldSerialize
						? writeGate.runExclusive(operation)
						: operation();
				};
			}
			if (prop === "transaction") {
				return async (...args: unknown[]) => {
					const releaseWriteLock = await writeGate.acquire();
					try {
						const transaction = (await withSqliteBusyRetry(() =>
							Reflect.apply(target.transaction, target, args),
						)) as Transaction;
						return wrapTransactionWithBusyRetry(transaction, releaseWriteLock);
					} catch (error) {
						releaseWriteLock();
						throw error;
					}
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

export const wrapClientWithSqliteRetryAndWriteGate = wrapClientWithBusyRetry;
