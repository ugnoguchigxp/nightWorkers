import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { client } from "../api/db/client";

describe("runtime retention schema", () => {
	beforeAll(async () => {
		await ensureNightWorkersSchema();
	});

	it("creates the bounded retention audit table", async () => {
		const result = await client.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_retention_audit_events'",
		);
		expect(result.rows).toHaveLength(1);
	});
});
