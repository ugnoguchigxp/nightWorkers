import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import {
	createRepository,
	createTask,
	createTaskMessage,
} from "../api/modules/nightworkers/nightworkers.repository";
import {
	createTaskRun,
	getTaskRun,
	updateTaskRun,
} from "../api/modules/nightworkers/nightworkers.runs.repository";
import { clearSessionSecretStoreForTests } from "../api/services/security/os-secret-store";
import { applySecretPersistenceFirewall } from "../api/services/security/secret-persistence-firewall";
import { writeApplicationSettingSecrets } from "../api/services/settings/application-settings-store";

const secret = "provider-secret-value-123";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

beforeEach(async () => {
	clearSessionSecretStoreForTests();
	await writeApplicationSettingSecrets("llm", { apiKey: secret });
});

describe("secret persistence firewall", () => {
	it("redacts structural keys, exact values, URL encoding, and base64", () => {
		const result = applySecretPersistenceFirewall({
			apiKey: secret,
			inputTokens: 120,
			totalTokens: 180,
			message: [
				secret,
				encodeURIComponent(secret),
				Buffer.from(secret).toString("base64"),
			].join(" "),
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.redactionCount).toBeGreaterThan(0);
		expect(JSON.stringify(result.value)).not.toContain(secret);
		expect(result.value).toEqual({
			apiKey: "[REDACTED]",
			inputTokens: 120,
			totalTokens: 180,
			message: "[REDACTED] [REDACTED] [REDACTED]",
		});
	});

	it("sanitizes messages and Run summaries at repository boundaries", async () => {
		const project = await createRepository({
			name: `TEST: persistence firewall ${crypto.randomUUID()}`,
			localPath: `/tmp/nw-firewall-${crypto.randomUUID()}`,
			branch: "main",
		});
		const task = await createTask({
			repositoryId: project.id,
			title: "TEST: persistence firewall",
		});
		const run = await createTaskRun({
			taskId: task.id,
			repositoryId: project.id,
		});
		const message = await createTaskMessage({
			taskId: task.id,
			runId: run.id,
			role: "tool",
			content: `PROJECT_TOKEN=${secret}`,
			payloadJson: { authorization: `Bearer ${secret}` },
		});
		await updateTaskRun(run.id, {
			summary: `provider returned ${secret}`,
			finalReport: `token=${secret}`,
		});
		const updated = await getTaskRun(run.id);

		expect(message.content).not.toContain(secret);
		expect(JSON.stringify(message.metadataJson)).not.toContain(secret);
		expect(updated?.summary).not.toContain(secret);
		expect(updated?.finalReport).not.toContain(secret);
	});

	it("does not leave the registered secret in SQLite or its WAL files", async () => {
		const project = await createRepository({
			name: `TEST: persistence disk scan ${crypto.randomUUID()}`,
			localPath: `/tmp/nw-firewall-${crypto.randomUUID()}`,
			branch: "main",
		});
		const task = await createTask({
			repositoryId: project.id,
			title: "TEST: persistence disk scan",
		});
		await createTaskMessage({
			taskId: task.id,
			role: "tool",
			content: `Authorization: Bearer ${secret}`,
			payloadJson: { nested: { token: secret } },
		});

		const databaseUrl = process.env.DATABASE_URL;
		expect(databaseUrl?.startsWith("file:")).toBe(true);
		const databasePath = path.resolve(databaseUrl?.slice("file:".length) ?? "");
		for (const candidate of [
			databasePath,
			`${databasePath}-wal`,
			`${databasePath}-shm`,
		]) {
			const bytes = await fs.readFile(candidate).catch(() => null);
			if (bytes) expect(bytes.includes(Buffer.from(secret))).toBe(false);
		}
	});
});

import fs from "node:fs/promises";
import path from "node:path";
