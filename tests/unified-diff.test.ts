import { describe, expect, it } from "vitest";
import {
	getChangedFileDiffs,
	getChangedFiles,
	getDiffStats,
} from "../src/lib/unifiedDiff";

describe("unified diff parsing", () => {
	it("splits files and preserves per-file addition and deletion counts", () => {
		const diff = [
			"diff --git a/src/first.ts b/src/first.ts",
			"--- a/src/first.ts",
			"+++ b/src/first.ts",
			"@@ -1,2 +1,2 @@",
			"-const before = true;",
			"+const after = true;",
			" unchanged();",
			"diff --git a/src/new.ts b/src/new.ts",
			"new file mode 100644",
			"--- /dev/null",
			"+++ b/src/new.ts",
			"@@ -0,0 +1,2 @@",
			"+export const one = 1;",
			"+export const two = 2;",
		].join("\n");

		expect(getChangedFileDiffs(diff)).toEqual([
			expect.objectContaining({
				path: "src/first.ts",
				added: 1,
				deleted: 1,
				diff: expect.stringContaining("+const after = true;"),
			}),
			expect.objectContaining({
				path: "src/new.ts",
				added: 2,
				deleted: 0,
				diff: expect.stringContaining("+export const two = 2;"),
			}),
		]);
		expect(getChangedFiles(diff)).toEqual([
			{ path: "src/first.ts", added: 1, deleted: 1 },
			{ path: "src/new.ts", added: 2, deleted: 0 },
		]);
		expect(getDiffStats(diff)).toEqual({ added: 3, deleted: 1 });
	});
});
