import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect } from "vitest";
import app from "../../api/app";
import {
	createRepository,
	writeCoverageSummary,
} from "../project-detail-backend/helpers";
import "../project-detail-backend/setup";

async function createCoverageProject(repoRoot: string) {
	writeCoverageSummary(repoRoot);
	fs.writeFileSync(
		path.join(repoRoot, "package.json"),
		JSON.stringify({
			scripts: { test: "echo unit", "test:coverage": "echo coverage" },
		}),
		"utf8",
	);
	return createRepository(repoRoot);
}

async function createCoverageRun(repositoryId: string) {
	const response = await app.request(
		`http://localhost/api/repositories/${repositoryId}/quality/runs`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ runType: "unit" }),
		},
	);
	expect(response.status).toBe(201);
	return (await response.json()) as { id: string };
}

describe("Quality coverage task", () => {
	it("creates one validated draft task from selected coverage files", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-quality-task-"),
		);
		try {
			const project = await createCoverageProject(repoRoot);
			const run = await createCoverageRun(project.id);
			const taskRes = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs/${run.id}/coverage-task`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ fileKeys: ["src/checkout.ts"] }),
				},
			);
			expect(taskRes.status).toBe(201);
			const result = (await taskRes.json()) as {
				task: {
					title: string;
					description: string;
					objective: string;
					acceptanceCriteria: string;
					status: string;
					createdBy: string;
				};
			};
			expect(result.task).toMatchObject({
				title: "カバレッジ改善: src/checkout.ts",
				status: "draft",
				createdBy: "quality-coverage",
			});
			expect(result.task.description).toContain(`Quality Run: ${run.id}`);
			expect(result.task.description).toContain(
				"coverage key: src/checkout.ts",
			);
			expect(result.task.description).toMatch(
				/Measured at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/,
			);
			expect(result.task.description).toContain("branches: 64.0%");
			expect(result.task.description).toContain("uncovered lines: 12, 18");
			expect(result.task.objective).toContain("意味のあるテスト");
			expect(result.task.acceptanceCriteria).toContain(
				"production source change",
			);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("rejects total, unknown, and stale coverage selections", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-quality-task-invalid-"),
		);
		try {
			const project = await createCoverageProject(repoRoot);
			const firstRun = await createCoverageRun(project.id);

			for (const fileKeys of [
				[],
				["total"],
				["src/missing.ts"],
				Array.from({ length: 21 }, (_, index) => `src/file-${index}.ts`),
			]) {
				const response = await app.request(
					`http://localhost/api/repositories/${project.id}/quality/runs/${firstRun.id}/coverage-task`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ fileKeys }),
					},
				);
				expect(response.status).toBe(400);
			}

			await createCoverageRun(project.id);
			const staleResponse = await app.request(
				`http://localhost/api/repositories/${project.id}/quality/runs/${firstRun.id}/coverage-task`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ fileKeys: ["src/checkout.ts"] }),
				},
			);
			expect(staleResponse.status).toBe(409);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});
});
