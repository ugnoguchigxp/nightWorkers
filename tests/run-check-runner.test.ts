import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nightWorkersRunCheckInputSchema } from "../api/mcp/nightworkers-tool-schemas";
import { workerToolDefinitions } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-manifest";
import {
	addStructuredReporter,
	resolveRunCheckRunner,
} from "../api/services/worker-tools/run-check";
import {
	evaluateStructuredTestCapture,
	resolveManagedTestRunner,
	selectStructuredTestArtifactFormat,
} from "../api/services/worker-tools/run-check-structured-capture";
import { isWorkerToolRecovery } from "../api/services/worker-tools/types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

describe("run_check runner resolution", () => {
	it("rejects incomplete recovery instructions at the tool boundary", () => {
		expect(isWorkerToolRecovery({ disposition: "retry_with_input" })).toBe(
			false,
		);
		expect(
			isWorkerToolRecovery({
				disposition: "agent_action",
				candidates: [{ toolName: "", actionCode: "REPAIR" }],
			}),
		).toBe(false);
		expect(
			isWorkerToolRecovery({
				disposition: "retry_with_input",
				candidates: [
					{
						toolName: "run_check",
						actionCode: "USE_PROJECT_TEST_SCRIPT",
						argsPatch: { command: "test" },
					},
				],
			}),
		).toBe(true);
	});

	it("infers Vitest from a symbolic package script command", async () => {
		const repoRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "run-check-runner-"),
		);
		temporaryDirectories.push(repoRoot);
		await fs.writeFile(
			path.join(repoRoot, "package.json"),
			JSON.stringify({ scripts: { test: "vitest run --reporter=json" } }),
		);

		await expect(
			resolveRunCheckRunner(
				{ command: "test", checkKind: "test", repoRoot },
				"bun run test",
			),
		).resolves.toBe("vitest");
	});

	it("keeps an explicit runner hint authoritative", async () => {
		await expect(
			resolveRunCheckRunner(
				{
					command: "test",
					checkKind: "test",
					repoRoot: process.cwd(),
					runnerHint: "jest",
				},
				"bun run test",
			),
		).resolves.toBe("jest");
	});

	it("adds one JSON reporter to known Vitest package and raw commands", () => {
		expect(addStructuredReporter("bun run test", "vitest")).toBe(
			"bun run test --reporter=json",
		);
		expect(
			addStructuredReporter(
				"bun vitest run api/modules/todos web/src/modules/todos",
				"vitest",
			),
		).toBe(
			"bun vitest run api/modules/todos web/src/modules/todos --reporter=json",
		);
		expect(addStructuredReporter("vitest run --reporter=json", "vitest")).toBe(
			"vitest run --reporter=json",
		);
		expect(addStructuredReporter("npm run test -- --run", "vitest")).toBe(
			"npm run test -- --run --reporter=json",
		);
		expect(() =>
			addStructuredReporter("custom-wrapper test", "vitest"),
		).toThrowError(
			expect.objectContaining({ code: "TEST_EVIDENCE_COMMAND_UNSUPPORTED" }),
		);
		expect(() =>
			addStructuredReporter("vitest run --reporter=verbose", "vitest"),
		).toThrowError(
			expect.objectContaining({ code: "TEST_EVIDENCE_COMMAND_UNSUPPORTED" }),
		);
		expect(() =>
			addStructuredReporter(
				"vitest run --reporter=json --reporter=verbose",
				"vitest",
			),
		).toThrowError(
			expect.objectContaining({ code: "TEST_EVIDENCE_COMMAND_UNSUPPORTED" }),
		);
		expect(() =>
			addStructuredReporter(
				"vitest run --reporter=junit --outputFile=report.xml",
				"vitest",
			),
		).toThrowError(
			expect.objectContaining({ code: "TEST_EVIDENCE_COMMAND_UNSUPPORTED" }),
		);
		expect(() =>
			addStructuredReporter(
				"vitest run --outputFile.json=report.json",
				"vitest",
			),
		).toThrowError(
			expect.objectContaining({ code: "TEST_EVIDENCE_COMMAND_UNSUPPORTED" }),
		);
	});

	it("fails a duplicate mapped execution closed if any result did not pass", () => {
		expect(
			evaluateStructuredTestCapture({
				managedTest: true,
				commandExitCode: 0,
				recognized: true,
				mappedCaseKeys: ["T1"],
				resolvedCases: [
					{ caseKey: "T1", status: "failed" },
					{ caseKey: "T1", status: "passed" },
				],
				ambiguousMappedCaseKeys: [],
				mismatchedMappedCaseKeys: [],
			}),
		).toMatchObject({ reason: "MAPPED_TEST_FAILED" });
	});

	it("keeps JUnit as a legacy format and resolves the actual evidence runner", () => {
		expect(resolveManagedTestRunner("vitest", "junit")).toBe("vitest");
		expect(() => resolveManagedTestRunner("unknown", "junit")).toThrowError(
			expect.objectContaining({ code: "TEST_EVIDENCE_COMMAND_UNSUPPORTED" }),
		);
	});

	it("uses only the reporter format selected for a managed Vitest command", () => {
		expect(
			selectStructuredTestArtifactFormat({
				command: "vitest run --reporter=json",
				runner: "vitest",
				junitRecognized: true,
				vitestRecognized: true,
			}),
		).toBe("vitest-json");
		expect(
			selectStructuredTestArtifactFormat({
				command: "vitest run --reporter=json",
				runner: "vitest",
				junitRecognized: true,
				vitestRecognized: false,
			}),
		).toBeNull();
		expect(
			selectStructuredTestArtifactFormat({
				command: "vitest run --reporter=junit",
				runner: "vitest",
				junitRecognized: true,
				vitestRecognized: true,
			}),
		).toBe("junit");
	});

	it("keeps model-facing run_check input limited to command selection", () => {
		const parsed = nightWorkersRunCheckInputSchema.safeParse({
			command: "bun run test",
			checkKind: "test",
			runnerHint: "vitest",
		});
		expect(parsed.success).toBe(false);

		const runCheck = workerToolDefinitions.find(
			(tool) => tool.name === "run_check",
		)?.definition.inputSchema as {
			properties?: Record<string, unknown>;
		};
		expect(Object.keys(runCheck.properties ?? {}).sort()).toEqual([
			"checkKind",
			"command",
			"cwd",
			"displayMode",
			"timeoutSeconds",
		]);
		for (const removed of [
			"runId",
			"verificationDocumentId",
			"conditionIds",
			"evidenceKinds",
			"runnerHint",
		]) {
			expect(runCheck.properties).not.toHaveProperty(removed);
		}
	});
});
