import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logWriter = vi.hoisted(() => {
	const entries: Array<{ kind: string; line: string }> = [];
	return {
		entries,
		reset() {
			entries.length = 0;
		},
	};
});

vi.mock("../api/runtime/runtime-log-writer", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../api/runtime/runtime-log-writer")>();
	return {
		...original,
		RuntimeLogWriter: class {
			append(kind: string, line: string) {
				logWriter.entries.push({ kind, line });
				return Promise.resolve();
			}

			flush() {
				return Promise.resolve();
			}

			sweep() {
				return Promise.resolve({ deletedFiles: 0, deletedBytes: 0 });
			}
		},
	};
});

import {
	appendLlmTrace,
	appendSupervisorTrace,
	createLlmLogger,
	logEvent,
	logHttpEvent,
} from "../api/lib/logger";
import {
	redactRuntimeSecretText,
	replaceRuntimeSecretValues,
} from "../api/services/security/secret-redaction";

const TEST_SECRET_SOURCE = "logger-secret-redaction-test";

describe("runtime logger secret redaction", () => {
	let consoleLog: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logWriter.reset();
		consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
	});

	afterEach(() => {
		replaceRuntimeSecretValues(TEST_SECRET_SOURCE, []);
		consoleLog.mockRestore();
	});

	it("redacts configured secret representations in every file and console sink", () => {
		const secret = "runtime-log-secret/registry+token:123";
		const encoded = encodeURIComponent(secret);
		const base64 = Buffer.from(secret).toString("base64");
		replaceRuntimeSecretValues(TEST_SECRET_SOURCE, [secret]);

		logHttpEvent({
			method: "GET",
			path: `/callback?state=${encoded}`,
			message: `request ${secret}`,
			meta: { nested: { value: base64 } },
		});
		logEvent({ message: `event ${encoded}`, meta: { raw: secret } });
		appendSupervisorTrace(`trace ${base64}`, {
			payload: { value: secret },
		});
		appendLlmTrace(`llm ${secret}`, {
			rawContent: `encoded=${encoded}`,
			providerDebug: { base64 },
		});
		appendLlmTrace(`fallback ${secret}`, {
			callId: secret,
			provider: encoded,
			label: base64,
			overflow: "x".repeat(2 * 1024 * 1024),
		});

		const output = JSON.stringify({
			console: consoleLog.mock.calls,
			files: logWriter.entries,
		});
		expect(output).not.toContain(secret);
		expect(output).not.toContain(encoded);
		expect(output).not.toContain(base64);
		expect(output).toContain("[REDACTED]");
		expect(logWriter.entries.map((entry) => entry.kind)).toEqual([
			"api",
			"api",
			"supervisor",
			"llm",
			"llm",
		]);
	});

	it("redacts Pino messages, records, and Error stacks before serialization", () => {
		const secret = "pino-runtime-secret/with+value:456";
		const encoded = encodeURIComponent(secret);
		const base64 = Buffer.from(secret).toString("base64");
		const lines: string[] = [];
		replaceRuntimeSecretValues(TEST_SECRET_SOURCE, [secret]);
		const logger = createLlmLogger({
			write(chunk: string) {
				lines.push(chunk);
				return true;
			},
		} as never);

		logger.info({ detail: secret, nested: { encoded } }, `message ${base64}`);
		logger.error(
			new Error(`failed ${secret}`, {
				cause: { nested: base64 },
			}),
			`error ${encoded}`,
		);

		const output = lines.join("\n");
		expect(output).not.toContain(secret);
		expect(output).not.toContain(encoded);
		expect(output).not.toContain(base64);
		expect(output).toContain("[REDACTED]");
		expect(output).toContain('"cause"');
	});

	it("replaces a setting source without retaining the old secret value", () => {
		const oldSecret = "old-runtime-secret-value";
		const nextSecret = "next-runtime-secret-value";
		replaceRuntimeSecretValues(TEST_SECRET_SOURCE, [oldSecret]);
		expect(redactRuntimeSecretText(oldSecret)).toBe("[REDACTED]");

		replaceRuntimeSecretValues(TEST_SECRET_SOURCE, [nextSecret]);
		expect(redactRuntimeSecretText(oldSecret)).toBe(oldSecret);
		expect(redactRuntimeSecretText(nextSecret)).toBe("[REDACTED]");
	});
});
