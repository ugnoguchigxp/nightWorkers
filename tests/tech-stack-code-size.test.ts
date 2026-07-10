import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countEffectiveLinesInText } from "../api/modules/techStack/effective-line-counter";
import { measureProjectCodeSize } from "../api/modules/techStack/project-code-size.service";
import { createProjectCodeSizeClassifier } from "../api/modules/techStack/project-code-size-classifier";

function write(root: string, relativePath: string, content: string) {
	const target = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content, "utf8");
}

describe("Tech Stack effective line counter", () => {
	it("excludes blank and comment-only lines without stripping comment markers in strings", () => {
		const source = [
			"// comment",
			"",
			"const url = 'https://example.com'; // inline",
			"/* block",
			" * comment",
			" */ const answer = 42;",
			"const marker = '/* not a comment */';",
		].join("\r\n");
		expect(countEffectiveLinesInText("src/example.ts", source)).toBe(3);
	});

	it("handles hash, SQL, and HTML comments", () => {
		expect(countEffectiveLinesInText("script.py", "# note\nvalue = 1\n")).toBe(
			1,
		);
		expect(
			countEffectiveLinesInText(
				"schema.sql",
				"-- note\nCREATE TABLE example(id int); /* inline */\n",
			),
		).toBe(1);
		expect(
			countEffectiveLinesInText(
				"index.html",
				"<!-- note -->\n<div>content</div>\n",
			),
		).toBe(1);
	});

	it("counts comment markers inside multiline template strings as code", () => {
		const source = [
			"const template = `",
			"// string content",
			"/* string content */",
			"`;",
			"// actual comment",
		].join("\n");
		expect(countEffectiveLinesInText("src/template.ts", source)).toBe(4);
	});

	it("handles supported stylesheet, HCL, and PowerShell comment forms", () => {
		expect(
			countEffectiveLinesInText("styles/main.less", "// note\n.a {}\n"),
		).toBe(1);
		expect(
			countEffectiveLinesInText(
				"infra/main.tf",
				'// note\n/* block */\nresource "x" "y" {}\n',
			),
		).toBe(1);
		expect(
			countEffectiveLinesInText(
				"scripts/setup.ps1",
				"<#\nblock\n#>\nWrite-Output 'ok'\n",
			),
		).toBe(1);
	});
});

describe("Tech Stack project code size measurement", () => {
	it("uses one manifest classification snapshot throughout a scan", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "nw-code-classifier-"));
		try {
			write(
				root,
				"package.json",
				JSON.stringify({ dependencies: { react: "1" } }),
			);
			const classify = createProjectCodeSizeClassifier({
				repoRoot: root,
				topLevelSegments: new Set(["src"]),
			});
			expect(classify("src/first.ts").target).toEqual({
				type: "source",
				category: "frontend",
			});
			write(
				root,
				"package.json",
				JSON.stringify({ dependencies: { express: "1" } }),
			);
			expect(classify("src/second.ts").target).toEqual({
				type: "source",
				category: "frontend",
			});
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("classifies production genres and unit/e2e tests without double counting", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "nw-code-size-"));
		try {
			write(
				root,
				"package.json",
				JSON.stringify({ dependencies: { react: "1", hono: "1" } }),
			);
			write(root, "src/App.tsx", "// ui\nexport const App = () => <main />;\n");
			write(root, "api/server.ts", "export const server = true;\n");
			write(root, "api/workers/job.ts", "export const job = true;\n");
			write(
				root,
				"api/services/worker-tools/run.ts",
				"export const tool = true;\n",
			);
			write(root, "scripts/release.ts", "export const release = true;\n");
			write(root, "shared/types.ts", "export type Id = string;\n");
			write(root, "drizzle/schema.sql", "CREATE TABLE item(id int);\n");
			write(root, "tests/app.test.ts", "it('works', () => {});\n");
			write(root, "tests/scripts/check.sh", "#!/bin/sh\necho ok\n");
			write(root, "tests/e2e/app.spec.ts", "test('works', () => {});\n");
			write(
				root,
				"tests/api.integration.test.ts",
				"it('integrates', () => {});\n",
			);
			fs.symlinkSync(
				path.join(root, "src/App.tsx"),
				path.join(root, "linked.ts"),
			);

			const result = await measureProjectCodeSize(root);
			const source = Object.fromEntries(
				result.sourceBuckets.map((bucket) => [bucket.category, bucket]),
			);
			const tests = Object.fromEntries(
				result.testBuckets.map((bucket) => [bucket.kind, bucket]),
			);

			expect(source.frontend.files).toBe(1);
			expect(source.backend.files).toBe(2);
			expect(source.batch.files).toBe(1);
			expect(source.script.files).toBe(1);
			expect(source.shared.files).toBe(1);
			expect(source.database.files).toBe(1);
			expect(tests.unit.files).toBe(2);
			expect(tests.e2e.files).toBe(1);
			expect(tests.other.files).toBe(1);
			expect(result.inventory.source).toBe("filesystem");
			expect(result.inventory.skipped.symlink).toBe(1);
			expect(result.totals.totalFiles).toBe(
				result.totals.sourceFiles + result.totals.testFiles,
			);
			expect(result.totals.totalEffectiveLines).toBe(
				result.totals.sourceEffectiveLines + result.totals.testEffectiveLines,
			);
			expect(
				source.backend.roots.some((entry: { path: string }) =>
					entry.path.includes("worker-tools"),
				),
			).toBe(false);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
