import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect } from "vitest";
import app from "../../api/app";
import * as nightworkersRepo from "../../api/modules/nightworkers/nightworkers.repository";
import { recordLlmUsage } from "../../api/services/llm-usage";
import { upsertPricingRow } from "../../api/services/pricing";
import { createRepository } from "./helpers";
import "./setup";

function git(repoRoot: string, args: string[]) {
	return execFileSync("git", ["-C", repoRoot, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

describe("Project Detail backend mission core", () => {
	it("supports mission goal CRUD and metrics empty state", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({ scripts: { test: "echo unit" } }),
				"utf8",
			);
			const project = await createRepository(repoRoot);

			const metricsRes = await app.request(
				`http://localhost/api/repositories/${project.id}/project-detail/metrics`,
			);
			expect(metricsRes.status).toBe(200);
			await expect(metricsRes.json()).resolves.toMatchObject({
				stackProfile: { manifestStatus: "found" },
				codeSizeSnapshot: null,
			});

			const presetsRes = await app.request(
				"http://localhost/api/mission-goal-presets",
			);
			expect(presetsRes.status).toBe(200);
			await expect(presetsRes.json()).resolves.toMatchObject([
				{ id: "coverage-budget", title: "カバレッジ維持" },
				{ id: "performance-budget", title: "パフォーマンス維持" },
				{ id: "design-token-coverage", title: "Design Token準拠" },
				{ id: "i18n-dictionary-parity", title: "i18n辞書同期" },
			]);

			const createGoalRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-goals`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						title: "Coverage",
						goalText: "Coverage を維持する。",
						active: true,
					}),
				},
			);
			expect(createGoalRes.status).toBe(201);
			const goal = (await createGoalRes.json()) as { id: string };

			const patchRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-goals/${goal.id}`,
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ active: false }),
				},
			);
			expect(patchRes.status).toBe(200);
			expect((await patchRes.json()).active).toBe(false);

			const deleteRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-goals/${goal.id}`,
				{ method: "DELETE", headers: { Origin: "http://localhost:39174" } },
			);
			expect(deleteRes.status).toBe(200);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("returns project-scoped LLM usage from the canonical Overview API", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-usage-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({ scripts: { test: "echo unit" } }),
				"utf8",
			);
			const project = await createRepository(repoRoot);
			const task = await nightworkersRepo.createTask({
				repositoryId: project.id,
				title: "TEST: Token-heavy BBS implementation",
				status: "completed",
			});

			await upsertPricingRow({
				provider: "fixture-provider",
				model: "gpt-test",
				inputPer1m: 10,
				cachedInputPer1m: 1,
				outputPer1m: 20,
				effectiveFrom: "1970-01-01T00:00:00.000Z",
				fetchedAt: new Date().toISOString(),
				manualOverride: false,
				enabled: true,
			});

			await recordLlmUsage({
				taskId: task.id,
				runId: null,
				callId: crypto.randomUUID(),
				provider: "fixture-provider",
				model: "gpt-test",
				label: "codex-runtime",
				usage: {
					inputTokens: 1200,
					outputTokens: 45,
					cachedInputTokens: 300,
					reasoningOutputTokens: 6,
					totalTokens: 1245,
					mode: "measured",
					rawUsage: { input_tokens: 1200, output_tokens: 45 },
				},
				promptPartTokenEstimates: {
					systemPromptTokens: 100,
					userPromptTokens: 200,
					stateCardTokens: 30,
				},
				durationMs: 1000,
			});
			const overviewRes = await app.request(
				`http://localhost/api/overview?range=all&repositoryId=${project.id}&currency=USD`,
			);

			expect(overviewRes.status).toBe(200);
			const overview = await overviewRes.json();
			expect(overview).toMatchObject({
				usage: {
					totalTokens: 1245,
					promptInputTokens: 330,
					inputTokens: 1200,
					outputTokens: 45,
					cachedInputTokens: 300,
					reasoningOutputTokens: 6,
					stateCardTokens: 30,
					outputTokensPerSecond: 45,
					callCount: 1,
				},
				cost: { estimatedTotal: expect.any(Number) },
				modelBreakdown: [
					expect.objectContaining({
						provider: "fixture-provider",
						model: "gpt-test",
						callCount: 1,
						inputTokens: 1200,
						outputTokens: 45,
						cachedInputTokens: 300,
						reasoningOutputTokens: 6,
						outputTokensPerSecond: 45,
						estimatedCost: expect.any(Number),
					}),
				],
			});
			expect(overview.cost.estimatedTotal).toBeCloseTo(0.0102);
			expect(overview.modelBreakdown[0].estimatedCost).toBeCloseTo(0.0102);
			expect(overview.recentExpensiveCalls[0].estimatedCost).toBeCloseTo(
				0.0102,
			);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("returns detected project tech stack profile", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-stack-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					packageManager: "bun@1.3.14",
					scripts: { test: "vitest", build: "vite build" },
					dependencies: {
						hono: "4.12.21",
						react: "19.2.4",
						"react-i18next": "17.0.8",
					},
					devDependencies: {
						tailwindcss: "4.0.0",
						typescript: "6.0.2",
						vite: "6.4.2",
					},
				}),
				"utf8",
			);
			fs.writeFileSync(
				path.join(repoRoot, "components.json"),
				'{"style":"radix-nova"}',
				"utf8",
			);
			const project = await createRepository(repoRoot);

			const metricsRes = await app.request(
				`http://localhost/api/repositories/${project.id}/project-detail/metrics`,
			);

			expect(metricsRes.status).toBe(200);
			await expect(metricsRes.json()).resolves.toMatchObject({
				stackProfile: {
					summary: "TypeScript + React + Vite + Hono",
					manifestStatus: "found",
					packageManager: "bun@1.3.14",
					technologies: expect.arrayContaining([
						expect.objectContaining({
							name: "TypeScript",
							packageName: "typescript",
						}),
						expect.objectContaining({ name: "React", packageName: "react" }),
						expect.objectContaining({ name: "Vite", packageName: "vite" }),
						expect.objectContaining({ name: "Hono", packageName: "hono" }),
						expect.objectContaining({
							name: "i18next",
							packageName: "react-i18next",
						}),
						expect.objectContaining({
							name: "Tailwind CSS",
							packageName: "tailwindcss",
						}),
						expect.objectContaining({ name: "shadcn/ui", source: "file" }),
					]),
				},
			});
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("returns project meta and refreshes it when git HEAD changes", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-meta-"),
		);
		try {
			fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
			fs.mkdirSync(path.join(repoRoot, "tests"), { recursive: true });
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({ scripts: { test: "vitest" } }),
				"utf8",
			);
			fs.writeFileSync(
				path.join(repoRoot, "src", "app.ts"),
				"export const answer = 42;\n",
				"utf8",
			);
			fs.writeFileSync(
				path.join(repoRoot, "tests", "app.test.ts"),
				"import { answer } from '../src/app';\nvoid answer;\n",
				"utf8",
			);
			git(repoRoot, ["init", "-b", "main"]);
			git(repoRoot, ["config", "user.email", "test@example.com"]);
			git(repoRoot, ["config", "user.name", "Test User"]);
			git(repoRoot, ["add", "."]);
			git(repoRoot, ["commit", "-m", "initial"]);
			const initialHead = git(repoRoot, ["rev-parse", "HEAD"]).trim();
			const project = await createRepository(repoRoot);

			const firstRes = await app.request(
				`http://localhost/api/repositories/${project.id}/project-detail/metrics`,
			);
			expect(firstRes.status).toBe(200);
			const firstMetrics = await firstRes.json();
			expect(firstMetrics.projectMeta).toMatchObject({
				git: {
					head: initialHead,
					displayHead: `${initialHead.slice(0, 10)}...`,
					status: "available",
				},
				files: {
					total: 3,
					source: 2,
					tests: 1,
				},
				fileScale: {
					value: "tiny",
				},
			});

			fs.writeFileSync(
				path.join(repoRoot, "src", "feature.ts"),
				"export const feature = true;\n",
				"utf8",
			);
			git(repoRoot, ["add", "."]);
			git(repoRoot, ["commit", "-m", "feature"]);
			const nextHead = git(repoRoot, ["rev-parse", "HEAD"]).trim();

			const secondRes = await app.request(
				`http://localhost/api/repositories/${project.id}/project-detail/metrics`,
			);
			expect(secondRes.status).toBe(200);
			const secondMetrics = await secondRes.json();
			expect(secondMetrics.projectMeta.git.head).toBe(nextHead);
			expect(secondMetrics.projectMeta.git.head).not.toBe(initialHead);
			expect(secondMetrics.projectMeta.files.source).toBe(3);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("generates mission candidates and creates draft tasks", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-generate-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({ scripts: { test: "echo unit" } }),
				"utf8",
			);
			const project = await createRepository(repoRoot);
			const createGoalRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-goals`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						title: "Quality",
						goalText: "Quality capability を整備する。",
						active: true,
					}),
				},
			);
			expect(createGoalRes.status).toBe(201);

			const generateRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-task-candidates/generate`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			expect(generateRes.status).toBe(201);
			const generated = (await generateRes.json()) as {
				candidates: Array<{ id: string }>;
			};
			expect(generated.candidates).toHaveLength(1);

			const createRequest = () =>
				app.request(
					`http://localhost/api/repositories/${project.id}/mission-task-candidates/create-tasks`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							candidateIds: [generated.candidates[0].id],
							mode: "draft",
						}),
					},
				);
			const createResponses = await Promise.all([
				createRequest(),
				createRequest(),
			]);
			expect(createResponses.map((response) => response.status).sort()).toEqual(
				[201, 400],
			);
			const createTasksRes = createResponses.find(
				(response) => response.status === 201,
			);
			expect(createTasksRes).toBeDefined();
			if (!createTasksRes) throw new Error("Expected one successful response");
			expect(createTasksRes.status).toBe(201);
			const created = await createTasksRes.json();
			expect(created.tasks[0]).toMatchObject({
				status: "draft",
				createdBy: "mission-task-candidate",
			});
			expect(created.tasks[0].objective).toContain(
				"package.json に coverage と E2E scripts を追加してください。",
			);
			expect(created.tasks[0].objective).toContain("[作るもの]");
			expect(created.tasks[0].objective).toContain(
				"package.json に coverage と E2E scripts を追加する。",
			);
			expect(created.tasks[0].objective).toContain("[Planで確認すること]");
			expect(created.tasks[0].objective).toContain("- 入口画面または route");
			expect(created.tasks[0].objective).toContain("- データモデル");
			expect(created.tasks[0].objective).toContain("- 保存方式");
			expect(created.tasks[0].objective).toContain("- 完了状態の表現");
			expect(created.tasks[0].objective).toContain(
				"- 編集、削除、並び替えの初期範囲",
			);
			expect(created.tasks[0].objective).toContain(
				"- unit / schema / e2e の検証範囲",
			);
			expect(created.tasks[0].objective).toContain("[実装上の注意]");
			expect(created.tasks[0].objective).toContain("未確認の仕様は固定せず");
			expect(created.tasks[0].objective).toContain("[完了条件]");
			expect(created.tasks[0].objective).toContain(
				"Quality capability が runnable として検出される。",
			);
			expect(created.tasks[0].objective).toContain("[検証]");
			expect(created.tasks[0].objective).toContain(
				"GET /quality で missingCapabilities が解消されることを確認する。",
			);
			expect(created.tasks[0].objective).not.toContain("Implementation Queue");
			expect(created.tasks[0].objective).not.toContain("Plan 完了後");
			expect(created.tasks[0].objective).not.toContain(
				"Plan Mode は、その主目的を実装する前に",
			);
			expect(created.tasks[0].objective).not.toContain("[注意]");
			expect(created.tasks[0].objective).not.toContain("[Planで決めること]");
			expect(created.tasks[0].objective).not.toContain("[候補の元指示]");
			expect(created.tasks[0].objective).not.toContain(
				"[事前に分かっている仕様]",
			);
			expect(created.tasks[0].objective).not.toContain("TaskCandidate id:");
			expect(created.tasks[0].objective).not.toContain("Candidate kind:");
			expect(created.tasks[0].objective).not.toContain(
				"Expected evaluation contribution:",
			);
			expect(created.tasks[0].objective).not.toContain(
				"このタスクでは、まず実装計画を作成してください。",
			);
			expect(created.candidates[0]).toMatchObject({
				status: "task_created",
				taskId: created.tasks[0].id,
			});
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("skips mission candidates that duplicate existing uncreated candidates", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-dedupe-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({ scripts: { test: "echo unit" } }),
				"utf8",
			);
			const project = await createRepository(repoRoot);
			const createGoalRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-goals`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						title: "Quality",
						goalText: "Quality capability を整備する。",
						active: true,
					}),
				},
			);
			expect(createGoalRes.status).toBe(201);

			const firstGenerateRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-task-candidates/generate`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			expect(firstGenerateRes.status).toBe(201);
			const firstGenerated = (await firstGenerateRes.json()) as {
				candidates: Array<{ id: string; title: string }>;
			};
			expect(firstGenerated.candidates).toHaveLength(1);

			const secondGenerateRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-task-candidates/generate`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			expect(secondGenerateRes.status).toBe(201);
			const secondGenerated = (await secondGenerateRes.json()) as {
				candidates: Array<{ id: string; title: string }>;
			};
			expect(secondGenerated.candidates).toHaveLength(0);

			const candidatesRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-task-candidates`,
			);
			expect(await candidatesRes.json()).toHaveLength(1);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("removes dismissed mission task candidates from the default draft list", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-dismiss-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({ scripts: { test: "echo unit" } }),
				"utf8",
			);
			const project = await createRepository(repoRoot);
			const createGoalRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-goals`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						title: "Quality",
						goalText: "Quality capability を整備する。",
						active: true,
					}),
				},
			);
			expect(createGoalRes.status).toBe(201);

			const generateRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-task-candidates/generate`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			expect(generateRes.status).toBe(201);
			const generated = (await generateRes.json()) as {
				candidates: Array<{ id: string }>;
			};
			const candidateId = generated.candidates[0].id;

			const dismissRes = await app.request(
				`http://localhost/api/mission-task-candidates/${candidateId}`,
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ status: "dismissed" }),
				},
			);
			expect(dismissRes.status).toBe(200);
			expect((await dismissRes.json()).status).toBe("dismissed");

			const defaultListRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-task-candidates?status=candidate`,
			);
			expect(await defaultListRes.json()).toEqual([]);

			const dismissedListRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-task-candidates?status=dismissed`,
			);
			expect(await dismissedListRes.json()).toMatchObject([
				{ id: candidateId, status: "dismissed" },
			]);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("skips mission candidates that duplicate existing task titles", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-detail-task-dedupe-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({ scripts: { test: "echo unit" } }),
				"utf8",
			);
			const project = await createRepository(repoRoot);
			await nightworkersRepo.createTask({
				repositoryId: project.id,
				title: "package.json に coverage と E2E scripts を追加する",
				status: "draft",
			});
			const createGoalRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-goals`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						title: "Quality",
						goalText: "Quality capability を整備する。",
						active: true,
					}),
				},
			);
			expect(createGoalRes.status).toBe(201);

			const generateRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-task-candidates/generate`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			expect(generateRes.status).toBe(201);
			const generated = (await generateRes.json()) as {
				candidates: Array<{ id: string; title: string }>;
			};
			expect(generated.candidates).toHaveLength(0);

			const candidatesRes = await app.request(
				`http://localhost/api/repositories/${project.id}/mission-task-candidates`,
			);
			expect(await candidatesRes.json()).toHaveLength(0);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});
});
