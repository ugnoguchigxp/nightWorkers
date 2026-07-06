import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import app from "../../api/app";

export async function createRepository(repoRoot: string) {
	const res = await app.request("http://localhost/api/repositories", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: `TEST: Project Detail ${crypto.randomUUID()}`,
			localPath: repoRoot,
			branch: "main",
		}),
	});
	expect(res.status).toBe(201);
	return (await res.json()) as { id: string };
}

export function writeCoverageSummary(repoRoot: string) {
	fs.mkdirSync(path.join(repoRoot, "coverage"), { recursive: true });
	fs.writeFileSync(
		path.join(repoRoot, "coverage", "coverage-summary.json"),
		JSON.stringify({
			total: {
				statements: { pct: 88.2 },
				branches: { pct: 81.4 },
				functions: { pct: 90 },
				lines: { pct: 87.5 },
			},
			"src/checkout.ts": {
				statements: { pct: 75 },
				branches: { pct: 64 },
				functions: { pct: 80 },
				lines: { pct: 72 },
				uncoveredLines: [12, 18],
			},
		}),
		"utf8",
	);
}

export function writePlaywrightSummary(repoRoot: string) {
	fs.mkdirSync(path.join(repoRoot, "playwright-report"), { recursive: true });
	fs.writeFileSync(
		path.join(repoRoot, "playwright-report", "results.json"),
		JSON.stringify({
			suites: [
				{
					title: "checkout.spec.ts",
					specs: [
						{
							title: "loads checkout",
							tests: [{ results: [{ status: "passed", duration: 120 }] }],
						},
					],
				},
			],
		}),
		"utf8",
	);
}
