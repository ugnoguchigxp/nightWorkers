import { describe, expect, it } from "vitest";
import { serializePersistenceOwnerResult } from "../api/services/execution/persistence-owner-ipc-protocol";

describe("Persistence Owner IPC protocol", () => {
	it("preserves binary and temporal values supported by advanced IPC", () => {
		const bytes = new Uint8Array([0, 127, 255]);
		const arrayBuffer = bytes.buffer.slice(0);
		const createdAt = new Date("2026-07-17T00:00:00.000Z");

		expect(serializePersistenceOwnerResult(bytes)).toBe(bytes);
		expect(serializePersistenceOwnerResult(arrayBuffer)).toBe(arrayBuffer);
		expect(serializePersistenceOwnerResult(createdAt)).toBe(createdAt);
	});

	it("normalizes result objects recursively without corrupting nested blobs", () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const result = serializePersistenceOwnerResult({
			rows: [{ payload: bytes }],
			metadata: {
				toJSON: () => ({ affectedRowCount: 1n }),
			},
		});

		expect(result).toEqual({
			rows: [{ payload: bytes }],
			metadata: { affectedRowCount: 1n },
		});
	});
});
