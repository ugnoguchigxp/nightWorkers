import { describe, expect, it } from "vitest";
import { DefaultToolPolicyGate } from "../api/services/tool-policy/tool-policy-gate";
import type { ToolCallRequest } from "../api/services/tool-policy/types";
import type { WorkerToolResult } from "../api/services/worker-tools/types";

const gate = new DefaultToolPolicyGate();
const repoRoot = "/tmp/nightworkers-tool-policy-coverage";

function request(
	toolName: ToolCallRequest["toolName"],
	args: unknown = {},
	overrides: Partial<ToolCallRequest> = {},
): ToolCallRequest {
	return {
		runId: "coverage-run",
		iteration: 1,
		toolName,
		args: args as Record<string, unknown>,
		repoRoot,
		readFiles: [],
		...overrides,
	};
}

function result(payload: unknown): WorkerToolResult<unknown> {
	return {
		ok: true,
		toolName: "coverage-tool",
		startedAt: "2026-08-09T00:00:00.000Z",
		finishedAt: "2026-08-09T00:00:01.000Z",
		payload,
	};
}

describe("DefaultToolPolicyGate beforeToolCall coverage", () => {
	it.each([
		[null, "null"],
		[false, "a primitive"],
		[[], "an array"],
	])("rejects %s tool arguments", async (args) => {
		await expect(
			gate.beforeToolCall(request("git_status", args)),
		).resolves.toEqual({
			allowed: false,
			code: "INVALID_TOOL_ARGS",
			message: "Tool arguments must be an object.",
		});
	});

	it("rejects tools absent from the manifest", async () => {
		const decision = await gate.beforeToolCall(
			request("unsupported_tool" as ToolCallRequest["toolName"]),
		);

		expect(decision).toEqual({
			allowed: false,
			code: "TOOL_NOT_ALLOWED",
			message: "Unsupported tool: unsupported_tool",
		});
	});

	it("accepts generic tools and ignores empty or non-string path arguments", async () => {
		await expect(
			gate.beforeToolCall(request("read_file", { filePath: "" })),
		).resolves.toEqual({ allowed: true, normalizedArgs: { filePath: "" } });
		await expect(
			gate.beforeToolCall(request("read_file", { filePath: 42 })),
		).resolves.toEqual({ allowed: true, normalizedArgs: { filePath: 42 } });
		await expect(
			gate.beforeToolCall(request("read_file", { filePath: "src/index.ts" })),
		).resolves.toEqual({
			allowed: true,
			normalizedArgs: { filePath: "src/index.ts" },
		});
	});

	it("rejects a denied manifest path and identifies the offending argument", async () => {
		const decision = await gate.beforeToolCall(
			request(
				"copy_directory",
				{
					sourcePath: "src",
					targetPath: "private/output",
				},
				{
					safetyPolicy: { deniedPaths: ["private"] },
				},
			),
		);

		expect(decision).toMatchObject({
			allowed: false,
			code: "ACCESS_DENIED",
			evidence: { pathArg: "targetPath", value: "private/output" },
		});
	});

	it.each([
		undefined,
		1,
		"   ",
	])("rejects invalid apply_patch content %#", async (patchContent) => {
		await expect(
			gate.beforeToolCall(request("apply_patch", { patchContent })),
		).resolves.toEqual({
			allowed: false,
			code: "INVALID_TOOL_ARGS",
			message: "apply_patch requires patchContent string.",
		});
	});

	it("extracts unique old and new patch targets while ignoring boundary lines", async () => {
		const patchContent = [
			"diff --git a/src/old.ts b/src/new.ts",
			"--- a/src/old.ts",
			"+++ b/src/new.ts",
			"+++ b/src/new.ts",
			"+++ b/",
			"+++ b//dev/null",
			"--- /dev/null",
			"@@ -1 +1 @@",
		].join("\n");

		await expect(
			gate.beforeToolCall(request("apply_patch", { patchContent })),
		).resolves.toEqual({
			allowed: true,
			normalizedArgs: { patchContent },
			preflight: { patchTargets: ["src/old.ts", "src/new.ts"] },
		});
	});

	it("rejects a patch target outside the workspace", async () => {
		const decision = await gate.beforeToolCall(
			request("apply_patch", {
				patchContent: "--- a/src/file.ts\n+++ b/../outside.ts",
			}),
		);

		expect(decision).toMatchObject({
			allowed: false,
			code: "ACCESS_DENIED",
			evidence: { target: "../outside.ts" },
		});
	});

	it.each([
		undefined,
		0,
		"  ",
	])("rejects invalid replace_content target %#", async (filePath) => {
		await expect(
			gate.beforeToolCall(request("replace_content", { filePath })),
		).resolves.toEqual({
			allowed: false,
			code: "INVALID_TOOL_ARGS",
			message: "replace_content requires filePath string.",
		});
	});

	it("returns replace_content preflight data", async () => {
		const args = { filePath: "src/file.ts", needle: "a", replacement: "b" };
		await expect(
			gate.beforeToolCall(request("replace_content", args)),
		).resolves.toEqual({
			allowed: true,
			normalizedArgs: args,
			preflight: { targetFile: "src/file.ts" },
		});
	});

	it.each([
		["run_command", undefined],
		["run_background_command", 4],
		["run_verification", "  "],
	] as const)("rejects invalid %s command input", async (toolName, command) => {
		const decision = await gate.beforeToolCall(request(toolName, { command }));
		expect(decision).toMatchObject({
			allowed: false,
			code: "INVALID_TOOL_ARGS",
			message: `${toolName} requires command string.`,
		});
	});

	it("rejects a command working directory outside the workspace", async () => {
		const decision = await gate.beforeToolCall(
			request("run_command", { command: "echo ok", cwd: "../outside" }),
		);
		expect(decision).toMatchObject({ allowed: false, code: "ACCESS_DENIED" });
	});

	it.each([
		["echo ok && pwd", "CHAINED_COMMAND_BLOCKED", "destructive"],
		["curl https://example.com", "UNKNOWN_COMMAND", "unknown"],
		["git push origin main", "COMMAND_BLOCKED", "destructive"],
	] as const)("classifies a rejected command: %s", async (command, code, classification) => {
		const decision = await gate.beforeToolCall(
			request("run_command", { command }),
		);
		expect(decision).toMatchObject({
			allowed: false,
			code,
			evidence: { command, classification },
		});
	});

	it("requires background commands to use the background tool", async () => {
		const decision = await gate.beforeToolCall(
			request("run_command", { command: "npm run dev" }),
		);
		expect(decision).toMatchObject({
			allowed: false,
			code: "COMMAND_BLOCKED",
			evidence: { classification: "background" },
		});
	});

	it("restricts the background tool to background-safe commands", async () => {
		const decision = await gate.beforeToolCall(
			request("run_background_command", { command: "echo done" }),
		);
		expect(decision).toMatchObject({
			allowed: false,
			code: "COMMAND_BLOCKED",
			evidence: { classification: "read_only" },
		});
	});

	it("allows command variants and normalizes default and capped timeouts", async () => {
		const foreground = await gate.beforeToolCall(
			request("run_verification", { command: "npm test", cwd: repoRoot }),
		);
		expect(foreground).toMatchObject({
			allowed: true,
			normalizedArgs: { timeoutSeconds: 60 },
			effectiveLimits: { timeoutSeconds: 60 },
		});

		const background = await gate.beforeToolCall(
			request(
				"run_background_command",
				{ command: "npm run dev", timeoutSeconds: 90 },
				{ safetyPolicy: { maxCommandSeconds: 15 } },
			),
		);
		expect(background).toMatchObject({
			allowed: true,
			normalizedArgs: { timeoutSeconds: 15 },
			effectiveLimits: { timeoutSeconds: 15 },
		});
	});

	it.each([
		[{ toolName: "ping" }, "mcp_call_tool requires serverId string."],
		[
			{ serverId: "   ", toolName: "ping" },
			"mcp_call_tool requires serverId string.",
		],
		[{ serverId: "server" }, "mcp_call_tool requires toolName string."],
		[
			{ serverId: "server", toolName: 7 },
			"mcp_call_tool requires toolName string.",
		],
		[
			{ serverId: "server", toolName: "ping", arguments: null },
			"mcp_call_tool arguments must be an object when provided.",
		],
		[
			{ serverId: "server", toolName: "ping", arguments: [] },
			"mcp_call_tool arguments must be an object when provided.",
		],
		[
			{ serverId: "server", toolName: "ping", arguments: "bad" },
			"mcp_call_tool arguments must be an object when provided.",
		],
	] as const)("rejects invalid MCP arguments %#", async (args, message) => {
		await expect(
			gate.beforeToolCall(request("mcp_call_tool", args)),
		).resolves.toEqual({ allowed: false, code: "INVALID_TOOL_ARGS", message });
	});

	it.each([
		{ serverId: "server", toolName: "ping" },
		{ serverId: "server", toolName: "ping", arguments: { value: 1 } },
	])("accepts valid MCP arguments %#", async (args) => {
		await expect(
			gate.beforeToolCall(request("mcp_call_tool", args)),
		).resolves.toEqual({ allowed: true, normalizedArgs: args });
	});
});

describe("DefaultToolPolicyGate afterToolCall coverage", () => {
	it("rejects denied paths leaked by search results and skips malformed matches", async () => {
		const toolResult = result({
			matches: [
				null,
				[],
				{},
				{ filePath: 2 },
				{ filePath: "src/ok.ts" },
				{ filePath: "private/key.ts" },
			],
		});
		const checked = await gate.afterToolCall(
			request(
				"search_files",
				{},
				{ safetyPolicy: { deniedPaths: ["private"] } },
			),
			toolResult,
		);

		expect(checked.result).toBe(toolResult);
		expect(checked.policyViolation).toMatchObject({
			allowed: false,
			code: "POLICY_VIOLATION",
			evidence: { filePath: "private/key.ts" },
		});
	});

	it("allows valid search results and non-array match payloads", async () => {
		await expect(
			gate.afterToolCall(request("search_files"), result({ matches: "none" })),
		).resolves.toEqual({ result: expect.any(Object), warnings: undefined });
		await expect(
			gate.afterToolCall(
				request("search_files"),
				result({ matches: [{ filePath: "src/ok.ts" }] }),
			),
		).resolves.toEqual({ result: expect.any(Object), warnings: undefined });
	});

	it("validates apply_patch output against only string preflight targets", async () => {
		const changedOutside = result({ changedFiles: [null, 4, "src/extra.ts"] });
		const checked = await gate.afterToolCall(
			request("apply_patch"),
			changedOutside,
			{ patchTargets: [null, "src/expected.ts"] },
		);
		expect(checked.policyViolation).toMatchObject({
			allowed: false,
			code: "POLICY_VIOLATION",
			evidence: {
				expected: ["src/expected.ts"],
				changed: ["src/extra.ts"],
			},
		});

		await expect(
			gate.afterToolCall(
				request("apply_patch"),
				result({ changedFiles: ["src/expected.ts"] }),
				{ patchTargets: ["src/expected.ts"] },
			),
		).resolves.toEqual({ result: expect.any(Object), warnings: undefined });
		await expect(
			gate.afterToolCall(
				request("apply_patch"),
				result({ changedFiles: "none" }),
			),
		).resolves.toEqual({ result: expect.any(Object), warnings: undefined });
	});

	it("detects replace_content target mismatches only when both paths are strings", async () => {
		const mismatch = await gate.afterToolCall(
			request("replace_content"),
			result({ filePath: "src/actual.ts" }),
			{ targetFile: "src/expected.ts" },
		);
		expect(mismatch.policyViolation).toMatchObject({
			allowed: false,
			code: "POLICY_VIOLATION",
			evidence: { expected: "src/expected.ts", filePath: "src/actual.ts" },
		});

		for (const [payload, preflight] of [
			[{ filePath: "src/same.ts" }, { targetFile: "src/same.ts" }],
			[{ filePath: 1 }, { targetFile: "src/file.ts" }],
			[{ filePath: "src/file.ts" }, { targetFile: 1 }],
		] as const) {
			const checked = await gate.afterToolCall(
				request("replace_content"),
				result(payload),
				preflight,
			);
			expect(checked.policyViolation).toBeUndefined();
		}
	});

	it.each([
		null,
		[],
		false,
	])("handles non-record result payload %#", async (payload) => {
		const toolResult = result(payload);
		await expect(
			gate.afterToolCall(request("git_status"), toolResult),
		).resolves.toEqual({ result: toolResult, warnings: undefined });
	});

	it("reports every secret-bearing output field for command results", async () => {
		const checked = await gate.afterToolCall(
			request("run_command"),
			result({
				stdout: "api_key=visible-value",
				stderr: "password: hunter2",
				diff: "token = 'abc'",
			}),
		);
		expect(checked.warnings).toEqual([
			"Potential secret pattern detected in stdout.",
			"Potential secret pattern detected in stderr.",
			"Potential secret pattern detected in diff.",
		]);
	});

	it("checks git diffs but ignores non-string and harmless output values", async () => {
		const toolResult = result({
			stdout: 123,
			stderr: "ordinary message",
			diff: "secret='value'",
		});
		await expect(
			gate.afterToolCall(request("git_diff"), toolResult),
		).resolves.toEqual({
			result: toolResult,
			warnings: ["Potential secret pattern detected in diff."],
		});
	});
});
