import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { nightWorkersCodexToolManifest } from "../api/mcp/nightworkers-tool-manifest";

const execFileAsync = promisify(execFile);

let tempDir = "";

afterEach(() => {
	if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
	tempDir = "";
});

describe("Codex NightWorkers MCP setup script", () => {
	it("keeps the Coding Agent tool capability surface explicit", () => {
		expect(Object.keys(nightWorkersCodexToolManifest)).toEqual([
			"read_current_specification",
			"list_recent_specifications",
			"todo_list",
			"run_check",
			"completion_check",
			"collect_test_inventory",
			"record_test_condition_mapping",
			"import_project",
			"list_modules",
			"get_module_ontology",
			"classify_goal",
			"compile_module_context",
			"check_boundary",
			"get_verification_plan",
		]);
	});

	it("removes only the NightWorkers MCP config sections", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nightworkers-codex-mcp-"));
		const configPath = path.join(tempDir, "config.toml");
		fs.writeFileSync(
			configPath,
			[
				'model = "gpt-5.5"',
				"",
				"[mcp_servers.context-still]",
				'command = "/bin/context-still"',
				"",
				"# NightWorkers MCP registration managed by scripts/setup-codex-nightworkers-mcp.mjs",
				"[mcp_servers.nightworkers]",
				'command = "bun"',
				'args = ["run", "codex:mcp"]',
				"",
				"[mcp_servers.nightworkers.tools.todo_list]",
				'approval_mode = "approve"',
				"# End NightWorkers MCP registration",
				"",
			].join("\n"),
		);

		await execFileAsync(
			process.execPath,
			["scripts/setup-codex-nightworkers-mcp.mjs"],
			{
				cwd: process.cwd(),
				env: { ...process.env, CODEX_CONFIG_PATH: configPath },
			},
		);
		const removed = fs.readFileSync(configPath, "utf8");
		expect(removed).toContain("[mcp_servers.context-still]");
		expect(removed).not.toContain("[mcp_servers.nightworkers]");
		expect(removed).not.toContain('args = ["run", "codex:mcp"]');
	});
});
