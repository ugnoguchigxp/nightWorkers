import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { runAgenticTestEvidenceReview } from "../api/modules/review/review-mode.test-evidence-agent";
import type { AcceptanceTestCoverageResult } from "../api/modules/review/review-mode.test-evidence-precheck";
import type { ProviderToolTurnResult } from "../api/services/structured-llm";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

const originalLlmSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
const originalActiveLlmProvider = process.env.ACTIVE_LLM_PROVIDER;

beforeEach(async () => {
	await writeLlmSettings({ ACTIVE_LLM_PROVIDER: "openai" });
});

afterEach(() => {
	restoreEnv("NIGHTWORKERS_LLM_SETTINGS_PATH", originalLlmSettingsPath);
	restoreEnv("ACTIVE_LLM_PROVIDER", originalActiveLlmProvider);
});

describe("runAgenticTestEvidenceReview", () => {
	it("degrades when provider-native tools are unsupported", async () => {
		const { task, repository } = await createRepoFixture();

		const result = await runAgenticTestEvidenceReview({
			taskId: task.id,
			repositoryId: repository.id,
			precheck: precheckFixture(task.id),
			providerTurn: async () => ({
				type: "unsupported",
				reason:
					"Provider does not support native tool turn runtime yet: bedrock",
			}),
		});

		expect(result).toMatchObject({
			ok: false,
			degradedReason:
				"Provider does not support native tool turn runtime yet: bedrock",
		});
	});

	it("uses a native-tool fallback route when review primary is codex", async () => {
		const { task, repository } = await createRepoFixture();
		await writeLlmSettings({
			ACTIVE_LLM_PROVIDER: "codex",
			providerEndpoints: [
				{
					id: "codex-review",
					name: "Codex Review",
					kind: "codex",
					enabled: true,
					models: ["gpt-5.4-mini"],
				},
				{
					id: "azure-review",
					name: "Azure Review",
					kind: "azure",
					enabled: true,
					apiKey: "test-azure-key",
					endpoint: "https://example.openai.azure.com/",
					apiVersion: "2025-04-01-preview",
					models: ["gpt-5-4-mini"],
				},
			],
			roleRoutes: [
				{
					role: "review",
					primary: {
						providerEndpointId: "codex-review",
						model: "gpt-5.4-mini",
					},
					fallbacks: [
						{
							providerEndpointId: "azure-review",
							model: "gpt-5-4-mini",
						},
					],
				},
			],
		});

		const result = await runAgenticTestEvidenceReview({
			taskId: task.id,
			repositoryId: repository.id,
			precheck: precheckFixture(task.id),
			providerTurn: async (input) => {
				expect(input.provider).toBe("azure");
				expect(input.options.normalizedRequest).toMatchObject({
					providerId: "azure-openai",
					providerEndpointId: "azure-review",
					routeSource: "fallback",
				});
				return supported({
					content: JSON.stringify(confirmedResult()),
					toolCalls: [],
				});
			},
		});

		expect(result.ok).toBe(true);
		expect(result.ok ? result.result.criteria[0] : null).toMatchObject({
			status: "confirmed",
			confidence: "high",
		});
	});

	it("degrades before provider execution when only codex routes are available", async () => {
		const { task, repository } = await createRepoFixture();
		await writeLlmSettings({
			ACTIVE_LLM_PROVIDER: "codex",
			providerEndpoints: [
				{
					id: "codex-review",
					name: "Codex Review",
					kind: "codex",
					enabled: true,
					models: ["gpt-5.4-mini"],
				},
			],
			roleRoutes: [
				{
					role: "review",
					primary: {
						providerEndpointId: "codex-review",
						model: "gpt-5.4-mini",
					},
					fallbacks: [],
				},
			],
		});

		const result = await runAgenticTestEvidenceReview({
			taskId: task.id,
			repositoryId: repository.id,
			precheck: precheckFixture(task.id),
			providerTurn: async () => {
				throw new Error("providerTurn should not be called");
			},
		});

		expect(result).toMatchObject({
			ok: false,
			degradedReason: expect.stringContaining(
				"No provider-native tool turn route is available",
			),
			providerDebug: {
				supported: false,
				candidateProviders: [
					{
						providerId: "codex",
						providerEndpointId: "codex-review",
					},
				],
			},
		});
	});

	it("returns final JSON after rejecting a disallowed command tool call", async () => {
		const { task, repository } = await createRepoFixture();
		let calls = 0;

		const result = await runAgenticTestEvidenceReview({
			taskId: task.id,
			repositoryId: repository.id,
			precheck: precheckFixture(task.id),
			providerTurn: async (input) => {
				calls += 1;
				if (calls === 1) {
					return supported({
						content: "",
						toolCalls: [
							{
								id: "call-1",
								name: "run_command",
								arguments: { command: "bun run verify:fast" },
							},
						],
					});
				}
				expect(input.messages.at(-1)).toMatchObject({
					role: "tool",
					content: expect.stringContaining(
						"run_command only allows rg or bun run test run <single test file>",
					),
				});
				return supported({
					content: JSON.stringify({
						version: 1,
						summary: "Could not use broad verification.",
						criteria: [
							{
								criterion: "ルート A が保存される",
								status: "unclear",
								confidence: "low",
								evidence: [
									{ kind: "reasoning", note: "Broad command was rejected." },
								],
							},
						],
						commandsRun: [],
					}),
					toolCalls: [],
				});
			},
		});

		expect(result.ok).toBe(true);
		expect(result.ok ? result.result.criteria[0].status : null).toBe("unclear");
	});

	it("rejects command tool calls with shell control characters", async () => {
		const { task, repository } = await createRepoFixture();
		let calls = 0;

		const result = await runAgenticTestEvidenceReview({
			taskId: task.id,
			repositoryId: repository.id,
			precheck: precheckFixture(task.id),
			providerTurn: async (input) => {
				calls += 1;
				if (calls === 1) {
					return supported({
						content: "",
						toolCalls: [
							{
								id: "call-1",
								name: "run_command",
								arguments: { command: "rg routes tests\nbun run verify:fast" },
							},
						],
					});
				}
				expect(input.messages.at(-1)).toMatchObject({
					role: "tool",
					content: expect.stringContaining(
						"run_command does not allow shell control characters.",
					),
				});
				return supported({
					content: JSON.stringify({
						version: 1,
						summary: "Rejected unsafe command.",
						criteria: [
							{
								criterion: "ルート A が保存される",
								status: "unclear",
								confidence: "low",
								evidence: [
									{ kind: "reasoning", note: "Unsafe command was rejected." },
								],
							},
						],
						commandsRun: [],
					}),
					toolCalls: [],
				});
			},
		});

		expect(result.ok).toBe(true);
		expect(result.ok ? result.result.criteria[0].status : null).toBe("unclear");
	});

	it("downgrades confirmed results that do not include tool evidence", async () => {
		const { task, repository } = await createRepoFixture();

		const result = await runAgenticTestEvidenceReview({
			taskId: task.id,
			repositoryId: repository.id,
			precheck: precheckFixture(task.id),
			providerTurn: async () =>
				supported({
					content: JSON.stringify({
						version: 1,
						summary: "Confirmed without evidence.",
						criteria: [
							{
								criterion: "ルート A が保存される",
								status: "confirmed",
								confidence: "high",
								evidence: [{ kind: "reasoning", note: "It appears covered." }],
							},
						],
						commandsRun: [],
					}),
					toolCalls: [],
				}),
		});

		expect(result.ok).toBe(true);
		expect(result.ok ? result.result.criteria[0] : null).toMatchObject({
			status: "unclear",
			confidence: "low",
		});
	});

	it("marks omitted acceptance criteria unclear instead of dropping them", async () => {
		const { task, repository } = await createRepoFixture();
		const precheck = precheckFixture(task.id);
		precheck.criteria.push("月次レポート CSV を送信できる");

		const result = await runAgenticTestEvidenceReview({
			taskId: task.id,
			repositoryId: repository.id,
			precheck,
			providerTurn: async () =>
				supported({
					content: JSON.stringify({
						version: 1,
						summary: "Only one criterion returned.",
						criteria: [
							{
								criterion: "ルート A が保存される",
								status: "confirmed",
								confidence: "high",
								evidence: [
									{
										kind: "test_name",
										filePath: "tests/routes.test.ts",
										testName: "ルート A が保存される",
										note: "Matched by test name.",
									},
								],
							},
						],
						commandsRun: [],
					}),
					toolCalls: [],
				}),
		});

		expect(result.ok).toBe(true);
		expect(result.ok ? result.result.criteria : []).toHaveLength(2);
		expect(result.ok ? result.result.criteria[1] : null).toMatchObject({
			criterion: "月次レポート CSV を送信できる",
			status: "unclear",
			confidence: "low",
		});
	});
});

async function createRepoFixture() {
	const repoDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-test-evidence-"),
	);
	await fs.mkdir(path.join(repoDir, "tests"), { recursive: true });
	await fs.writeFile(
		path.join(repoDir, "tests/routes.test.ts"),
		'import { describe, it } from "vitest";\ndescribe("routes", () => {\n  it("ルート A が保存される", () => {});\n});\n',
		"utf-8",
	);
	const repository = await repo.createRepository({
		name: `TEST: Agentic Evidence ${crypto.randomUUID()}`,
		localPath: repoDir,
		branch: "main",
	});
	const task = await repo.createTask({
		repositoryId: repository.id,
		title: "Agentic evidence task",
		objective: "Check test evidence",
		acceptanceCriteria: "ルート A が保存される",
		status: "completed",
	});
	return { repository, task };
}

function precheckFixture(taskId: string): AcceptanceTestCoverageResult {
	return {
		version: 1,
		taskId,
		repositoryPath: null,
		planFound: true,
		planMessageId: "plan-message-1",
		planTitle: "Feature Plan",
		criteria: ["ルート A が保存される"],
		testFilesScanned: 1,
		testNamesScanned: 1,
		matches: [
			{
				criterion: "ルート A が保存される",
				matched: true,
				bestScore: 1,
				testNames: ["ルート A が保存される"],
				candidates: [
					{
						testName: "ルート A が保存される",
						filePath: "tests/routes.test.ts",
						lineNumber: 3,
						score: 1,
					},
				],
			},
		],
	};
}

function confirmedResult() {
	return {
		version: 1,
		summary: "Found focused test evidence.",
		criteria: [
			{
				criterion: "ルート A が保存される",
				status: "confirmed",
				confidence: "high",
				evidence: [
					{
						kind: "test_name",
						filePath: "tests/routes.test.ts",
						testName: "ルート A が保存される",
						note: "Matched by test name.",
					},
				],
			},
		],
		commandsRun: [],
	};
}

async function writeLlmSettings(settings: Record<string, unknown>) {
	const settingsDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-llm-settings-"),
	);
	const settingsPath = path.join(settingsDir, "llm-settings.json");
	await fs.writeFile(settingsPath, JSON.stringify(settings), "utf-8");
	process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = settingsPath;
	delete process.env.ACTIVE_LLM_PROVIDER;
}

function restoreEnv(key: string, value: string | undefined) {
	if (value === undefined) {
		delete process.env[key];
		return;
	}
	process.env[key] = value;
}

function supported(input: {
	content: string;
	toolCalls: Extract<
		ProviderToolTurnResult,
		{ type: "supported" }
	>["toolCalls"];
}): Extract<ProviderToolTurnResult, { type: "supported" }> {
	return {
		type: "supported",
		content: input.content,
		toolCalls: input.toolCalls,
		usage: {
			inputTokens: 1,
			outputTokens: 1,
			totalTokens: 2,
			mode: "estimated",
		},
	};
}
