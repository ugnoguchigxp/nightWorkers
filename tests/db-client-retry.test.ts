import { describe, expect, it, vi } from "vitest";
import { wrapClientWithBusyRetry } from "../api/db/client";

describe("wrapClientWithBusyRetry", () => {
	it("retries client execute on SQLITE_BUSY", async () => {
		const execute = vi
			.fn()
			.mockRejectedValueOnce(new Error("SQLITE_BUSY: database is locked"))
			.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
		const client = wrapClientWithBusyRetry({
			execute,
			batch: vi.fn(),
			migrate: vi.fn(),
			executeMultiple: vi.fn(),
			transaction: vi.fn(),
			sync: vi.fn(),
			close: vi.fn(),
			reconnect: vi.fn(),
			closed: false,
			protocol: "file",
		} as never);

		const result = await client.execute("select 1");

		expect(execute).toHaveBeenCalledTimes(2);
		expect(result).toEqual({ rows: [{ ok: 1 }] });
	});

	it("retries client execute on SQLITE_PROTOCOL locking errors", async () => {
		const execute = vi
			.fn()
			.mockRejectedValueOnce(new Error("locking protocol"))
			.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
		const client = wrapClientWithBusyRetry({
			execute,
			batch: vi.fn(),
			migrate: vi.fn(),
			executeMultiple: vi.fn(),
			transaction: vi.fn(),
			sync: vi.fn(),
			close: vi.fn(),
			reconnect: vi.fn(),
			closed: false,
			protocol: "file",
		} as never);

		await expect(client.execute("update items set done = 1")).resolves.toEqual({
			rows: [{ ok: 1 }],
		});
		expect(execute).toHaveBeenCalledTimes(2);
	});

	it("retries transaction execute and commit on SQLITE_BUSY", async () => {
		const txExecute = vi
			.fn()
			.mockRejectedValueOnce(new Error("database is locked"))
			.mockResolvedValueOnce({ rows: [] });
		const commit = vi
			.fn()
			.mockRejectedValueOnce(
				new Error("cannot commit transaction - SQL statements in progress"),
			)
			.mockResolvedValueOnce(undefined);
		const transaction = {
			execute: txExecute,
			batch: vi.fn(),
			executeMultiple: vi.fn(),
			rollback: vi.fn(),
			commit,
			close: vi.fn(),
			closed: false,
		};
		const client = wrapClientWithBusyRetry({
			execute: vi.fn(),
			batch: vi.fn(),
			migrate: vi.fn(),
			executeMultiple: vi.fn(),
			transaction: vi.fn().mockResolvedValue(transaction),
			sync: vi.fn(),
			close: vi.fn(),
			reconnect: vi.fn(),
			closed: false,
			protocol: "file",
		} as never);

		const wrappedTx = await client.transaction("write");
		await wrappedTx.execute("insert into test values (1)");
		await wrappedTx.commit();

		expect(txExecute).toHaveBeenCalledTimes(2);
		expect(commit).toHaveBeenCalledTimes(2);
	});

	it("serializes write executes while leaving read executes unconstrained", async () => {
		const started: string[] = [];
		const finished: string[] = [];
		let releaseFirstWrite!: () => void;
		const firstWritePending = new Promise<void>((resolve) => {
			releaseFirstWrite = resolve;
		});
		const execute = vi.fn(async (sql: string) => {
			started.push(sql);
			if (sql === "insert into items values (1)") {
				await firstWritePending;
			}
			finished.push(sql);
			return { rows: [] };
		});
		const client = wrapClientWithBusyRetry({
			execute,
			batch: vi.fn(),
			migrate: vi.fn(),
			executeMultiple: vi.fn(),
			transaction: vi.fn(),
			sync: vi.fn(),
			close: vi.fn(),
			reconnect: vi.fn(),
			closed: false,
			protocol: "file",
		} as never);

		const firstWrite = client.execute("insert into items values (1)");
		const read = client.execute("select * from items");
		const secondWrite = client.execute(
			"update items set done = 1 where id = 1",
		);

		await Promise.resolve();
		await read;

		expect(started).toContain("insert into items values (1)");
		expect(started).toContain("select * from items");
		expect(started).not.toContain("update items set done = 1 where id = 1");
		expect(finished).toEqual(["select * from items"]);

		releaseFirstWrite();
		await Promise.all([firstWrite, secondWrite]);

		expect(started).toContain("update items set done = 1 where id = 1");
		expect(finished).toEqual([
			"select * from items",
			"insert into items values (1)",
			"update items set done = 1 where id = 1",
		]);
	});

	it("holds the write gate for an open transaction until commit", async () => {
		const started: string[] = [];
		const finished: string[] = [];
		const transaction = {
			execute: vi.fn(),
			batch: vi.fn(),
			executeMultiple: vi.fn(),
			rollback: vi.fn(),
			commit: vi.fn(async () => {
				finished.push("commit");
			}),
			close: vi.fn(),
			closed: false,
		};
		const execute = vi.fn(async (sql: string) => {
			started.push(sql);
			finished.push(sql);
			return { rows: [] };
		});
		const client = wrapClientWithBusyRetry({
			execute,
			batch: vi.fn(),
			migrate: vi.fn(),
			executeMultiple: vi.fn(),
			transaction: vi.fn(async () => {
				started.push("transaction");
				return transaction;
			}),
			sync: vi.fn(),
			close: vi.fn(),
			reconnect: vi.fn(),
			closed: false,
			protocol: "file",
		} as never);

		const wrappedTx = await client.transaction("write");
		const laterWrite = client.execute("insert into items values (2)");

		await Promise.resolve();

		expect(started).toEqual(["transaction"]);
		expect(finished).toEqual([]);

		await wrappedTx.commit();
		await laterWrite;

		expect(started).toEqual(["transaction", "insert into items values (2)"]);
		expect(finished).toEqual(["commit", "insert into items values (2)"]);
	});

	it("releases the write gate when a transaction rolls back", async () => {
		const started: string[] = [];
		const transaction = {
			execute: vi.fn(),
			batch: vi.fn(),
			executeMultiple: vi.fn(),
			rollback: vi.fn(async () => {
				started.push("rollback");
			}),
			commit: vi.fn(),
			close: vi.fn(),
			closed: false,
		};
		const execute = vi.fn(async (sql: string) => {
			started.push(sql);
			return { rows: [] };
		});
		const client = wrapClientWithBusyRetry({
			execute,
			batch: vi.fn(),
			migrate: vi.fn(),
			executeMultiple: vi.fn(),
			transaction: vi.fn(async () => transaction),
			sync: vi.fn(),
			close: vi.fn(),
			reconnect: vi.fn(),
			closed: false,
			protocol: "file",
		} as never);

		const wrappedTx = await client.transaction("write");
		const laterWrite = client.execute("insert into items values (3)");

		await Promise.resolve();

		expect(started).toEqual([]);

		await wrappedTx.rollback();
		await laterWrite;

		expect(started).toEqual(["rollback", "insert into items values (3)"]);
	});

	it("releases the write gate when a transaction closes", async () => {
		const started: string[] = [];
		const transaction = {
			execute: vi.fn(),
			batch: vi.fn(),
			executeMultiple: vi.fn(),
			rollback: vi.fn(),
			commit: vi.fn(),
			close: vi.fn(() => {
				started.push("close");
			}),
			closed: false,
		};
		const execute = vi.fn(async (sql: string) => {
			started.push(sql);
			return { rows: [] };
		});
		const client = wrapClientWithBusyRetry({
			execute,
			batch: vi.fn(),
			migrate: vi.fn(),
			executeMultiple: vi.fn(),
			transaction: vi.fn(async () => transaction),
			sync: vi.fn(),
			close: vi.fn(),
			reconnect: vi.fn(),
			closed: false,
			protocol: "file",
		} as never);

		const wrappedTx = await client.transaction("write");
		const laterWrite = client.execute("insert into items values (4)");

		await Promise.resolve();

		expect(started).toEqual([]);

		wrappedTx.close();
		await laterWrite;

		expect(started).toEqual(["close", "insert into items values (4)"]);
	});

	it("serializes write pragmas but not read-only pragmas", async () => {
		const started: string[] = [];
		const finished: string[] = [];
		let releaseWrite!: () => void;
		const writePending = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		const execute = vi.fn(async (sql: string) => {
			started.push(sql);
			if (sql === "insert into items values (5)") {
				await writePending;
			}
			finished.push(sql);
			return { rows: [] };
		});
		const client = wrapClientWithBusyRetry({
			execute,
			batch: vi.fn(),
			migrate: vi.fn(),
			executeMultiple: vi.fn(),
			transaction: vi.fn(),
			sync: vi.fn(),
			close: vi.fn(),
			reconnect: vi.fn(),
			closed: false,
			protocol: "file",
		} as never);

		const write = client.execute("insert into items values (5)");
		const readPragma = client.execute("PRAGMA table_info(tasks)");
		const writePragma = client.execute("PRAGMA journal_mode = WAL");
		const checkpointPragma = client.execute("PRAGMA wal_checkpoint(TRUNCATE)");

		await Promise.resolve();
		await readPragma;

		expect(started).toContain("insert into items values (5)");
		expect(started).toContain("PRAGMA table_info(tasks)");
		expect(started).not.toContain("PRAGMA journal_mode = WAL");
		expect(started).not.toContain("PRAGMA wal_checkpoint(TRUNCATE)");
		expect(finished).toEqual(["PRAGMA table_info(tasks)"]);

		releaseWrite();
		await Promise.all([write, writePragma, checkpointPragma]);

		expect(started).toContain("PRAGMA journal_mode = WAL");
		expect(started).toContain("PRAGMA wal_checkpoint(TRUNCATE)");
		expect(finished).toEqual([
			"PRAGMA table_info(tasks)",
			"insert into items values (5)",
			"PRAGMA journal_mode = WAL",
			"PRAGMA wal_checkpoint(TRUNCATE)",
		]);
	});

	it("serializes unknown statements conservatively", async () => {
		const started: unknown[] = [];
		const finished: unknown[] = [];
		let releaseWrite!: () => void;
		const writePending = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		const unknownStatement = { sql: undefined };
		const execute = vi.fn(async (statement: unknown) => {
			started.push(statement);
			if (statement === "insert into items values (6)") {
				await writePending;
			}
			finished.push(statement);
			return { rows: [] };
		});
		const client = wrapClientWithBusyRetry({
			execute,
			batch: vi.fn(),
			migrate: vi.fn(),
			executeMultiple: vi.fn(),
			transaction: vi.fn(),
			sync: vi.fn(),
			close: vi.fn(),
			reconnect: vi.fn(),
			closed: false,
			protocol: "file",
		} as never);

		const write = client.execute("insert into items values (6)");
		const unknownWrite = client.execute(unknownStatement as never);

		await Promise.resolve();

		expect(started).toEqual(["insert into items values (6)"]);
		expect(finished).toEqual([]);

		releaseWrite();
		await Promise.all([write, unknownWrite]);

		expect(started).toEqual(["insert into items values (6)", unknownStatement]);
		expect(finished).toEqual([
			"insert into items values (6)",
			unknownStatement,
		]);
	});
});
