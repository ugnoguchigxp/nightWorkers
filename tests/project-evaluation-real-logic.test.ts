import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "@hono/zod-openapi";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import { buildProjectEvaluationBundle } from "../api/modules/project-evaluation/project-evaluation-bundle.service";
import {
	llmSettingsSchema,
	normalizeRawLlmSettings,
	normalizeRoleRoutes,
} from "../api/modules/settings";
import { LLM_ROLE_ORDER, llmRoleSchema } from "../api/routes/settings-runtime";
import {
	defaultProjectEvaluationDimensions,
	projectEvaluationDimensionLabels,
	projectEvaluationReportSchema,
	projectImprovementIdeasResultSchema,
} from "../shared/schemas/project-evaluation.schema";

function fixtureEvaluationDimensions() {
	return defaultProjectEvaluationDimensions.map((key, index) => ({
		key,
		label: projectEvaluationDimensionLabels[key],
		score: 70 - index,
		confidence: 0.72,
		rationale:
			key === "operability"
				? "運用性は設定、確認手順、信頼性、回復性をまとめて評価している。"
				: key === "extensibility"
					? "拡張性は将来の provider、runtime、workflow、tool 追加に耐えるかを独立軸として評価している。"
					: `${projectEvaluationDimensionLabels[key]} を固定軸として評価している。`,
		evidence: ["README.md", "package.json"],
		concerns: ["runtime verification は未実施"],
	}));
}

vi.mock("../api/services/structured-llm", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../api/services/structured-llm")>();
	const { createStructuredLlmResultMock } = await import(
		"./helpers/structured-llm-result-mock"
	);
	const callStructuredJsonLLM = vi.fn(
		async (_systemPrompt, _userPrompt, options) => {
			await options.emitEvent?.({
				type: "model.request_started",
				severity: "info",
				message: "fixture request started",
				data: {
					provider: "fixture",
					providerEndpointId: "fixture-evaluation",
					routeSource: "primary",
					model: "fixture-eval-model",
					thinkingDepth: "high",
				},
			});
			await options.emitEvent?.({
				type: "model.response_delta",
				severity: "debug",
				message: "fixture response delta",
				data: {
					provider: "fixture",
					round: null,
					text: '{"schemaVersion"',
				},
			});
			await new Promise((resolve) => setTimeout(resolve, 25));
			if (options.schemaName === "project_improvement_ideas") {
				return JSON.stringify({
					schemaVersion: "nightworkers.project-improvement-ideas/v1",
					ideas: [
						{
							title: "評価履歴を実データで表示する",
							summary:
								"保存済み評価と履歴を UI に接続し、Project owner が前回との差分を判断できる状態にする。",
							agentPrompt:
								"Project Evaluation の保存済み評価、選択軸、改善案を読み取り、UI と API の実データ接続を実装してください。",
							expectedOutcome:
								"評価履歴、選択軸、改善案、Task 化結果が mock なしで表示される。",
							implementationFocus: ["API response を UI controller に接続する"],
							targetDimensions: ["architectureQuality"],
							scoreImpacts: [
								{
									dimensionKey: "architectureQuality",
									currentScore: 70,
									expectedScoreGain: 8,
									expectedScoreAfter: 78,
									rationale:
										"mock を除去して実データで評価 loop を閉じるため。",
								},
							],
						},
					],
				});
			}
			return JSON.stringify({
				schemaVersion: "nightworkers.project-evaluation-report/v1",
				overallScore: 70,
				confidence: 0.71,
				summary: "repository bundle と保存済み証跡に基づく評価です。",
				dimensions: fixtureEvaluationDimensions(),
				strengths: ["local-first DB に保存できる"],
				weaknesses: ["source sampling は初期範囲外"],
				nextEvidenceToCollect: ["bun run verify の結果"],
			});
		},
	);
	return {
		...actual,
		callStructuredJsonLLM,
		callStructuredLlmResult: vi.fn(
			createStructuredLlmResultMock(callStructuredJsonLLM),
		),
	};
});

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("project evaluation real logic", () => {
	it("adds evaluation as a structured LLM role", () => {
		expect(llmRoleSchema.parse("evaluation")).toBe("evaluation");
		expect(LLM_ROLE_ORDER).toEqual([
			"plan",
			"evaluation",
			"implementation",
			"test",
			"review",
			"mission_pilot",
			"mission_task_generation",
		]);
	});

	it("migrates legacy quality and completion routes without losing targets", () => {
		const endpoints = ["primary", "quality", "completion"].map((id) => ({
			id,
			name: id,
			kind: "openai" as const,
			enabled: true,
			apiKey: "",
			baseUrl: "",
			endpoint: "",
			apiVersion: "",
			region: "",
			models: [`${id}-model`],
			modelDisplayNames: {},
		}));
		const target = (id: string) => ({
			providerEndpointId: id,
			model: `${id}-model`,
			thinkingDepth: "" as const,
		});
		const routes = normalizeRoleRoutes(
			[
				{ role: "test", primary: target("primary"), fallbacks: [] },
				{ role: "quality_gate", primary: target("quality"), fallbacks: [] },
				{
					role: "completion",
					primary: target("completion"),
					fallbacks: [],
				},
			],
			endpoints,
			"openai",
		);

		expect(routes.find((route) => route.role === "test")).toMatchObject({
			primary: target("primary"),
			fallbacks: [target("quality")],
		});
		expect(routes.find((route) => route.role === "review")).toMatchObject({
			primary: target("completion"),
		});
		expect(routes.map((route) => route.role)).not.toContain("quality_gate");
		expect(routes.map((route) => route.role)).not.toContain("completion");
	});

	it("promotes a valid legacy target when the canonical route is invalid", () => {
		const endpoints = [
			{
				id: "quality",
				name: "quality",
				kind: "openai" as const,
				enabled: true,
				apiKey: "",
				baseUrl: "",
				endpoint: "",
				apiVersion: "",
				region: "",
				models: ["quality-model"],
				modelDisplayNames: {},
			},
		];
		const routes = normalizeRoleRoutes(
			[
				{
					role: "test",
					primary: {
						providerEndpointId: "missing",
						model: "missing-model",
					},
					fallbacks: [],
				},
				{
					role: "quality_gate",
					primary: {
						providerEndpointId: "quality",
						model: "quality-model",
					},
					fallbacks: [],
				},
			],
			endpoints,
			"openai",
		);

		expect(
			routes.find((route) => route.role === "test")?.primary,
		).toMatchObject({
			providerEndpointId: "quality",
			model: "quality-model",
		});
	});

	it("promotes an enabled endpoint while the configured endpoint is disabled", () => {
		const endpoints = [
			{
				id: "openai-main",
				name: "OpenAI",
				kind: "openai" as const,
				enabled: true,
				apiKey: "",
				baseUrl: "",
				endpoint: "",
				apiVersion: "",
				region: "",
				models: ["gpt-5-mini"],
				modelDisplayNames: {},
			},
			{
				id: "codex-main",
				name: "Codex SDK",
				kind: "codex" as const,
				enabled: false,
				apiKey: "",
				baseUrl: "",
				endpoint: "",
				apiVersion: "",
				region: "",
				models: ["gpt-5.4-mini"],
				modelDisplayNames: {},
			},
		];
		const routes = normalizeRoleRoutes(
			[
				{
					role: "plan",
					primary: {
						providerEndpointId: "codex-main",
						model: "gpt-5.4-mini",
					},
					fallbacks: [],
				},
			],
			endpoints,
			"codex",
		);

		expect(routes.find((route) => route.role === "plan")?.primary).toEqual({
			providerEndpointId: "openai-main",
			model: "gpt-5-mini",
			thinkingDepth: "",
		});
		expect(() =>
			normalizeRawLlmSettings(
				llmSettingsSchema.parse({
					ACTIVE_LLM_PROVIDER: "codex",
					providerEndpoints: endpoints,
					roleRoutes: [
						{
							role: "plan",
							primary: {
								providerEndpointId: "codex-main",
								model: "gpt-5.4-mini",
							},
							fallbacks: [],
						},
					],
				}),
			),
		).toThrow("Invalid Role Routing target");

		const normalized = normalizeRawLlmSettings(
			llmSettingsSchema.parse({
				ACTIVE_LLM_PROVIDER: "codex",
				CODEX_ENABLED: true,
				CODEX_MODEL: "gpt-5.4-mini",
				providerEndpoints: endpoints,
				roleRoutes: routes,
			}),
			{ validateExplicitRoleRoutes: false },
		);
		expect(
			normalized.roleRoutes.find((route) => route.role === "plan")?.primary,
		).toEqual({
			providerEndpointId: "openai-main",
			model: "gpt-5-mini",
			thinkingDepth: "",
		});
		expect(normalized.CODEX_ENABLED).toBe(false);
		expect(normalized.OPENAI_ENABLED).toBe(true);
	});

	it("parses evaluation and improvement structured outputs", () => {
		const reportJsonSchema = z.toJSONSchema(projectEvaluationReportSchema) as {
			properties?: {
				dimensions?: { items?: { properties?: Record<string, unknown> } };
			};
		};
		expect(
			reportJsonSchema.properties?.dimensions?.items?.properties,
		).not.toHaveProperty("evaluationId");
		expect(
			projectEvaluationReportSchema.parse({
				schemaVersion: "nightworkers.project-evaluation-report/v1",
				overallScore: 80,
				confidence: 0.8,
				summary: "実データ評価です。",
				dimensions: fixtureEvaluationDimensions(),
			}).overallScore,
		).toBe(80);
		expect(
			projectEvaluationReportSchema
				.parse({
					schemaVersion: "nightworkers.project-evaluation-report/v1",
					overallScore: 80,
					confidence: 0.8,
					summary: "実データ評価です。",
					dimensions: fixtureEvaluationDimensions(),
				})
				.dimensions.map((dimension) => dimension.key),
		).toEqual(defaultProjectEvaluationDimensions);
		expect(defaultProjectEvaluationDimensions).toEqual([
			"conceptValue",
			"architectureQuality",
			"extensibility",
			"uiUx",
			"operability",
			"security",
			"maintainability",
			"marketCompetitiveness",
		]);
		expect(() =>
			projectEvaluationReportSchema.parse({
				schemaVersion: "nightworkers.project-evaluation-report/v1",
				overallScore: 80,
				confidence: 0.8,
				summary: "欠落した評価です。",
				dimensions: fixtureEvaluationDimensions().slice(0, -1),
			}),
		).toThrow();
		expect(() =>
			projectEvaluationReportSchema.parse({
				schemaVersion: "nightworkers.project-evaluation-report/v1",
				overallScore: 80,
				confidence: 0.8,
				summary: "旧軸を含む評価です。",
				dimensions: fixtureEvaluationDimensions().map((dimension, index) =>
					index === 0
						? {
								...dimension,
								key: "implementationCompleteness",
								label: "実装完成度",
							}
						: dimension,
				),
			}),
		).toThrow();
		expect(
			projectImprovementIdeasResultSchema.parse({
				schemaVersion: "nightworkers.project-improvement-ideas/v1",
				ideas: [
					{
						title: "redaction を検証する",
						summary: "secret-like path を評価 bundle から除外する。",
						agentPrompt: "redaction test を追加する。",
						expectedOutcome: ".env が bundle に入らない。",
						implementationFocus: ["bundle builder"],
						targetDimensions: ["security"],
						scoreImpacts: [
							{
								dimensionKey: "security",
								currentScore: 72,
								expectedScoreGain: 5,
								expectedScoreAfter: 77,
								rationale:
									"secret-like path の除外検証により security 評価が改善するため。",
							},
						],
					},
				],
			}).ideas,
		).toHaveLength(1);
		expect(() =>
			projectImprovementIdeasResultSchema.parse({
				schemaVersion: "nightworkers.project-improvement-ideas/v1",
				ideas: [
					{
						title: "redaction を検証する",
						summary: "secret-like path を評価 bundle から除外する。",
						agentPrompt: "redaction test を追加する。",
						expectedOutcome: ".env が bundle に入らない。",
						implementationFocus: ["bundle builder"],
						targetDimensions: ["security"],
						scoreImpacts: [],
					},
				],
			}),
		).toThrow();
	});

	it("builds a bundle from the registered repository root without secret-like paths", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-eval-bundle-"),
		);
		fs.writeFileSync(path.join(repoRoot, "README.md"), "# Test Project\n");
		fs.writeFileSync(path.join(repoRoot, "AGENTS.md"), "project guidance\n");
		fs.writeFileSync(path.join(repoRoot, ".env"), "SECRET=value\n");
		fs.writeFileSync(
			path.join(repoRoot, "package.json"),
			JSON.stringify({ scripts: { verify: "bun test" } }),
		);
		fs.mkdirSync(path.join(repoRoot, "node_modules"));
		fs.writeFileSync(path.join(repoRoot, "node_modules", "leak.js"), "secret");
		try {
			const bundle = await buildProjectEvaluationBundle({
				repository: {
					id: crypto.randomUUID(),
					name: "Bundle Test",
					localPath: repoRoot,
					branch: "main",
					allowed: true,
					queueEnabled: false,
					maxConcurrentSessions: 1,
					safetyPolicy: null,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			});
			expect(bundle.inputs.readme).toContain("Test Project");
			expect(bundle.inputs.scripts.verify).toBe("bun test");
			expect(bundle.inputs.repoTree.join("\n")).not.toContain(".env");
			expect(bundle.inputs.repoTree.join("\n")).not.toContain("node_modules");
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("runs evaluation, generates improvements, and creates linked ready tasks through API", async () => {
		const { default: app } = await import("../api/app");
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-eval-api-"),
		);
		fs.writeFileSync(path.join(repoRoot, "README.md"), "# API Project\n");
		fs.writeFileSync(
			path.join(repoRoot, "package.json"),
			JSON.stringify({ scripts: { verify: "bun run verify" } }),
		);
		try {
			const createRepoRes = await app.request(
				"http://localhost/api/repositories",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						name: `TEST: Evaluation ${crypto.randomUUID()}`,
						localPath: repoRoot,
						branch: "main",
					}),
				},
			);
			expect(createRepoRes.status).toBe(201);
			const project = await createRepoRes.json();

			const startRes = await app.request(
				`http://localhost/api/repositories/${project.id}/evaluations/start`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			expect(startRes.status, await startRes.clone().text()).toBe(202);
			const started = await startRes.json();
			expect(started.detail.evaluation.status).toBe("running");

			let startedActivity = null;
			for (let attempt = 0; attempt < 10; attempt += 1) {
				const activityRes = await app.request(
					`http://localhost/api/project-evaluations/${started.evaluationId}/activity-events`,
				);
				expect(activityRes.status).toBe(200);
				startedActivity = await activityRes.json();
				if (
					startedActivity.events.some(
						(event) => event.message === "fixture request started",
					) &&
					startedActivity.status === "completed"
				) {
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			expect(startedActivity?.events.map((event) => event.message)).toContain(
				"fixture request started",
			);
			expect(startedActivity?.events.map((event) => event.message)).toContain(
				"fixture response delta",
			);
			expect(startedActivity?.status).toBe("completed");

			const evalRes = await app.request(
				`http://localhost/api/repositories/${project.id}/evaluations`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);
			expect(evalRes.status, await evalRes.clone().text()).toBe(201);
			const evaluationDetail = await evalRes.json();
			expect(evaluationDetail.evaluation.status).toBe("completed");
			expect(evaluationDetail.evaluation.overallScore).toBe(70);
			expect(
				evaluationDetail.evaluation.dimensions.map(
					(dimension) => dimension.key,
				),
			).toEqual(defaultProjectEvaluationDimensions);
			expect(evaluationDetail.evaluation.dimensions).toHaveLength(
				defaultProjectEvaluationDimensions.length,
			);
			expect(evaluationDetail.evaluation.selectedModel).toMatchObject({
				providerId: "fixture",
				providerEndpointId: "fixture-evaluation",
				modelOrDeployment: "fixture-eval-model",
				thinkingDepth: "high",
			});
			expect(
				evaluationDetail.activityEvents.map((event) => event.status),
			).toContain("running");
			expect(
				evaluationDetail.activityEvents.map((event) => event.message),
			).toContain("fixture request started");

			const improvementsRes = await app.request(
				`http://localhost/api/project-evaluations/${evaluationDetail.evaluation.id}/improvements`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ dimensionKeys: ["architectureQuality"] }),
				},
			);
			expect(improvementsRes.status, await improvementsRes.clone().text()).toBe(
				201,
			);
			const improvements = await improvementsRes.json();
			expect(improvements.ideas).toHaveLength(1);
			const detailAfterImprovementsRes = await app.request(
				`http://localhost/api/project-evaluations/${evaluationDetail.evaluation.id}`,
			);
			expect(detailAfterImprovementsRes.status).toBe(200);
			const detailAfterImprovements = await detailAfterImprovementsRes.json();
			expect(
				detailAfterImprovements.activityEvents.map((event) => event.message),
			).toContain("fixture request started");
			expect(detailAfterImprovements.activityEvents.at(-1).message).toBe(
				"1 件の改善案を保存しました。",
			);

			const tasksRes = await app.request(
				`http://localhost/api/project-evaluations/${evaluationDetail.evaluation.id}/tasks`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						ideaIds: [improvements.ideas[0].id],
						mode: "ready",
					}),
				},
			);
			expect(tasksRes.status, await tasksRes.clone().text()).toBe(201);
			const tasks = await tasksRes.json();
			expect(tasks.tasks[0]).toMatchObject({
				status: "ready",
				createdBy: "project-evaluation",
			});
			expect(tasks.taskLinks[0]).toMatchObject({
				evaluationId: evaluationDetail.evaluation.id,
				ideaId: improvements.ideas[0].id,
				taskId: tasks.tasks[0].id,
			});
			expect(tasks.tasks[0].objective).toContain(
				"まず実装計画を作成してください",
			);
			expect(tasks.tasks[0].objective).not.toContain(
				"初回の成果物は Implementation Plan",
			);
			expect(tasks.tasks[0].objective).not.toContain("計画には、変更範囲");
			expect(tasks.tasks[0].objective).toContain(
				improvements.ideas[0].agentPrompt,
			);
			const taskMessages = await nightworkersRepo.listTaskMessages(
				tasks.tasks[0].id,
			);
			expect(taskMessages).toEqual([]);

			const duplicateTasksRes = await app.request(
				`http://localhost/api/project-evaluations/${evaluationDetail.evaluation.id}/tasks`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						ideaIds: [improvements.ideas[0].id],
						mode: "ready",
					}),
				},
			);
			expect(duplicateTasksRes.status).toBe(400);
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});
});
