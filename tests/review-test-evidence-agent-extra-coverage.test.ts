import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
	candidates: [] as Array<Record<string, unknown>>,
	getRepository: vi.fn(),
	buildCandidates: vi.fn(),
	callProviderToolTurn: vi.fn(),
	providerAdapterKey: vi.fn((providerId: string) => {
		if (providerId === "azure-openai") return "azure";
		return providerId;
	}),
	executeWorkerTool: vi.fn(),
	prompt: vi.fn(() => "system prompt"),
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getRepository: dependencies.getRepository,
}));

vi.mock("../api/services/structured-llm", () => ({
	buildNormalizedSupervisorLlmRequestCandidates: dependencies.buildCandidates,
	callProviderToolTurn: dependencies.callProviderToolTurn,
	providerAdapterKey: dependencies.providerAdapterKey,
}));

vi.mock("../api/services/worker-tools/dispatcher", () => ({
	executeWorkerTool: dependencies.executeWorkerTool,
}));

vi.mock("../api/systemContexts/catalog", () => ({ p: dependencies.prompt }));

import { runAgenticTestEvidenceReview } from "../api/modules/review/review-mode.test-evidence-agent";

const precheck = {
	version: 1 as const,
	taskId: "task-1",
	repositoryPath: "/repo",
	planFound: true,
	planMessageId: "plan-1",
	planTitle: "Feature Plan",
	criteria: ["criterion A"],
	testFilesScanned: 2,
	testNamesScanned: 3,
	matches: [],
};

function candidate(
	providerId = "openai",
	overrides: Record<string, unknown> = {},
) {
	return {
		providerId,
		providerEndpointId: `${providerId}-endpoint`,
		routeSource: "primary",
		model: "test-model",
		...overrides,
	};
}

function supported(
	content: string,
	toolCalls: Array<{
		id: string;
		name: string;
		arguments: Record<string, unknown>;
	}> = [],
	providerDebug?: Record<string, unknown>,
) {
	return {
		type: "supported" as const,
		content,
		toolCalls,
		usage: {
			inputTokens: 1,
			outputTokens: 1,
			totalTokens: 2,
			mode: "estimated" as const,
		},
		providerDebug,
	};
}

function finalResult(overrides: Record<string, unknown> = {}) {
	return {
		version: 1,
		summary: "reviewed",
		criteria: [
			{
				criterion: "criterion A",
				status: "confirmed",
				confidence: "high",
				evidence: [
					{
						kind: "test_name",
						filePath: "tests/a.test.ts",
						testName: "criterion A",
						note: "matched",
					},
				],
			},
		],
		commandsRun: [],
		...overrides,
	};
}

function toolResult(
	toolName: string,
	payload: Record<string, unknown> = {},
	overrides: Record<string, unknown> = {},
) {
	return {
		ok: true,
		toolName,
		startedAt: "2026-08-09T00:00:00.000Z",
		finishedAt: "2026-08-09T00:00:01.000Z",
		payload,
		...overrides,
	};
}

function runInput(overrides: Record<string, unknown> = {}) {
	return {
		taskId: "task-1",
		repositoryId: "repository-1",
		precheck,
		...overrides,
	} as never;
}

beforeEach(() => {
	dependencies.candidates = [candidate()];
	dependencies.getRepository.mockReset();
	dependencies.getRepository.mockResolvedValue({ localPath: "/repo" });
	dependencies.buildCandidates.mockReset();
	dependencies.buildCandidates.mockImplementation(
		() => dependencies.candidates,
	);
	dependencies.callProviderToolTurn.mockReset();
	dependencies.providerAdapterKey.mockClear();
	dependencies.executeWorkerTool.mockReset();
	dependencies.executeWorkerTool.mockImplementation(async (input) => ({
		result: toolResult(input.toolName, input.args),
		...(input.toolName === "read_file"
			? { readFilesChanged: [...input.readFiles, String(input.args.filePath)] }
			: {}),
	}));
	dependencies.prompt.mockClear();
});

describe("review test evidence agent extra coverage", () => {
	it("degrades when repository lookup has no configured path", async () => {
		dependencies.getRepository.mockResolvedValueOnce(null);
		await expect(runAgenticTestEvidenceReview(runInput())).resolves.toEqual({
			ok: false,
			degradedReason: "Repository path is not configured.",
			commandsRun: [],
		});

		dependencies.getRepository.mockResolvedValueOnce({ localPath: "" });
		await expect(
			runAgenticTestEvidenceReview(runInput()),
		).resolves.toMatchObject({
			ok: false,
			degradedReason: "Repository path is not configured.",
		});
		expect(dependencies.buildCandidates).not.toHaveBeenCalled();
	});

	it("describes empty and unsupported provider-native routes", async () => {
		dependencies.candidates = [];
		const none = await runAgenticTestEvidenceReview(runInput());
		expect(none).toMatchObject({
			ok: false,
			degradedReason: expect.stringContaining(
				"Current candidate providers: none.",
			),
			providerDebug: {
				mode: "provider_native_tools",
				supported: false,
				candidateProviders: [],
			},
		});

		dependencies.candidates = [
			candidate("codex", {
				providerEndpointId: undefined,
				routeSource: undefined,
			}),
			candidate("bedrock"),
		];
		const unsupported = await runAgenticTestEvidenceReview(runInput());
		expect(unsupported).toMatchObject({
			ok: false,
			degradedReason: expect.stringContaining(
				"Current candidate providers: codex, bedrock.",
			),
			providerDebug: {
				candidateProviders: [
					{
						providerId: "codex",
						providerEndpointId: null,
						routeSource: null,
					},
					expect.objectContaining({ providerId: "bedrock" }),
				],
			},
		});
	});

	it("selects an Azure fallback and passes prompts, tools, options, and debug state", async () => {
		dependencies.candidates = [candidate("codex"), candidate("azure-openai")];
		const providerTurn = vi.fn(async (input) => {
			expect(input.provider).toBe("azure");
			expect(input.systemPrompt).toBe("system prompt");
			expect(input.userPrompt).toContain("criterion A");
			expect(input.tools.map((tool: { name: string }) => tool.name)).toEqual([
				"search_files",
				"read_file",
				"run_command",
			]);
			expect(input.options).toMatchObject({
				label: "review_test_evidence",
				role: "review",
				taskId: "task-1",
				workingDirectory: path.resolve("/repo"),
				toolChoice: "auto",
				normalizedRequest: expect.objectContaining({
					providerId: "azure-openai",
				}),
			});
			input.setProviderDebug({ fromCallback: true });
			return supported(JSON.stringify(finalResult()));
		});

		const result = await runAgenticTestEvidenceReview(
			runInput({ providerTurn }),
		);
		expect(result).toMatchObject({
			ok: true,
			providerDebug: { fromCallback: true },
		});
		expect(dependencies.prompt).toHaveBeenCalledWith(
			"review.test-evidence",
			{},
		);
	});

	it("uses the default provider turn and lets returned debug replace callback debug", async () => {
		dependencies.callProviderToolTurn.mockImplementationOnce(async (input) => {
			input.setProviderDebug({ initial: true });
			return supported(JSON.stringify(finalResult()), [], { returned: true });
		});
		const result = await runAgenticTestEvidenceReview(runInput());
		expect(dependencies.callProviderToolTurn).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			ok: true,
			providerDebug: { returned: true },
		});
	});

	it("returns Error and non-Error provider failures with accumulated debug", async () => {
		const error = await runAgenticTestEvidenceReview(
			runInput({
				providerTurn: async (input: {
					setProviderDebug: (debug: Record<string, unknown>) => void;
				}) => {
					input.setProviderDebug({ requestId: "request-1" });
					throw new Error("provider exploded");
				},
			}),
		);
		expect(error).toMatchObject({
			ok: false,
			degradedReason:
				"Agentic test evidence provider failed: provider exploded",
			providerDebug: { requestId: "request-1" },
		});

		const raw = await runAgenticTestEvidenceReview(
			runInput({
				providerTurn: async () => {
					throw 503;
				},
			}),
		);
		expect(raw).toMatchObject({
			ok: false,
			degradedReason: "Agentic test evidence provider failed: 503",
		});
	});

	it("returns provider unsupported and invalid JSON/schema degradations", async () => {
		const unsupported = await runAgenticTestEvidenceReview(
			runInput({
				providerTurn: async () => ({
					type: "unsupported",
					reason: "native tools disabled",
					providerDebug: { disabled: true },
				}),
			}),
		);
		expect(unsupported).toMatchObject({
			ok: false,
			degradedReason: "native tools disabled",
			providerDebug: { disabled: true },
		});

		for (const content of ["not json", JSON.stringify({ version: 1 })]) {
			const invalid = await runAgenticTestEvidenceReview(
				runInput({ providerTurn: async () => supported(content) }),
			);
			expect(invalid).toMatchObject({
				ok: false,
				degradedReason: expect.stringContaining(
					"Agentic test evidence output was invalid:",
				),
			});
		}
	});

	it("executes normalized search, read, rg, and focused test tool calls", async () => {
		let turn = 0;
		const calls = [
			{
				id: "search-custom",
				name: "search_files",
				arguments: { query: " route ", glob: " tests/** ", maxResults: 99.9 },
			},
			{
				id: "search-default",
				name: "search_files",
				arguments: { query: "task", glob: " ", maxResults: Number.NaN },
			},
			{
				id: "read-relative",
				name: "read_file",
				arguments: {
					filePath: " tests/a.test.ts ",
					startLine: 5.8,
					endLine: 999,
				},
			},
			{
				id: "read-absolute",
				name: "read_file",
				arguments: {
					filePath: "/repo/tests/b.spec.ts",
					startLine: -5,
					endLine: -8,
				},
			},
			{
				id: "read-default-end",
				name: "read_file",
				arguments: { filePath: "tests/default.test.ts", startLine: 10 },
			},
			{
				id: "rg",
				name: "run_command",
				arguments: { command: " rg criterion tests " },
			},
			{
				id: "focused",
				name: "run_command",
				arguments: { command: "bun run test run tests/a.cases.tsx" },
			},
		];
		const providerTurn = vi.fn(async (input) => {
			turn += 1;
			if (turn === 1) return supported("checking", calls);
			expect(input.messages).toHaveLength(2 + 1 + calls.length);
			return supported(JSON.stringify(finalResult()));
		});

		const result = await runAgenticTestEvidenceReview(
			runInput({ providerTurn }),
		);
		expect(result.ok).toBe(true);
		expect(dependencies.executeWorkerTool).toHaveBeenCalledTimes(7);
		expect(dependencies.executeWorkerTool).toHaveBeenCalledWith(
			expect.objectContaining({
				toolName: "search_files",
				args: {
					query: "route",
					glob: " tests/** ",
					maxResults: 50,
				},
			}),
		);
		expect(dependencies.executeWorkerTool).toHaveBeenCalledWith(
			expect.objectContaining({
				toolName: "search_files",
				args: expect.objectContaining({ maxResults: 50 }),
			}),
		);
		expect(dependencies.executeWorkerTool).toHaveBeenCalledWith(
			expect.objectContaining({
				toolName: "read_file",
				args: expect.objectContaining({
					filePath: "tests/a.test.ts",
					startLine: 5,
					endLine: 124,
				}),
			}),
		);
		expect(dependencies.executeWorkerTool).toHaveBeenCalledWith(
			expect.objectContaining({
				toolName: "read_file",
				args: expect.objectContaining({
					filePath: "tests/b.spec.ts",
					startLine: 1,
					endLine: 1,
				}),
			}),
		);
	});

	it("blocks missing, escaping, non-test, unsafe, broad, and unknown tool calls", async () => {
		let turn = 0;
		const blocked = [
			{ id: "search", name: "search_files", arguments: {} },
			{ id: "read-missing", name: "read_file", arguments: {} },
			{
				id: "read-outside",
				name: "read_file",
				arguments: { filePath: "../outside.test.ts" },
			},
			{
				id: "read-source",
				name: "read_file",
				arguments: { filePath: "src/app.ts" },
			},
			{ id: "run-missing", name: "run_command", arguments: {} },
			{
				id: "run-unsafe",
				name: "run_command",
				arguments: { command: "rg test; echo bad" },
			},
			{
				id: "run-broad",
				name: "run_command",
				arguments: { command: "bun run verify" },
			},
			{ id: "unknown", name: "write_file", arguments: {} },
		];
		const providerTurn = vi.fn(async (input) => {
			turn += 1;
			if (turn === 1) return supported("checking", blocked);
			for (const message of input.messages.slice(-blocked.length)) {
				expect(message.content).toContain("INVALID_TOOL_ARGS");
			}
			return supported(JSON.stringify(finalResult()));
		});
		const result = await runAgenticTestEvidenceReview(
			runInput({ providerTurn }),
		);
		expect(result.ok).toBe(true);
		expect(dependencies.executeWorkerTool).not.toHaveBeenCalled();
	});

	it("blocks a focused test outside the repository", async () => {
		let turn = 0;
		const result = await runAgenticTestEvidenceReview(
			runInput({
				providerTurn: async (input) => {
					turn += 1;
					if (turn === 1) {
						return supported("checking", [
							{
								id: "outside",
								name: "run_command",
								arguments: {
									command: "bun run test run /tmp/outside.test.ts",
								},
							},
						]);
					}
					expect(input.messages.at(-1)?.content).toContain(
						"focused test command path must stay inside the repository",
					);
					return supported(JSON.stringify(finalResult()));
				},
			}),
		);
		expect(result.ok).toBe(true);
	});

	it("records successful commands, compresses results, and lets model summaries win", async () => {
		let invocation = 0;
		dependencies.executeWorkerTool.mockImplementation(async (_input) => {
			invocation += 1;
			if (invocation === 1) {
				return {
					result: toolResult("run_command", {
						command: "rg first",
						exitCode: 0,
						stdout: "x".repeat(7_000),
						stderr: "warning",
					}),
				};
			}
			return {
				result: toolResult(
					"run_command",
					{ command: 42, exitCode: "bad", stdout: 4, stderr: null },
					{ error: { code: "WARN", message: "fallback error" } },
				),
			};
		});
		let turn = 0;
		const providerTurn = vi.fn(async (input) => {
			turn += 1;
			if (turn === 1) {
				return supported("checking", [
					{
						id: "rg-1",
						name: "run_command",
						arguments: { command: "rg first" },
					},
					{
						id: "rg-2",
						name: "run_command",
						arguments: { command: "rg second" },
					},
				]);
			}
			expect(input.messages.at(-2)?.content.length).toBeLessThanOrEqual(6_000);
			return supported(
				JSON.stringify(
					finalResult({
						commandsRun: [
							{
								command: "rg first",
								exitCode: 9,
								summary: "model summary",
							},
						],
					}),
				),
			);
		});
		const result = await runAgenticTestEvidenceReview(
			runInput({ providerTurn }),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.result.commandsRun).toEqual([
			{ command: "rg first", exitCode: 9, summary: "model summary" },
			{ command: "run_command", exitCode: null, summary: "fallback error" },
		]);
	});

	it("normalizes missing criteria and reasoning-only confirmations", async () => {
		const expandedPrecheck = {
			...precheck,
			criteria: ["criterion A", "criterion B", "criterion C"],
		};
		const result = await runAgenticTestEvidenceReview(
			runInput({
				precheck: expandedPrecheck,
				providerTurn: async () =>
					supported(
						JSON.stringify(
							finalResult({
								criteria: [
									{
										criterion: "criterion A",
										status: "confirmed",
										confidence: "high",
										evidence: [{ kind: "reasoning", note: "reason only" }],
									},
									{
										criterion: "criterion B",
										status: "not_found",
										confidence: "medium",
										evidence: [{ kind: "reasoning", note: "none" }],
									},
								],
							}),
						),
					),
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.result.criteria).toMatchObject([
			{ criterion: "criterion A", status: "unclear", confidence: "low" },
			{ criterion: "criterion B", status: "not_found", confidence: "medium" },
			{ criterion: "criterion C", status: "unclear", confidence: "low" },
		]);
	});

	it("enforces tool-call and provider-turn limits", async () => {
		const tooManyCalls = Array.from({ length: 9 }, (_, index) => ({
			id: `call-${index}`,
			name: "search_files",
			arguments: {},
		}));
		const toolLimit = await runAgenticTestEvidenceReview(
			runInput({
				providerTurn: async () => supported("checking", tooManyCalls),
			}),
		);
		expect(toolLimit).toMatchObject({
			ok: false,
			degradedReason:
				"Agentic test evidence review exceeded the tool-call limit.",
		});

		const turnLimit = await runAgenticTestEvidenceReview(
			runInput({
				providerTurn: async () =>
					supported("checking", [
						{ id: "call", name: "search_files", arguments: {} },
					]),
			}),
		);
		expect(turnLimit).toMatchObject({
			ok: false,
			degradedReason:
				"Agentic test evidence review reached the turn limit before final JSON.",
		});
	});
});
