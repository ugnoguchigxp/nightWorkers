import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAllowedToolsForJobType } from "../api/services/supervisor/prompt";
import {
	clearSupervisorReferenceDocumentCache,
	listSupervisorReferenceDocuments,
	normalizeSupervisorRoutingHypothesis,
	renderSupervisorReferenceDocuments,
	resolveSupervisorReferenceDocuments,
} from "../api/services/supervisor/skills/registry";

describe("Supervisor reference registry", () => {
	it("loads the complete built-in routing document set", () => {
		const documents = listSupervisorReferenceDocuments();

		expect(
			documents.some((document) => document.relativePath === "SKILL.md"),
		).toBe(true);
		expect(
			documents.some(
				(document) => document.relativePath === "references/modes/code_edit.md",
			),
		).toBe(true);
		expect(
			documents.some(
				(document) =>
					document.relativePath === "references/overlays/evidence.md",
			),
		).toBe(true);
		expect(
			documents.some(
				(document) =>
					document.relativePath === "references/work_kinds/blueprint.md",
			),
		).toBe(true);
		expect(
			documents.every((document) => document.digest.startsWith("sha256:")),
		).toBe(true);
	});

	it("resolves only references needed by the routing hypothesis", () => {
		const documents = resolveSupervisorReferenceDocuments({
			primaryMode: "code_edit",
			secondaryModes: ["test_and_verification"],
			phase: "execute",
			workKinds: ["code"],
			overlays: ["evidence"],
			requiredEvidence: ["repo inspection"],
			nextReferenceFiles: [],
			confidence: 0.8,
		});
		const paths = documents.map((document) => document.relativePath);

		expect(paths).toContain("SKILL.md");
		expect(paths).toContain("references/router.md");
		expect(paths).toContain("references/phases/execute.md");
		expect(paths).toContain("references/modes/code_edit.md");
		expect(paths).toContain("references/modes/test_and_verification.md");
		expect(paths).toContain("references/work_kinds/code.md");
		expect(paths).toContain("references/overlays/evidence.md");
		expect(paths).not.toContain("references/overlays/security.md");
	});

	it("covers minor_code_edit routing with code-edit references and narrow edit tool policy", () => {
		const documents = resolveSupervisorReferenceDocuments({
			primaryMode: "code_edit",
			secondaryModes: [],
			phase: "execute",
			workKinds: ["code"],
			overlays: ["evidence"],
			requiredEvidence: ["target file inspection"],
			nextReferenceFiles: [],
			confidence: 0.9,
		});
		const paths = documents.map((document) => document.relativePath);
		const rendered = renderSupervisorReferenceDocuments(documents);
		const toolNames = getAllowedToolsForJobType("minor_code_edit").map(
			(tool) => tool.name,
		);

		expect(paths).toEqual([
			"SKILL.md",
			"references/router.md",
			"references/phases/execute.md",
			"references/modes/code_edit.md",
			"references/work_kinds/code.md",
			"references/overlays/evidence.md",
		]);
		expect(rendered).toContain("編集前に既存コードを確認する");
		expect(rendered).toContain("変更前に関連ファイルを読む");
		expect(rendered).toContain("code edit 後は verify に進む");
		expect(rendered).toContain("observations が空の場合、最終回答へ進まず");
		expect(rendered).toContain(
			"pgvector と Turso/libSQL の専用 variant は Hono と Python に限る",
		);
		expect(rendered).toContain(
			"同じ stack と runtime version の SQLite variant",
		);
		expect(rendered).toContain("指定した DB を SQLite に変更しない");

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

		const rendered = renderSupervisorReferenceDocuments(
			resolveSupervisorReferenceDocuments({
				primaryMode: "code_edit",
				secondaryModes: ["test_and_verification"],
				phase: "verify",
				workKinds: ["code"],
				overlays: ["evidence"],
				requiredEvidence: ["focused verification"],
				nextReferenceFiles: [],
				confidence: 0.9,
			}),
		);

		expect(rendered).toContain("bounded な出力を優先");
		expect(rendered).toContain("path/glob/context を絞った `rg`");
		expect(rendered).toContain("focused verification");
		expect(rendered).toContain("compressionMode=off");
	});

	it("resolves blueprint references from app blueprint routing", () => {
		const documents = resolveSupervisorReferenceDocuments({
			primaryMode: "planning",
			secondaryModes: ["review"],
			phase: "plan",
			workKinds: ["blueprint", "ui_ux"],
			overlays: ["user_facing_change"],
			subtype: "app_blueprint",
			requiredEvidence: ["latest user request"],
			nextReferenceFiles: ["references/work_kinds/blueprint.md"],
			confidence: 0.85,
		});
		const paths = documents.map((document) => document.relativePath);

		expect(paths).toContain("SKILL.md");
		expect(paths).toContain("references/router.md");
		expect(paths).toContain("references/phases/plan.md");
		expect(paths).toContain("references/modes/planning.md");
		expect(paths).toContain("references/modes/review.md");
		expect(paths).toContain("references/work_kinds/blueprint.md");
		expect(paths).toContain("references/work_kinds/ui_ux.md");
		expect(paths).toContain("references/overlays/user_facing_change.md");
	});

	it("renders planning references with Feature Plan Plan View wording", () => {
		const documents = resolveSupervisorReferenceDocuments({
			primaryMode: "planning",
			secondaryModes: [],
			phase: "plan",
			workKinds: ["blueprint"],
			overlays: [],
			requiredEvidence: [],
			nextReferenceFiles: [],
			confidence: 0.8,
		});
		const rendered = renderSupervisorReferenceDocuments(documents);

		expect(rendered).toContain("Feature Plan");
		expect(rendered).toContain("Plan View");
		expect(rendered).toContain("Data Model view");
		expect(rendered).toContain("UI specification");
		expect(rendered).not.toContain(["DB", "Design workflow"].join(" "));
		expect(rendered).not.toContain(["DB", "Design に回す"].join(" "));
	});

	it("normalizes planMode routing decisions without expanding workKinds", () => {
		const normalized = normalizeSupervisorRoutingHypothesis({
			primaryMode: "planning",
			phase: "plan",
			workKinds: ["blueprint"],
			planMode: {
				primaryArtifact: "feature_plan",
				dedicatedViews: [
					{ view: "blueprint", decision: "include", reason: "UI needs a view" },
					{ view: "unknown", decision: "include", reason: "drop me" },
					{ view: "blueprint", decision: "omit", reason: "duplicate ignored" },
					{ view: "data_model", decision: "omit", reason: "" },
					{
						view: "zod_schema_design",
						decision: "skip",
						reason: "bad decision",
					},
				],
				specificationLenses: [
					"functional_requirements",
					"future_lens",
					"interface_contract",
					"functional_requirements",
				],
			},
		} as unknown as Parameters<typeof normalizeSupervisorRoutingHypothesis>[0]);

		expect(normalized.planMode).toEqual({
			primaryArtifact: "feature_plan",
			dedicatedViews: [
				{ view: "blueprint", decision: "include", reason: "UI needs a view" },
				{
					view: "data_model",
					decision: "omit",
					reason: "not specified by routing",
				},
			],
			specificationLenses: ["functional_requirements", "interface_contract"],
		});
		expect(normalized.workKinds).toEqual(["blueprint"]);
	});

	it("drops planMode routing outside planning routes", () => {
		const normalized = normalizeSupervisorRoutingHypothesis({
			primaryMode: "code_edit",
			phase: "execute",
			planMode: {
				primaryArtifact: "feature_plan",
				dedicatedViews: [
					{
						view: "blueprint",
						decision: "include",
						reason: "not allowed here",
					},
				],
				specificationLenses: ["functional_requirements"],
			},
		});

		expect(normalized.planMode).toBeUndefined();
	});

	it("ignores unknown nextReferenceFiles while allowing known extra references", () => {
		const documents = resolveSupervisorReferenceDocuments({
			primaryMode: "general_answer",
			secondaryModes: [],
			phase: "answer",
			workKinds: [],
			overlays: [],
			requiredEvidence: [],
			nextReferenceFiles: [
				"../../secret.md",
				"references/overlays/security.md",
			],
			confidence: 0.6,
		});
		const paths = documents.map((document) => document.relativePath);

		expect(paths).toContain("references/overlays/security.md");
		expect(paths).not.toContain("../../secret.md");
	});

	it("rejects configured directories that do not provide the full markdown set", () => {
		const directory = mkdtempSync(
			path.join(tmpdir(), "supervisor-references-"),
		);
		writeFileSync(
			path.join(directory, "SKILL.md"),
			[
				"# Root",
				"",
				"## Use When",
				"Test.",
				"",
				"## Required Behavior",
				"Test.",
				"",
				"## Stop Conditions",
				"Test.",
				"",
				"## Report Contract",
				"Test.",
			].join("\n"),
		);

		clearSupervisorReferenceDocumentCache();
		expect(() => listSupervisorReferenceDocuments(directory)).toThrow(
			/Supervisor reference markdown missing/,
		);
	});
});
