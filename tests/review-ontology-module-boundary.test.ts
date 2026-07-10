import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("Review and ontology module boundaries", () => {
	it("keeps legacy Review and ontology implementation paths removed", () => {
		for (const relativePath of [
			"api/modules/nightworkers/nightworkers.review-mode.service.ts",
			"api/modules/nightworkers/nightworkers.review-run.service.ts",
			"api/services/agent-ontology/agent-ontology.service.ts",
			"api/services/agent-runtime/ontology-runtime-context.ts",
			"src/modules/nightworkers/components/ReviewStatusViewer.tsx",
			"src/modules/nightworkers/types/review.ts",
		]) {
			expect(existsSync(path.join(root, relativePath)), relativePath).toBe(
				false,
			);
		}
	});

	it("has no production import from legacy implementation paths", () => {
		const result = spawnSync(
			"rg",
			[
				"-n",
				"modules/nightworkers/nightworkers\\.review|services/review-(results|rubrics)|services/agent-ontology|agent-runtime/ontology-runtime-context",
				"api",
				"src",
			],
			{ cwd: root, encoding: "utf8" },
		);
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
	});

	it("owns backend and frontend public entrypoints", () => {
		for (const relativePath of [
			"api/modules/review/index.ts",
			"api/modules/ontology/index.ts",
			"src/modules/review/index.ts",
			"src/modules/ontology/index.ts",
		]) {
			expect(existsSync(path.join(root, relativePath)), relativePath).toBe(
				true,
			);
		}
	});
});
