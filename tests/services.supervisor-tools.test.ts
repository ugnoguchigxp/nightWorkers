import { describe, expect, it } from "vitest";
import { getAllowedToolsForJobType } from "../api/services/supervisor/prompt";

describe("Supervisor tool policy", () => {
	it("keeps minor_code_edit on the narrow edit tool policy", () => {
		const toolNames = getAllowedToolsForJobType("minor_code_edit").map(
			(tool) => tool.name,
		);

		expect(toolNames).toEqual([
			"read_current_specification",
			"read_file",
			"search_files",
			"copy_directory",
			"apply_patch",
			"replace_content",
			"run_command",
			"select_job_type",
			"finalize_answer",
		]);
		expect(toolNames).not.toContain("list_dir");
		expect(toolNames).not.toContain("git_status");
		expect(toolNames).not.toContain("git_diff");
		expect(toolNames).not.toContain("run_verification");
	});

	it("exposes Hono, Java, and Rust variants in the import_project schema", () => {
		const importProject = getAllowedToolsForJobType("major_code_edit").find(
			(tool) => tool.name === "import_project",
		);

		expect(importProject).toBeTruthy();
		expect(JSON.stringify(importProject?.inputSchema)).toContain("Rust/Axum");
		expect(JSON.stringify(importProject?.inputSchema)).toContain(
			"java25-sqlite",
		);
		expect(JSON.stringify(importProject?.inputSchema)).toContain("pgsql");
		expect(JSON.stringify(importProject?.inputSchema)).toContain(
			"SQLite を最終的な DB 要件へ置き換えない",
		);
		expect(JSON.stringify(importProject?.inputSchema)).not.toContain('"auth"');
	});

	it("exposes fresh reads in the read_file schema", () => {
		const readFile = getAllowedToolsForJobType("major_code_edit").find(
			(tool) => tool.name === "read_file",
		);

		expect(readFile).toBeTruthy();
		expect(readFile?.inputSchema).toMatchObject({
			properties: {
				filePath: { type: "string" },
				fresh: { type: "boolean" },
			},
		});
	});

	it("describes bounded command output defaults and scoped command guidance", () => {
		const tools = getAllowedToolsForJobType("test_and_verification");
		const runCommand = tools.find((tool) => tool.name === "run_command");
		const runVerification = tools.find(
			(tool) => tool.name === "run_verification",
		);

		expect(runCommand?.description).toContain("compressionMode=auto");
		expect(runCommand?.description).toContain("git diff --stat");
		expect(runCommand?.description).toContain("compressionMode=off");
		expect(runVerification?.description).toContain("compressionMode=auto");
		expect(runVerification?.description).toContain("失敗名");
	});
});
