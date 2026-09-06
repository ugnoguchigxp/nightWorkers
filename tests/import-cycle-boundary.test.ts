import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	analyzeImportCycles,
	compareImportCycleBaseline,
} from "../scripts/check-import-cycles.mjs";

let root: string | undefined;
afterEach(() => {
	if (root) fs.rmSync(root, { recursive: true, force: true });
});

function analyze(sources: Record<string, string>) {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "import-cycle-"));
	fs.writeFileSync(
		path.join(root, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				moduleResolution: "bundler",
				paths: { "@/*": ["./src/*"] },
			},
		}),
	);
	for (const [file, source] of Object.entries(sources)) {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), source);
	}
	return analyzeImportCycles(root, Object.keys(sources)).cycles;
}

describe("static import cycle guard", () => {
	it("resolves aliases and barrel reexports to detect a cycle", () => {
		expect(
			analyze({
				"src/index.ts": 'export * from "./panel";',
				"src/panel.ts":
					'import { value } from "@/index"; export const panel = value;',
			}),
		).toEqual([["src/index.ts", "src/panel.ts"]]);
	});
	it("excludes explicit type-only edges and deferred imports", () => {
		expect(
			analyze({
				"src/a.ts":
					'import type { B } from "./b"; import { type B as C } from "./b"; export type { B } from "./b"; const later = () => import("./b");',
				"src/b.ts": 'import "./a"; export type B = string;',
			}),
		).toEqual([]);
	});
	it("retains mixed value and type imports, including self imports", () => {
		expect(
			analyze({
				"src/a.ts": 'import { type B, value } from "./b";',
				"src/b.ts": 'import "./a";',
				"src/self.ts": 'export * from "./self";',
			}),
		).toEqual([["src/a.ts", "src/b.ts"], ["src/self.ts"]]);
	});
	it("rejects new or enlarged groups and obsolete baseline entries", () => {
		const baseline = { version: 1, cycles: [["a", "b"]] };
		expect(compareImportCycleBaseline([["b", "a"]], baseline)).toEqual([]);
		expect(
			compareImportCycleBaseline([["a", "b", "c"]], baseline),
		).toHaveLength(2);
		expect(
			compareImportCycleBaseline(
				[
					["a", "b"],
					["c", "d"],
				],
				baseline,
			),
		).toHaveLength(1);
		expect(compareImportCycleBaseline([], baseline)).toHaveLength(1);
		expect(() =>
			compareImportCycleBaseline([], { version: 2, cycles: [] }),
		).toThrow();
	});
});
