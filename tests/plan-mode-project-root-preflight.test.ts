import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	inspectPlanModeProjectRoot,
	readPlanModeProjectInstructionContext,
	renderPlanModeProjectInstructionContext,
	renderPlanModeProjectRootPreflight,
	renderPlanModeQuestionnaireRepositoryPolicy,
	resolvePlanModeQuestionnaireRepositoryPolicy,
} from "../api/modules/specification/plan-mode-project-stack-context";

describe("Plan Mode project root preflight", () => {
	it("runs pwd and ls against the registered repository before stack evaluation", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-questionnaire-preflight-"),
		);
		try {
			fs.writeFileSync(path.join(repoRoot, "package.json"), "{}\n", "utf8");
			fs.mkdirSync(path.join(repoRoot, "src"));

			const preflight = await inspectPlanModeProjectRoot({
				repositoryRoot: repoRoot,
			});

			expect(preflight.checks).toEqual([
				{ command: "pwd", status: "passed" },
				{ command: "ls", status: "passed" },
			]);
			expect(preflight.workingDirectory).toBe(fs.realpathSync(repoRoot));
			expect(preflight.directoryListing).toContain("package.json");
			expect(preflight.directoryListing).toContain("src");
			expect(preflight.directoryListingDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
			expect(preflight.gitHead).toBeNull();
			expect(preflight.gitHeadStatus).toBe("not_verified");
			const rendered = renderPlanModeProjectRootPreflight(preflight);
			expect(rendered).toContain("pwd: passed");
			expect(rendered).toContain("ls: passed");
			expect(rendered).toContain("Git HEAD: 未確認");
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("loads LLM_CONTEXT.md as authoritative bounded project context", () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-project-instructions-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "LLM_CONTEXT.md"),
				"# Project rules\n- Hono + React/Vite\n- local SQLite\n",
				"utf8",
			);

			const context = readPlanModeProjectInstructionContext(repoRoot);

			expect(context).not.toBeNull();
			if (!context) throw new Error("LLM_CONTEXT.md was not loaded");
			expect(context?.content).toContain("local SQLite");
			expect(context?.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
			expect(context?.truncated).toBe(false);
			const rendered = renderPlanModeProjectInstructionContext(context);
			expect(rendered).toContain("Project instruction context");
			expect(rendered).toContain(path.join(repoRoot, "LLM_CONTEXT.md"));
			expect(rendered).toContain("Hono + React/Vite");
			expect(
				renderPlanModeQuestionnaireRepositoryPolicy("repository_fixed"),
			).toContain("existing_materialized_project");
			expect(
				resolvePlanModeQuestionnaireRepositoryPolicy({
					gitHead: null,
					hasProjectInstructionContext: true,
				}),
			).toBe("repository_fixed");
			expect(
				resolvePlanModeQuestionnaireRepositoryPolicy({
					gitHead: null,
					hasProjectInstructionContext: false,
				}),
			).toBe("starter_selection_required");
			const emptyProjectPolicy = renderPlanModeQuestionnaireRepositoryPolicy(
				"starter_selection_required",
			);
			expect(emptyProjectPolicy).toContain(
				"登録済みProject folderの確認結果、Git HEADもProject指示contextもない",
			);
			expect(emptyProjectPolicy).toContain(
				"登録済みProject rootへimportするtemplate familyとvariantを選ぶための質問",
			);
			expect(emptyProjectPolicy).toContain(
				"implementationPlanの先頭Project import Todo",
			);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});
});
