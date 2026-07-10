import path from "node:path";
import { unknownErrorMessage } from "../../../shared/json-record";
import {
	buildNormalizedSupervisorLlmRequestCandidates,
	callProviderToolTurn,
	type ProviderToolDefinition,
	type ProviderToolMessage,
	type ProviderToolTurnResult,
	providerAdapterKey,
} from "../../services/structured-llm";
import { parseRepairedJsonWithSchema } from "../../services/structured-llm/json";
import type { WorkerToolName } from "../../services/tool-policy/types";
import { executeWorkerTool } from "../../services/worker-tools/dispatcher";
import type { WorkerToolResult } from "../../services/worker-tools/types";
import * as repo from "../nightworkers/nightworkers.repository";
import {
	type TestEvidenceReviewResult,
	testEvidenceReviewResultSchema,
} from "./review-mode.test-evidence-agent.schema";
import type { AcceptanceTestCoverageResult } from "./review-mode.test-evidence-precheck";

const MAX_TURNS = 4;
const MAX_TOOL_CALLS = 8;
const MAX_TOOL_RESULT_CHARS = 6000;
const TEST_FILE_PATTERN =
	/(?:^|[/.])(?:[^/]*\.)?(?:test|spec|cases)\.[cm]?[jt]sx?$|(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$/;
const UNSAFE_SHELL_CHARS = /[\r\n;&|`$<>]/;
const FOCUSED_TEST_COMMAND_PATTERN =
	/^bun run test run (?<filePath>\S+\.(?:test|spec|cases)\.[cm]?[jt]sx?)$/;

type ToolTurnProvider = typeof callProviderToolTurn;

export type AgenticTestEvidenceReview =
	| {
			ok: true;
			result: TestEvidenceReviewResult;
			providerDebug?: Record<string, unknown>;
	  }
	| {
			ok: false;
			degradedReason: string;
			providerDebug?: Record<string, unknown>;
			commandsRun: TestEvidenceReviewResult["commandsRun"];
	  };

export async function runAgenticTestEvidenceReview(input: {
	taskId: string;
	repositoryId: string;
	precheck: AcceptanceTestCoverageResult;
	providerTurn?: ToolTurnProvider;
}): Promise<AgenticTestEvidenceReview> {
	const repository = await repo.getRepository(input.repositoryId);
	const repoRoot = repository?.localPath
		? path.resolve(repository.localPath)
		: null;
	if (!repoRoot) {
		return {
			ok: false,
			degradedReason: "Repository path is not configured.",
			commandsRun: [],
		};
	}

	const systemPrompt = buildSystemPrompt();
	const userPrompt = buildUserPrompt(input.precheck);
	const candidateRequests = buildNormalizedSupervisorLlmRequestCandidates({
		systemPrompt,
		userPrompt,
		label: "review_test_evidence",
		role: "review",
	});
	const normalizedRequest = selectNativeToolTurnRequest(candidateRequests);
	if (!normalizedRequest) {
		return {
			ok: false,
			degradedReason: buildNoNativeToolTurnRouteReason(candidateRequests),
			providerDebug: {
				mode: "provider_native_tools",
				supported: false,
				candidateProviders: candidateRequests.map((request) => ({
					providerId: request.providerId,
					providerEndpointId: request.providerEndpointId ?? null,
					routeSource: request.routeSource ?? null,
				})),
			},
			commandsRun: [],
		};
	}
	const providerTurn = input.providerTurn ?? callProviderToolTurn;
	const provider = providerAdapterKey(normalizedRequest.providerId);
	const messages: ProviderToolMessage[] = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: userPrompt },
	];
	const commandsRun: TestEvidenceReviewResult["commandsRun"] = [];
	let readFiles: string[] = [];
	let providerDebug: Record<string, unknown> | undefined;
	let toolCallCount = 0;

	for (let turn = 0; turn < MAX_TURNS; turn += 1) {
		let providerResult: ProviderToolTurnResult;
		try {
			providerResult = await providerTurn({
				provider,
				systemPrompt,
				userPrompt,
				messages,
				tools: TEST_EVIDENCE_TOOLS,
				options: {
					label: "review_test_evidence",
					role: "review",
					taskId: input.taskId,
					workingDirectory: repoRoot,
					timeoutMs: 120_000,
					attemptTimeoutMs: 120_000,
					normalizedRequest,
					toolChoice: "auto",
				},
				signal: AbortSignal.timeout(120_000),
				setProviderDebug: (value) => {
					providerDebug = value;
				},
			});
		} catch (err) {
			return {
				ok: false,
				degradedReason: `Agentic test evidence provider failed: ${unknownErrorMessage(err)}`,
				providerDebug,
				commandsRun,
			};
		}

		providerDebug = providerResult.providerDebug ?? providerDebug;
		if (providerResult.type === "unsupported") {
			return {
				ok: false,
				degradedReason: providerResult.reason,
				providerDebug,
				commandsRun,
			};
		}

		if (providerResult.toolCalls.length === 0) {
			const parsed = parseRepairedJsonWithSchema(
				providerResult.content,
				testEvidenceReviewResultSchema,
			);
			if (!parsed.ok) {
				return {
					ok: false,
					degradedReason: `Agentic test evidence output was invalid: ${unknownErrorMessage(parsed.error)}`,
					providerDebug,
					commandsRun,
				};
			}
			return {
				ok: true,
				result: normalizeAgenticReviewResult(
					{
						...parsed.value,
						commandsRun: mergeCommandsRun(
							parsed.value.commandsRun,
							commandsRun,
						),
					},
					input.precheck,
				),
				providerDebug,
			};
		}

		messages.push({
			role: "assistant",
			content: providerResult.content,
			toolCalls: providerResult.toolCalls,
		});

		for (const toolCall of providerResult.toolCalls) {
			toolCallCount += 1;
			if (toolCallCount > MAX_TOOL_CALLS) {
				return {
					ok: false,
					degradedReason:
						"Agentic test evidence review exceeded the tool-call limit.",
					providerDebug,
					commandsRun,
				};
			}
			const toolResult = await executeValidatedToolCall({
				toolName: toolCall.name,
				args: toolCall.arguments,
				repoRoot,
				readFiles,
			});
			if (toolResult.readFilesChanged) readFiles = toolResult.readFilesChanged;
			if (toolCall.name === "run_command" && toolResult.result.ok) {
				commandsRun.push(commandSummary(toolResult.result));
			}
			messages.push({
				role: "tool",
				toolCallId: toolCall.id,
				content: compressToolResult(toolResult.result),
			});
		}
	}

	return {
		ok: false,
		degradedReason:
			"Agentic test evidence review reached the turn limit before final JSON.",
		providerDebug,
		commandsRun,
	};
}

function selectNativeToolTurnRequest(
	requests: ReturnType<typeof buildNormalizedSupervisorLlmRequestCandidates>,
) {
	return requests.find((request) => supportsNativeToolTurn(request.providerId));
}

function supportsNativeToolTurn(providerId: string) {
	const provider = providerAdapterKey(providerId);
	return provider === "openai" || provider === "azure";
}

function buildNoNativeToolTurnRouteReason(
	requests: ReturnType<typeof buildNormalizedSupervisorLlmRequestCandidates>,
) {
	const providers = requests.map((request) => request.providerId);
	return [
		"No provider-native tool turn route is available for Review Mode test evidence.",
		"Configure the review role with an OpenAI or Azure OpenAI provider endpoint.",
		`Current candidate providers: ${providers.length ? providers.join(", ") : "none"}.`,
	].join(" ");
}

const TEST_EVIDENCE_TOOLS: ProviderToolDefinition[] = [
	{
		name: "search_files",
		description:
			"Search repository files with ripgrep. Use this to locate tests related to acceptance criteria.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string" },
				glob: {
					type: "string",
					default: "**/*.{test,spec,cases}.{ts,tsx,js,jsx}",
				},
				maxResults: { type: "number", default: 50 },
			},
			required: ["query"],
		},
	},
	{
		name: "read_file",
		description: "Read up to 120 lines from a repository test file.",
		inputSchema: {
			type: "object",
			properties: {
				filePath: { type: "string" },
				startLine: { type: "number" },
				endLine: { type: "number" },
			},
			required: ["filePath"],
		},
	},
	{
		name: "run_command",
		description:
			"Run rg or a focused Bun test command. Broad verification commands are not allowed here.",
		inputSchema: {
			type: "object",
			properties: {
				command: { type: "string" },
			},
			required: ["command"],
		},
	},
];

async function executeValidatedToolCall(input: {
	toolName: string;
	args: Record<string, unknown>;
	repoRoot: string;
	readFiles: string[];
}) {
	const validation = validateToolCall(
		input.toolName,
		input.args,
		input.repoRoot,
	);
	if (!validation.ok) {
		return { result: blockedToolResult(input.toolName, validation.message) };
	}
	return executeWorkerTool({
		toolName: validation.toolName,
		args: validation.args,
		repoRoot: input.repoRoot,
		readFiles: input.readFiles,
	});
}

function validateToolCall(
	toolName: string,
	args: Record<string, unknown>,
	repoRoot: string,
):
	| { ok: true; toolName: WorkerToolName; args: Record<string, unknown> }
	| { ok: false; message: string } {
	if (toolName === "search_files") {
		const query = typeof args.query === "string" ? args.query.trim() : "";
		if (!query) return { ok: false, message: "search_files requires a query." };
		return {
			ok: true,
			toolName: "search_files",
			args: {
				query,
				glob:
					typeof args.glob === "string" && args.glob.trim()
						? args.glob
						: "**/*.{test,spec,cases}.{ts,tsx,js,jsx}",
				maxResults: clampNumber(args.maxResults, 1, 50, 50),
			},
		};
	}

	if (toolName === "read_file") {
		const filePath =
			typeof args.filePath === "string" ? args.filePath.trim() : "";
		if (!filePath)
			return { ok: false, message: "read_file requires filePath." };
		if (!isRepoRelativePath(filePath, repoRoot)) {
			return {
				ok: false,
				message: "read_file path must stay inside the repository.",
			};
		}
		const relative = toRepoRelativePath(filePath, repoRoot);
		if (!TEST_FILE_PATTERN.test(relative)) {
			return { ok: false, message: "read_file is limited to test files." };
		}
		const startLine = clampNumber(
			args.startLine,
			1,
			Number.MAX_SAFE_INTEGER,
			1,
		);
		const requestedEndLine =
			typeof args.endLine === "number" && Number.isFinite(args.endLine)
				? Math.floor(args.endLine)
				: startLine + 119;
		const endLine = Math.min(
			Math.max(requestedEndLine, startLine),
			startLine + 119,
		);
		return {
			ok: true,
			toolName: "read_file",
			args: { filePath: relative, startLine, endLine, compressionMode: "auto" },
		};
	}

	if (toolName === "run_command") {
		const command = typeof args.command === "string" ? args.command.trim() : "";
		if (!command)
			return { ok: false, message: "run_command requires command." };
		if (UNSAFE_SHELL_CHARS.test(command)) {
			return {
				ok: false,
				message: "run_command does not allow shell control characters.",
			};
		}
		const focusedTest = FOCUSED_TEST_COMMAND_PATTERN.exec(command);
		const isAllowedRg = /^rg\b/.test(command);
		if (!isAllowedRg && !focusedTest?.groups?.filePath) {
			return {
				ok: false,
				message:
					"run_command only allows rg or bun run test run <single test file>.",
			};
		}
		if (focusedTest?.groups?.filePath) {
			const filePath = focusedTest.groups.filePath;
			if (!isRepoRelativePath(filePath, repoRoot)) {
				return {
					ok: false,
					message: "focused test command path must stay inside the repository.",
				};
			}
			const relative = toRepoRelativePath(filePath, repoRoot);
			if (
				relative.startsWith("..") ||
				path.isAbsolute(relative) ||
				!TEST_FILE_PATTERN.test(relative)
			) {
				return {
					ok: false,
					message: "focused test command must target one repository test file.",
				};
			}
		}
		return {
			ok: true,
			toolName: "run_command",
			args: { command, timeoutSeconds: 30, compressionMode: "auto" },
		};
	}

	return {
		ok: false,
		message: `Tool is not allowed for test evidence review: ${toolName}`,
	};
}

function isRepoRelativePath(filePath: string, repoRoot: string) {
	const absolute = path.isAbsolute(filePath)
		? path.resolve(filePath)
		: path.resolve(repoRoot, filePath);
	return absolute === repoRoot || absolute.startsWith(`${repoRoot}${path.sep}`);
}

function toRepoRelativePath(filePath: string, repoRoot: string) {
	const absolute = path.isAbsolute(filePath)
		? path.resolve(filePath)
		: path.resolve(repoRoot, filePath);
	return path.relative(repoRoot, absolute).split(path.sep).join("/");
}

function clampNumber(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(value)));
}

function blockedToolResult(
	toolName: string,
	message: string,
): WorkerToolResult<Record<string, never>> {
	const now = new Date().toISOString();
	return {
		ok: false,
		toolName,
		startedAt: now,
		finishedAt: now,
		payload: {},
		error: { code: "INVALID_TOOL_ARGS", message },
	};
}

function compressToolResult(result: WorkerToolResult<unknown>) {
	return JSON.stringify({
		ok: result.ok,
		toolName: result.toolName,
		payload: result.payload,
		error: result.error,
	}).slice(0, MAX_TOOL_RESULT_CHARS);
}

function commandSummary(
	result: WorkerToolResult<unknown>,
): TestEvidenceReviewResult["commandsRun"][number] {
	const payload = result.payload as {
		command?: unknown;
		exitCode?: unknown;
		stdout?: unknown;
		stderr?: unknown;
	};
	const stdout = typeof payload.stdout === "string" ? payload.stdout : "";
	const stderr = typeof payload.stderr === "string" ? payload.stderr : "";
	return {
		command:
			typeof payload.command === "string" ? payload.command : result.toolName,
		exitCode: typeof payload.exitCode === "number" ? payload.exitCode : null,
		summary:
			[stdout, stderr].filter(Boolean).join("\n").slice(0, 500) ||
			result.error?.message ||
			"",
	};
}

function mergeCommandsRun(
	modelCommands: TestEvidenceReviewResult["commandsRun"],
	observedCommands: TestEvidenceReviewResult["commandsRun"],
) {
	const byCommand = new Map<
		string,
		TestEvidenceReviewResult["commandsRun"][number]
	>();
	for (const command of [...observedCommands, ...modelCommands]) {
		byCommand.set(command.command, command);
	}
	return [...byCommand.values()];
}

function normalizeAgenticReviewResult(
	result: TestEvidenceReviewResult,
	precheck: AcceptanceTestCoverageResult,
): TestEvidenceReviewResult {
	const criteriaByText = new Map(
		result.criteria.map((criterion) => [criterion.criterion, criterion]),
	);
	return {
		...result,
		criteria: precheck.criteria.map((criterionText) => {
			const criterion = criteriaByText.get(criterionText);
			if (!criterion) {
				return {
					criterion: criterionText,
					status: "unclear" as const,
					confidence: "low" as const,
					evidence: [
						{
							kind: "reasoning" as const,
							note: "Agentic test evidence review did not return a result for this acceptance criterion.",
						},
					],
				};
			}
			if (
				criterion.status !== "confirmed" ||
				criterion.evidence.some((evidence) => evidence.kind !== "reasoning")
			) {
				return criterion;
			}
			return {
				...criterion,
				status: "unclear" as const,
				confidence: "low" as const,
				evidence: [
					...criterion.evidence,
					{
						kind: "reasoning" as const,
						note: "Confirmed result did not include tool evidence, so Review Mode marked it unclear.",
					},
				],
			};
		}),
	};
}

function buildSystemPrompt() {
	return [
		"あなたは Review Mode のテスト証跡確認エージェントです。",
		"受け入れ条件ごとに、対応するテスト証跡を tool で確認してください。",
		"名前一致だけで not_found と断定しないでください。",
		"confirmed は test_name、test_body、file_path、または cli の evidence を含む場合だけ使ってください。",
		"not_found / unclear は warning 用の改善依頼につながるため、確認した範囲を evidence に残してください。",
		"最後は説明文ではなく TestEvidenceReviewResult JSON だけを返してください。",
	].join("\n");
}

function buildUserPrompt(precheck: AcceptanceTestCoverageResult) {
	return [
		"次の precheck 結果を起点に、受け入れ条件ごとのテスト証跡を確認してください。",
		"",
		JSON.stringify(
			{
				criteria: precheck.criteria,
				planFound: precheck.planFound,
				planTitle: precheck.planTitle,
				testFilesScanned: precheck.testFilesScanned,
				testNamesScanned: precheck.testNamesScanned,
				matches: precheck.matches,
			},
			null,
			2,
		),
		"",
		"出力 contract:",
		'{ "version": 1, "summary": string, "criteria": [...], "commandsRun": [...] }',
	].join("\n");
}
