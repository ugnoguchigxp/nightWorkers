import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderPlanModePackageScriptsContext } from "../api/modules/specification/plan-mode-project-stack-context";

describe("plan mode project stack context", () => {
	it("reports only the observed fact when package scripts are missing", () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-plan-mode-no-scripts-"),
		);
		try {
			const context = renderPlanModePackageScriptsContext(repoRoot);

			expect(context).toBe(
				"Project package scripts:\n- package.json scripts は未検出です。",
			);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("reports package scripts without adding verification guidance", () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-plan-mode-scripts-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					scripts: {
						build: "vite build",
						verify:
							"bun run build && bun run typecheck && bun run lint && bun run test",
						typecheck: "tsc --noEmit",
						lint: "biome check .",
						test: "vitest run",
					},
				}),
				"utf8",
			);

			const context = renderPlanModePackageScriptsContext(repoRoot);

			expect(context.indexOf("- build: vite build")).toBeLessThan(
				context.indexOf("- verify: bun run build"),
			);
			expect(context).toContain("- verify: bun run build");
			expect(context).not.toContain("検証方針");
			expect(context).not.toContain("script の追加");
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});
});
