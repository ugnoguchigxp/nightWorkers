import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createPersistenceOwnerIpcClient } from "../api/services/execution/persistence-owner-ipc-client";
import {
	PERSISTENCE_OWNER_PROTOCOL_VERSION,
	PERSISTENCE_OWNER_RESPONSE_TYPE,
	type PersistenceOwnerRequest,
} from "../api/services/execution/persistence-owner-ipc-protocol";

class FakeProcessTransport extends EventEmitter {
	connected = true;
	requests: PersistenceOwnerRequest[] = [];

	send(
		message: PersistenceOwnerRequest,
		callback?: (error: Error | null) => void,
	) {
		this.requests.push(message);
		callback?.(null);
		queueMicrotask(() => {
			if (message.operation === "transaction.open") {
				this.emit("message", {
					type: PERSISTENCE_OWNER_RESPONSE_TYPE,
					version: PERSISTENCE_OWNER_PROTOCOL_VERSION,
					requestId: message.requestId,
					ok: true,
					result: { transactionId: "tx-1" },
				});
				return;
			}
			if (message.operation === "client.execute_multiple") {
				this.emit("message", {
					type: PERSISTENCE_OWNER_RESPONSE_TYPE,
					version: PERSISTENCE_OWNER_PROTOCOL_VERSION,
					requestId: message.requestId,
					ok: false,
					error: {
						name: "SqliteError",
						message: "SQLITE_BUSY: database is locked",
						code: "SQLITE_BUSY",
					},
				});
				return;
			}
			this.emit("message", {
				type: PERSISTENCE_OWNER_RESPONSE_TYPE,
				version: PERSISTENCE_OWNER_PROTOCOL_VERSION,
				requestId: message.requestId,
				ok: true,
				result: { rows: [[1]], rowsAffected: 0, columns: ["value"] },
			});
		});
		return true;
	}
}

describe("Persistence Owner IPC client", () => {
	it("routes client and transaction operations through the owner channel", async () => {
		const transport = new FakeProcessTransport();
		const client = createPersistenceOwnerIpcClient(transport as never);

		await expect(client.execute("select 1")).resolves.toMatchObject({
			rows: [[1]],
		});
		const transaction = await client.transaction("write");
		await transaction.execute("update tasks set status = 'running'");
		await transaction.commit();

		expect(transport.requests.map((request) => request.operation)).toEqual([
			"client.execute",
			"transaction.open",
			"transaction.execute",
			"transaction.commit",
		]);
		expect(transport.requests.at(-2)?.transactionId).toBe("tx-1");
		expect(transaction.closed).toBe(true);
		client.close();
	});

	it("preserves SQLite failure identity without retrying an uncertain request", async () => {
		const transport = new FakeProcessTransport();
		const client = createPersistenceOwnerIpcClient(transport as never);

		await expect(client.executeMultiple("select 1")).rejects.toMatchObject({
			name: "SqliteError",
			message: "SQLITE_BUSY: database is locked",
			code: "SQLITE_BUSY",
		});
		expect(transport.requests).toHaveLength(1);
		client.close();
	});
});
