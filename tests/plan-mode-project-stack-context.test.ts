import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderPlanModePackageScriptsContext } from "../api/modules/specification/plan-mode-project-stack-context";

describe("plan mode project stack context", () => {
	it("asks plans to add a minimal verify gate when package scripts are missing", () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-plan-mode-no-scripts-"),
		);
		try {
			const context = renderPlanModePackageScriptsContext(repoRoot);

			expect(context).toContain("package.json scripts は未検出");
			expect(context).toContain(
				"template を使わない場合でも、既存構成に合わせた最小の verify 系 script を追加する手順",
			);
			expect(context).toContain(
				"build / typecheck / lint / test など、この repository で実行可能な確認を束ねる quality gate",
			);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("marks verify as the representative gate when individual checks also exist", () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-plan-mode-scripts-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					scripts: {
						verify:
							"bun run build && bun run typecheck && bun run lint && bun run test",
						build: "vite build",
						typecheck: "tsc --noEmit",
						lint: "biome check .",
						test: "vitest run",
					},
				}),
				"utf8",
			);

			const context = renderPlanModePackageScriptsContext(repoRoot);

			expect(context).toContain("- verify: bun run build");
			expect(context).toContain(
				"verify / verify:base がある場合は代表 gate として優先",
			);
			expect(context).toContain(
				"build / typecheck / lint / test を検証計画に同列で重複列挙しない",
			);
			expect(context).toContain(
				"対象範囲の確認または verify で代替できない理由がある場合だけ",
			);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("asks plans to add a representative verify gate when only individual checks exist", () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-plan-mode-individual-scripts-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					scripts: {
						build: "vite build",
						typecheck: "tsc --noEmit",
						lint: "biome check .",
						test: "vitest run",
					},
				}),
				"utf8",
			);

			const context = renderPlanModePackageScriptsContext(repoRoot);

			expect(context).toContain("- build: vite build");
			expect(context).toContain(
				"verify / verify:base が無い場合は、既存の build / typecheck / lint / test を束ねる verify 系 script の追加",
			);
			expect(context).toContain(
				"追加した verify 系 script を代表 gate として扱い",
			);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});
});
