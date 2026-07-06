import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const roots = ["api", "src", "shared", "tests"];

const forbiddenTerms = [
	"blueprint-db-design",
	"blueprint-db-design-request",
	"blueprint-db-design-adoption",
	"blueprint_workspace",
	"dbDesign",
	"db-design",
	"DB Design",
	"db_design",
	"dbDesignHandoffNotes",
	"dbDesignWorkflowOnly",
	"specification-workspace/db-design",
	"verification_matrix",
	"ui_specification",
	"design_view_references",
	"Usecase",
	"usecase",
	"AI Coding Rules",
];

const allowedMatches = new Set([
	"src/modules/nightworkers/components/ArtifactPane.tsx:db-design",
]);

const allowedExtensions = new Set([
	".css",
	".cjs",
	".js",
	".json",
	".md",
	".mjs",
	".tsx",
	".ts",
]);

describe("Plan mode legacy text audit", () => {
	it("keeps removed Plan mode artifact names out of runtime and tests", () => {
		const findings: string[] = [];
		for (const file of collectFiles(process.cwd())) {
			if (file.endsWith("tests/plan-mode-legacy-text-audit.test.ts")) continue;
			const content = readFileSync(file, "utf8");
			const rel = normalizePath(relative(process.cwd(), file));
			for (const term of forbiddenTerms) {
				if (!content.includes(term)) continue;
				const allowKey = `${rel}:${term}`;
				if (allowedMatches.has(allowKey)) continue;
				findings.push(`${rel}: contains ${term}`);
			}
		}
		expect(findings).toEqual([]);
	});
});

function collectFiles(cwd: string) {
	return roots.flatMap((root) => walk(join(cwd, root)));
}

function walk(path: string): string[] {
	const entry = statSync(path);
	if (entry.isDirectory()) {
		if (path.includes("/node_modules/") || path.includes("/dist/")) return [];
		return readdirSync(path).flatMap((name) => walk(join(path, name)));
	}
	if (!entry.isFile()) return [];
	const ext = path.slice(path.lastIndexOf("."));
	return allowedExtensions.has(ext) ? [path] : [];
}

function normalizePath(path: string) {
	return path.split("\\").join("/");
}
