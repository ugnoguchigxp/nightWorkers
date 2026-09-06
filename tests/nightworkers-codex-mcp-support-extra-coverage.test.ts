import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleNightWorkersCodexMcpRequest } from "../api/modules/codingAgent/mcp/nightworkers-codex-mcp-request";

const mocks = vi.hoisted(() => {
	type ToolInput = {
		execute: () => Promise<unknown>;
		[key: string]: unknown;
	};
	const transports: Array<{
		options: unknown;
		handleRequest: ReturnType<typeof vi.fn>;
	}> = [];
	class Transport {
		options: unknown;
		handleRequest = vi.fn(
			async () => new Response("transport response", { status: 202 }),
		);
		constructor(options: unknown) {
			this.options = options;
			transports.push(this);
		}
	}
	const server = { connect: vi.fn(async () => undefined) };
	return {
		actionExecutionJournal: {
			execute: vi.fn(async (input: ToolInput) => ({
				result: await input.execute(),
			})),
		},
		assertRequestedRunWorkspaceRoot: vi.fn(async () => ({
			ok: true,
			executionRoot: "/execution",
		})),
		buildCodingAgentRecoveryGuidance: vi.fn((input: unknown) => input),
		contentDigest: vi.fn((value: string) => `digest:${value}`),
		createNightWorkersCodexMcpServer: vi.fn(() => server),
		ensureNightWorkersSchema: vi.fn(async () => undefined),
		getRepository: vi.fn(),
		getTask: vi.fn(),
		getTaskRun: vi.fn(),
		loadCodingAgentContextPacket: vi.fn(),
		projectWorkerResultToMcpStructuredPayload: vi.fn(
			(result: { payload: unknown }) => result.payload,
		),
		projectWorkerResultToNativeApiToolResult: vi.fn(
			(result: { ok: boolean; toolName: string }) => ({
				content: `native:${result.toolName}:${result.ok}`,
			}),
		),
		requiresCurrentTodo: vi.fn(() => false),
		resolveRunWorkspaceAuthority: vi.fn(async () => ({
			ok: true,
			executionRoot: "/execution",
		})),
		server,
		Transport,
		transports,
	};
});

vi.mock(
	"@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js",
	() => ({ WebStandardStreamableHTTPServerTransport: mocks.Transport }),
);
vi.mock("../api/db/bootstrap", () => ({
	ensureNightWorkersSchema: mocks.ensureNightWorkersSchema,
}));
vi.mock("../api/modules/agentsShare", () => ({
	buildCodingAgentRecoveryGuidance: mocks.buildCodingAgentRecoveryGuidance,
	contentDigest: mocks.contentDigest,
}));
vi.mock(
	"../api/modules/codingAgent/application/action-execution-journal",
	() => ({
		actionExecutionJournal: mocks.actionExecutionJournal,
	}),
);
vi.mock("../api/modules/codingAgent/context", () => ({
	loadCodingAgentContextPacket: mocks.loadCodingAgentContextPacket,
	requiresCurrentTodo: mocks.requiresCurrentTodo,
}));
vi.mock(
	"../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-result-projector",
	() => ({
		projectWorkerResultToMcpStructuredPayload:
			mocks.projectWorkerResultToMcpStructuredPayload,
		projectWorkerResultToNativeApiToolResult:
			mocks.projectWorkerResultToNativeApiToolResult,
	}),
);
vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getRepository: mocks.getRepository,
	getTask: mocks.getTask,
	getTaskRun: mocks.getTaskRun,
}));
vi.mock("../api/services/workspace/run-workspace-authority.service", () => ({
	assertRequestedRunWorkspaceRoot: mocks.assertRequestedRunWorkspaceRoot,
	resolveRunWorkspaceAuthority: mocks.resolveRunWorkspaceAuthority,
}));
vi.mock("../api/modules/codingAgent/mcp/nightworkers-codex-mcp-server", () => ({
	createNightWorkersCodexMcpServer: mocks.createNightWorkersCodexMcpServer,
}));

import {
	controlledToolResult,
	firstNonEmpty,
	isLoopbackHostname,
	isLoopbackNightWorkersMcpRequest,
	readNightWorkersMcpRequestContext,
	readOnlyOntologyTool,
	readSearchParam,
	requestContextMismatchToMcp,
	resolveOntologyRepoPath,
	resolveOntologyTaskId,
	resolveRequestScopedIdentity,
	resolveTaskRepository,
	toolResultToMcp,
} from "../api/modules/codingAgent/mcp/nightworkers-codex-mcp-support";
import {
	clearCodingAgentHostForTest,
	configureCodingAgentHost,
} from "../api/modules/codingAgent/ports/coding-agent-host.binding";
import type { CodingAgentHostPorts } from "../api/modules/codingAgent/ports/coding-agent-host.port";

function successfulToolResult(toolName = "read_file") {
	return {
		ok: true,
		toolName,
		startedAt: "2026-08-09T00:00:00.000Z",
		finishedAt: "2026-08-09T00:00:01.000Z",
		payload: { value: 1 },
	};
}

describe("nightworkers Codex MCP support extra coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		configureCodingAgentHost(hostFake());
		mocks.transports.length = 0;
		mocks.getTaskRun.mockResolvedValue(null);
		mocks.getTask.mockResolvedValue(null);
		mocks.getRepository.mockResolvedValue(null);
		mocks.loadCodingAgentContextPacket.mockResolvedValue({
			planSummary: { planRevision: 4 },
			currentTodo: { id: "todo-current" },
		});
		mocks.requiresCurrentTodo.mockReturnValue(false);
		mocks.resolveRunWorkspaceAuthority.mockResolvedValue({
			ok: true,
			executionRoot: "/execution",
		});
		mocks.assertRequestedRunWorkspaceRoot.mockResolvedValue({
			ok: true,
			executionRoot: "/execution",
		});
		mocks.actionExecutionJournal.execute.mockImplementation(
			async (input: { execute: () => Promise<unknown> }) => ({
				result: await input.execute(),
			}),
		);
	});

	afterEach(() => {
		clearCodingAgentHostForTest();
		vi.unstubAllEnvs();
	});

	it("selects the first trimmed identity and records only real discrepancies", () => {
		expect(firstNonEmpty(undefined, null, " ", "  chosen  ", "later")).toBe(
			"chosen",
		);
		expect(firstNonEmpty(undefined, "   ", null)).toBe("");

		expect(
			resolveRequestScopedIdentity({
				context: { taskId: " task-authority ", runId: "run-authority" },
				suppliedTaskId: "task-wrong",
				suppliedRunId: "run-authority",
				fallbackTaskId: "task-fallback",
				fallbackRunId: "run-fallback",
			}),
		).toEqual({
			taskId: "task-authority",
			runId: "run-authority",
			discrepancies: [
				{
					field: "taskId",
					supplied: "task-wrong",
					authoritative: "task-authority",
				},
			],
		});
		expect(
			resolveRequestScopedIdentity({
				context: {},
				suppliedTaskId: "supplied-task",
				suppliedRunId: "supplied-run",
			}),
		).toEqual({
			taskId: "supplied-task",
			runId: "supplied-run",
			discrepancies: [],
		});
		expect(
			resolveRequestScopedIdentity({
				context: {},
				fallbackTaskId: "fallback-task",
				fallbackRunId: "fallback-run",
				suppliedRunId: "wrong-run",
			}),
		).toMatchObject({
			taskId: "fallback-task",
			runId: "fallback-run",
			discrepancies: [{ field: "runId" }],
		});
	});

	it("builds mismatch recovery from authoritative repository and Todo context", async () => {
		mocks.getTaskRun.mockResolvedValue({
			id: "run-authority",
			taskId: "task-authority",
			repositoryId: "repository-run",
		});
		mocks.getTask.mockResolvedValue({
			id: "task-authority",
			repositoryId: "repository-task",
		});
		mocks.getRepository.mockResolvedValue({
			id: "repository-run",
			localPath: "/registered",
		});
		const result = await requestContextMismatchToMcp({
			toolName: "write_file",
			resolution: {
				taskId: "task-authority",
				runId: "run-authority",
				discrepancies: [
					{
						field: "runId",
						supplied: "wrong",
						authoritative: "run-authority",
					},
				],
			},
			retryArguments: { path: "src/file.ts" },
		});

		expect(result).toMatchObject({
			isError: true,
			structuredContent: {
				error: { code: "REQUEST_CONTEXT_MISMATCH" },
				payload: { intentStatus: "not_executed" },
			},
			content: [{ text: "native:write_file:false" }],
		});
		expect(mocks.buildCodingAgentRecoveryGuidance).toHaveBeenCalledWith(
			expect.objectContaining({
				authoritativeContext: {
					taskId: "task-authority",
					runId: "run-authority",
					repositoryRoot: "/execution",
					planRevision: 4,
					currentTodoId: "todo-current",
				},
				retryArguments: { path: "src/file.ts" },
				intentKey: expect.stringContaining("scoped-retry:digest:"),
			}),
		);

		mocks.getTaskRun.mockResolvedValue(null);
		mocks.getTask.mockResolvedValue(null);
		await requestContextMismatchToMcp({
			toolName: "read_file",
			resolution: { taskId: "", runId: "", discrepancies: [] },
			retryArguments: {},
		});
		expect(mocks.loadCodingAgentContextPacket).toHaveBeenCalledTimes(1);
	});

	it("resolves mismatch, missing task, run authority, and task-only repository roots", async () => {
		mocks.getTaskRun.mockResolvedValueOnce({
			id: "run-1",
			taskId: "other-task",
		});
		mocks.getTask.mockResolvedValueOnce({ id: "requested-task" });
		await expect(
			resolveTaskRepository({ taskId: "requested-task", runId: "run-1" }),
		).resolves.toEqual({
			task: null,
			run: null,
			repository: null,
			registeredRepoRoot: null,
			executionRoot: null,
		});

		mocks.getTaskRun.mockResolvedValueOnce({
			id: "run-missing-task",
			taskId: "missing-task",
		});
		mocks.getTask.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
		await expect(
			resolveTaskRepository({ taskId: "missing", runId: "run-missing-task" }),
		).resolves.toMatchObject({
			task: null,
			run: { id: "run-missing-task" },
			executionRoot: null,
		});

		mocks.getTaskRun.mockResolvedValueOnce({
			id: "run-ok",
			taskId: "task-run",
			repositoryId: "repository-run",
		});
		mocks.getTask.mockResolvedValueOnce({
			id: "task-run",
			repositoryId: "repository-task",
		});
		mocks.getRepository.mockResolvedValueOnce({
			id: "repository-run",
			localPath: "/registered-run",
		});
		await expect(
			resolveTaskRepository({ taskId: "task-run", runId: "run-ok" }),
		).resolves.toMatchObject({
			registeredRepoRoot: "/registered-run",
			executionRoot: "/execution",
		});
		expect(mocks.getRepository).toHaveBeenLastCalledWith("repository-run");

		mocks.getTask.mockResolvedValueOnce({
			id: "task-only",
			repositoryId: "repository-task",
			worktreePath: " /worktree ",
		});
		mocks.getRepository.mockResolvedValueOnce({
			id: "repository-task",
			localPath: "/registered-task",
		});
		await expect(
			resolveTaskRepository({ taskId: "task-only", runId: "" }),
		).resolves.toMatchObject({ executionRoot: "/worktree" });

		mocks.getTask.mockResolvedValueOnce({
			id: "task-without-repository",
			repositoryId: null,
			worktreePath: null,
		});
		await expect(
			resolveTaskRepository({ taskId: "task-without-repository", runId: "" }),
		).resolves.toMatchObject({
			repository: null,
			registeredRepoRoot: null,
			executionRoot: null,
		});
	});

	it("uses explicit, request, environment, and repository ontology identities", async () => {
		await expect(resolveOntologyRepoPath("  /explicit  ", {})).resolves.toBe(
			"/explicit",
		);

		vi.stubEnv("NIGHTWORKERS_TASK_ID", "task-env");
		vi.stubEnv("NIGHTWORKERS_RUN_ID", "run-env");
		mocks.getTaskRun.mockResolvedValueOnce({
			id: "run-context",
			taskId: "task-context",
			repositoryId: "repository-context",
		});
		mocks.getTask.mockResolvedValueOnce({
			id: "task-context",
			repositoryId: "repository-context",
		});
		mocks.getRepository.mockResolvedValueOnce({
			id: "repository-context",
			localPath: "/registered-context",
		});
		mocks.resolveRunWorkspaceAuthority.mockResolvedValueOnce({
			ok: false,
			code: "NO_WORKSPACE",
			message: "missing",
		});
		await expect(
			resolveOntologyRepoPath(undefined, {
				taskId: "task-context",
				runId: "run-context",
			}),
		).resolves.toBe("/registered-context");

		await expect(
			resolveOntologyTaskId({ taskId: " task-direct " }),
		).resolves.toBe("task-direct");
		await expect(resolveOntologyTaskId({})).resolves.toBe("task-env");

		vi.stubEnv("NIGHTWORKERS_TASK_ID", "");
		mocks.getTaskRun.mockResolvedValueOnce({
			id: "run-env",
			taskId: "task-from-run",
		});
		mocks.getTask.mockResolvedValueOnce({ id: "task-from-run" });
		await expect(resolveOntologyTaskId({})).resolves.toBe("task-from-run");
	});

	it("wraps read-only ontology success and Error or non-Error failures", async () => {
		await expect(
			readOnlyOntologyTool("ontology_ok", async () => ({ count: 2 })),
		).resolves.toMatchObject({
			ok: true,
			toolName: "ontology_ok",
			payload: { count: 2 },
		});
		await expect(
			readOnlyOntologyTool("ontology_error", async () => {
				throw new Error("failed with Error");
			}),
		).resolves.toMatchObject({
			ok: false,
			payload: null,
			error: { code: "ONTOLOGY_TOOL_FAILED", message: "failed with Error" },
		});
		await expect(
			readOnlyOntologyTool("ontology_string", async () => {
				throw "failed as string";
			}),
		).resolves.toMatchObject({
			error: { message: "failed as string" },
		});
	});

	it("rejects remote MCP requests and serves loopback requests", async () => {
		const remote = await handleNightWorkersCodexMcpRequest(
			new Request("https://example.com/mcp"),
		);
		expect(remote.status).toBe(403);
		expect(await remote.json()).toMatchObject({
			error: { code: -32000 },
		});
		expect(mocks.ensureNightWorkersSchema).not.toHaveBeenCalled();

		const request = new Request(
			"http://LOCALHOST/mcp?taskId=%20task-1%20&runId=%20run-1%20",
		);
		const loopback = await handleNightWorkersCodexMcpRequest(request);
		expect(loopback.status).toBe(202);
		expect(await loopback.text()).toBe("transport response");
		expect(mocks.ensureNightWorkersSchema).toHaveBeenCalledOnce();
		expect(mocks.createNightWorkersCodexMcpServer).toHaveBeenCalledWith({
			taskId: "task-1",
			runId: "run-1",
		});
		expect(mocks.server.connect).toHaveBeenCalledWith(mocks.transports[0]);
		expect(mocks.transports[0]?.options).toEqual({
			sessionIdGenerator: undefined,
		});
		expect(mocks.transports[0]?.handleRequest).toHaveBeenCalledWith(request);
	});

	it("parses loopback hosts and optional request query values safely", () => {
		expect(isLoopbackHostname("LOCALHOST")).toBe(true);
		expect(isLoopbackHostname("127.0.0.1")).toBe(true);
		expect(isLoopbackHostname("[::1]")).toBe(true);
		expect(isLoopbackHostname("0.0.0.0")).toBe(false);
		expect(
			isLoopbackNightWorkersMcpRequest(new Request("http://[::1]/mcp")),
		).toBe(true);
		expect(
			isLoopbackNightWorkersMcpRequest({ url: "not a URL" } as Request),
		).toBe(false);
		expect(
			readNightWorkersMcpRequestContext({ url: "invalid" } as Request),
		).toEqual({});

		const url = new URL("http://localhost/mcp?taskId=%20%20&runId=%20run%20");
		expect(readSearchParam(url, "taskId")).toBeUndefined();
		expect(readSearchParam(url, "runId")).toBe("run");
		expect(readNightWorkersMcpRequestContext(new Request(url))).toEqual({
			taskId: undefined,
			runId: "run",
		});
	});

	it("converts successful and failed worker results to MCP payloads", () => {
		expect(toolResultToMcp(successfulToolResult())).toEqual({
			isError: false,
			structuredContent: { payload: { value: 1 } },
			content: [{ type: "text", text: "native:read_file:true" }],
		});
		const failed = {
			...successfulToolResult("write_file"),
			ok: false,
			payload: null,
			error: { code: "WRITE_FAILED", message: "no write" },
		};
		expect(toolResultToMcp(failed)).toMatchObject({
			isError: true,
			structuredContent: {
				payload: null,
				error: { code: "WRITE_FAILED" },
			},
		});
	});

	it("allows todo_list and direct non-idempotent tool execution", async () => {
		mocks.requiresCurrentTodo.mockReturnValue(true);
		const todoExecute = vi.fn(async () => successfulToolResult("todo_list"));
		await expect(
			controlledToolResult({
				context: {},
				runId: "run-1",
				toolName: "todo_list",
				arguments: { command: "list" },
				execute: todoExecute,
			}),
		).resolves.toMatchObject({ isError: false });
		expect(todoExecute).toHaveBeenCalledOnce();
		expect(mocks.resolveRunWorkspaceAuthority).not.toHaveBeenCalled();

		mocks.requiresCurrentTodo.mockReturnValue(false);
		mocks.getTaskRun.mockResolvedValue({ id: "run-1", taskId: "task-1" });
		mocks.getTask.mockResolvedValue({ id: "task-1", worktreePath: null });
		const directExecute = vi.fn(async () => successfulToolResult("read_file"));
		await controlledToolResult({
			context: {},
			runId: "run-1",
			toolName: "read_file",
			arguments: {},
			execute: directExecute,
		});
		expect(mocks.resolveRunWorkspaceAuthority).toHaveBeenCalledWith("run-1");
		expect(directExecute).toHaveBeenCalledOnce();
	});

	it("blocks tools for workspace authority and current Todo failures", async () => {
		mocks.getTaskRun.mockResolvedValue({ id: "run-2", taskId: "task-2" });
		mocks.getTask.mockResolvedValue({
			id: "task-2",
			worktreePath: "/execution-root",
		});
		mocks.resolveRunWorkspaceAuthority.mockResolvedValue({
			ok: true,
			executionRoot: "/execution-root",
		});
		mocks.assertRequestedRunWorkspaceRoot.mockResolvedValueOnce({
			ok: false,
			code: "WORKSPACE_MISMATCH",
			message: "wrong root",
		});
		const execute = vi.fn(async () => successfulToolResult());
		await expect(
			controlledToolResult({
				context: { taskId: "task-2" },
				runId: "run-2",
				toolName: "write_file",
				arguments: {},
				execute,
			}),
		).resolves.toMatchObject({
			isError: true,
			structuredContent: { error: { code: "WORKSPACE_MISMATCH" } },
		});
		expect(execute).not.toHaveBeenCalled();
		expect(mocks.assertRequestedRunWorkspaceRoot).toHaveBeenCalledWith({
			runId: "run-2",
			taskId: "task-2",
			requestedRoot: "/execution-root",
		});

		mocks.assertRequestedRunWorkspaceRoot.mockResolvedValue({
			ok: true,
			executionRoot: "/execution-root",
		});
		mocks.requiresCurrentTodo.mockReturnValue(true);
		await expect(
			controlledToolResult({
				context: { taskId: "task-2" },
				runId: "run-2",
				toolName: "write_file",
				arguments: {},
				execute,
			}),
		).resolves.toMatchObject({
			isError: true,
			structuredContent: {
				error: { code: "CURRENT_TODO_REQUIRED" },
				payload: { planSummary: { planRevision: 4 } },
			},
		});

		mocks.loadCodingAgentContextPacket.mockResolvedValueOnce(null);
		await controlledToolResult({
			context: { taskId: "task-2" },
			runId: "run-2",
			toolName: "write_file",
			arguments: {},
			execute,
		});
		expect(
			mocks.projectWorkerResultToMcpStructuredPayload.mock.calls.at(-1)?.[0],
		).toMatchObject({ payload: { planSummary: null } });
	});

	it("journals idempotent side effects with optional workspace identity", async () => {
		mocks.getTaskRun.mockResolvedValue({ id: "run-3", taskId: "task-3" });
		mocks.getTask.mockResolvedValue({ id: "task-3", worktreePath: null });
		const execute = vi.fn(async () => successfulToolResult("apply_patch"));
		const result = await controlledToolResult({
			context: {},
			runId: "run-3",
			toolName: "apply_patch",
			arguments: { patch: "change" },
			workspaceIdentity: "workspace-identity",
			idempotentSideEffect: true,
			execute,
		});

		expect(result).toMatchObject({ isError: false });
		expect(mocks.actionExecutionJournal.execute).toHaveBeenCalledWith({
			runId: "run-3",
			toolName: "apply_patch",
			arguments: { patch: "change" },
			workspaceIdentity: "workspace-identity",
			dedupeRevision: 0,
			execute,
		});
		expect(execute).toHaveBeenCalledOnce();
	});
});

function hostFake(): CodingAgentHostPorts {
	return {
		taskReader: {
			getTask: mocks.getTask,
			getRepository: mocks.getRepository,
			readArtifactContent: async () => null,
		},
		runReader: {
			getRun: mocks.getTaskRun,
			listRunTodos: async () => [],
		},
		runLifecycle: {
			startRun: async () => {
				throw new Error("not used");
			},
			resumeRunTodo: async () => {
				throw new Error("not used");
			},
			resumeInterruptedRun: async () => {
				throw new Error("not used");
			},
			updateRunContext: async () => ({ kind: "not_found" }),
		},
		runJournal: {
			appendRunEvent: async () => {},
			appendTaskMessage: async () => {},
			publishRun: async () => {},
			appendTaskEvent: async () => {},
		},
		verificationReader: {
			getLatestActiveDocument: async () => null,
			runCompletionCheck: async () => ({
				ok: false,
				reason: null,
				suggestedAction: null,
				sourceStateHash: null,
				verify: { status: "not_run" },
				confirmation: { status: "not_required" },
			}),
		},
	};
}
