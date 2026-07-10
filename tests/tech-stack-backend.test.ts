import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import app from "../api/app";
import { ensureTechStackTables } from "../api/db/tech-stack-schema-bootstrap";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import * as techStackRepo from "../api/modules/techStack/tech-stack.repository";
import { createRepository } from "./project-detail-backend/helpers";
import "./project-detail-backend/setup";

function write(root: string, relativePath: string, content: string) {
	const target = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content, "utf8");
}

async function measure(repositoryId: string) {
	return app.request(
		`http://localhost/api/repositories/${repositoryId}/tech-stack/code-size/measure`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		},
	);
}

describe("Tech Stack measurement API", () => {
	it("measures, persists, reloads, and preserves the previous snapshot on failure", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "nw-tech-stack-api-"));
		try {
			write(
				root,
				"package.json",
				JSON.stringify({ dependencies: { react: "1" } }),
			);
			write(root, "src/App.tsx", "export const App = () => <main />;\n");
			write(root, "tests/app.test.ts", "it('works', () => {});\n");
			write(root, "tests/e2e/app.spec.ts", "test('works', () => {});\n");
			const project = await createRepository(root);

			const measureResponse = await measure(project.id);
			expect(measureResponse.status).toBe(200);
			const first = await measureResponse.json();
			expect(first).toMatchObject({
				repositoryId: project.id,
				algorithmVersion: "effective-lines-v1",
				totals: { sourceFiles: 1, testFiles: 2, totalFiles: 3 },
			});

			const metricsResponse = await app.request(
				`http://localhost/api/repositories/${project.id}/project-detail/metrics`,
			);
			expect(metricsResponse.status).toBe(200);
			const metrics = await metricsResponse.json();
			expect(metrics.codeSizeSnapshot.id).toBe(first.id);

			write(root, "api/server.ts", "export const server = true;\n");
			const secondResponse = await measure(project.id);
			expect(secondResponse.status).toBe(200);
			const second = await secondResponse.json();
			expect(second.id).toBe(first.id);
			expect(second.totals.sourceFiles).toBe(2);

			fs.rmSync(root, { recursive: true, force: true });
			const failedResponse = await measure(project.id);
			expect(failedResponse.status).toBe(400);
			expect(
				await techStackRepo.getProjectCodeSizeSnapshot(project.id),
			).toMatchObject({
				id: first.id,
				totals: { sourceFiles: 2 },
			});

			await nightworkersRepo.deleteRepository(project.id);
			expect(
				await techStackRepo.getProjectCodeSizeSnapshot(project.id),
			).toBeNull();
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps snapshots isolated by repository and bootstraps idempotently", async () => {
		const firstRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nw-tech-stack-a-"),
		);
		const secondRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nw-tech-stack-b-"),
		);
		const repositoryIds: string[] = [];
		try {
			await ensureTechStackTables();
			await ensureTechStackTables();
			write(firstRoot, "src/App.tsx", "export const app = true;\n");
			write(secondRoot, "api/server.ts", "export const server = true;\n");
			write(secondRoot, "api/routes.ts", "export const routes = true;\n");
			const firstProject = await createRepository(firstRoot);
			const secondProject = await createRepository(secondRoot);
			repositoryIds.push(firstProject.id, secondProject.id);

			const [firstResponse, secondResponse] = await Promise.all([
				measure(firstProject.id),
				measure(secondProject.id),
			]);
			expect(firstResponse.status).toBe(200);
			expect(secondResponse.status).toBe(200);
			const firstSnapshot = await firstResponse.json();
			const secondSnapshot = await secondResponse.json();
			expect(firstSnapshot).toMatchObject({
				repositoryId: firstProject.id,
				totals: { sourceFiles: 1 },
			});
			expect(secondSnapshot).toMatchObject({
				repositoryId: secondProject.id,
				totals: { sourceFiles: 2 },
			});
			expect(firstSnapshot.id).not.toBe(secondSnapshot.id);
		} finally {
			for (const repositoryId of repositoryIds) {
				await nightworkersRepo.deleteRepository(repositoryId);
			}
			fs.rmSync(firstRoot, { recursive: true, force: true });
			fs.rmSync(secondRoot, { recursive: true, force: true });
		}
	});
});
