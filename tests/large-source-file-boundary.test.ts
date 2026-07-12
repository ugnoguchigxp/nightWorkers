import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateLargeSourceFiles } from "../scripts/check-large-source-files.mjs";
import { evaluateModuleBoundaries } from "../scripts/check-module-boundaries.mjs";

const root = path.resolve(import.meta.dirname, "..");

describe("domain-oriented large-file refactoring guardrails", () => {
	it("keeps the shrinking oversized-file baseline exact", () => {
		const baseline = JSON.parse(
			fs.readFileSync(
				path.join(root, ".agent-ontology/large-source-files.json"),
				"utf8",
			),
		) as { entries: unknown[] };
		const result = evaluateLargeSourceFiles(root);
		expect(result).toMatchObject({
			ok: true,
			lineLimit: 600,
			baselineCount: baseline.entries.length,
			oversizedCount: baseline.entries.length,
			errors: [],
		});
	});

	it("tracks every baseline entry with a target module and phase", () => {
		const baseline = JSON.parse(
			fs.readFileSync(
				path.join(root, ".agent-ontology/large-source-files.json"),
				"utf8",
			),
		) as {
			entries: Array<{ id: string; targetModule: string; phase: number }>;
		};

		expect(new Set(baseline.entries.map((entry) => entry.id)).size).toBe(
			baseline.entries.length,
		);
		expect(
			baseline.entries.every(
				(entry) => entry.targetModule.length > 0 && entry.phase >= 1,
			),
		).toBe(true);
	});

	it("enforces the incremental module boundary policy", () => {
		const result = evaluateModuleBoundaries(root);
		expect(result.ok).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.checkedFiles).toBeGreaterThan(0);
	});
});
