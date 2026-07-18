import { describe, expect, it } from "vitest";
import {
	decodePersistenceOwnerValue,
	encodePersistenceOwnerValue,
} from "../api/services/execution/persistence-owner-ipc-protocol";

describe("Persistence Owner IPC protocol", () => {
	it("round-trips non-JSON SQLite values over the default IPC serializer", () => {
		const bytes = new Uint8Array([0, 127, 255]);
		const arrayBuffer = bytes.buffer.slice(0);
		const createdAt = new Date("2026-07-17T00:00:00.000Z");
		const encoded = encodePersistenceOwnerValue({
			bytes,
			arrayBuffer,
			createdAt,
			largeInteger: 9_007_199_254_740_993n,
		});
		const decoded = decodePersistenceOwnerValue(
			JSON.parse(JSON.stringify(encoded)),
		) as Record<string, unknown>;

		expect(decoded.bytes).toEqual(bytes);
		expect(new Uint8Array(decoded.arrayBuffer as ArrayBuffer)).toEqual(bytes);
		expect(decoded.createdAt).toEqual(createdAt);
		expect(decoded.largeInteger).toBe(9_007_199_254_740_993n);
	});

	it("normalizes result objects recursively without corrupting nested blobs", () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const resultSet = {
			columns: ["payload"],
			rows: [{ payload: bytes }],
			metadata: { affectedRowCount: 1n },
		};
		Object.defineProperty(resultSet, "toJSON", {
			value: () => ({ rows: [["base64-corrupted"]] }),
		});
		const result = decodePersistenceOwnerValue(
			JSON.parse(JSON.stringify(encodePersistenceOwnerValue(resultSet))),
		);

		expect(result).toEqual({
			columns: ["payload"],
			rows: [[bytes]],
			metadata: { affectedRowCount: 1n },
		});
	});
});
