import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerToolName } from "../api/services/tool-policy/types";
import { executeWorkerTool } from "../api/services/worker-tools/dispatcher";

const mocks = vi.hoisted(() => {
	const result = (toolName: string) => ({
		ok: true,
		toolName,
		startedAt: "2026-01-01T00:00:00.000Z",
		finishedAt: "2026-01-01T00:00:01.000Z",
		payload: { routed: toolName },
	});
	const tool = (toolName: string) => vi.fn(async () => result(toolName));
	return {
		result,
		authority: vi.fn(async () => ({ ok: true })),
		listDir: tool("list_dir"),
		findFile: tool("find_file"),
		readFile: tool("read_file"),
		readCurrentSpecification: tool("read_current_specification"),
		inspectStructure: tool("inspect_structure"),
		searchFiles: tool("search_files"),
		searchWeb: tool("search_web"),
		fetchContent: tool("fetch_content"),
		copyDirectory: tool("copy_directory"),
		importProject: tool("import_project"),
		cloneGitRepo: tool("clone_git_repo"),
		materializeTemplate: tool("materialize_template"),
		applyPatch: tool("apply_patch"),
		replaceContent: tool("replace_content"),
		runCommand: tool("run_command"),
		runBackgroundCommand: tool("run_background_command"),
		runVerification: tool("run_verification"),
		runCheck: tool("run_check"),
		completionCheck: tool("completion_check"),
		collectTestInventory: tool("collect_test_inventory"),
		recordTestConditionMapping: tool("record_test_condition_mapping"),
		catalog: tool("project_exploration_catalog"),
		catalogUnavailable: vi.fn(() => result("project_exploration_catalog")),
		mcpCall: tool("mcp_call_tool"),
		gitStatus: tool("git_status"),
		gitDiff: tool("git_diff"),
	};
});

vi.mock("../api/services/workspace/run-workspace-authority.service", () => ({
	assertRunWorkspaceSideEffectAuthority: mocks.authority,
}));
vi.mock("../api/services/worker-tools/list-dir", () => ({
	listDirTool: mocks.listDir,
}));
vi.mock("../api/services/worker-tools/find-file", () => ({
	findFileTool: mocks.findFile,
}));
vi.mock("../api/services/worker-tools/read-file", () => ({
	readFileTool: mocks.readFile,
}));
vi.mock("../api/services/worker-tools/read-current-specification", () => ({
	readCurrentSpecificationTool: mocks.readCurrentSpecification,
}));
vi.mock(
	"../api/services/worker-tools/structure-inspection/inspect-structure",
	() => ({ inspectStructureTool: mocks.inspectStructure }),
);
vi.mock("../api/services/worker-tools/search-files", () => ({
	searchFilesTool: mocks.searchFiles,
}));
vi.mock("../api/services/worker-tools/search-web", () => ({
	searchWebTool: mocks.searchWeb,
}));
vi.mock("../api/services/worker-tools/fetch-content", () => ({
	fetchContentTool: mocks.fetchContent,
}));
vi.mock("../api/services/worker-tools/copy-directory", () => ({
	copyDirectoryTool: mocks.copyDirectory,
}));
vi.mock("../api/services/worker-tools/import-project", () => ({
	importProjectTool: mocks.importProject,
}));
vi.mock("../api/services/worker-tools/clone-git-repo", () => ({
	cloneGitRepoTool: mocks.cloneGitRepo,
}));
vi.mock("../api/services/worker-tools/materialize-template", () => ({
	materializeTemplateTool: mocks.materializeTemplate,
}));
vi.mock("../api/services/worker-tools/apply-patch", () => ({
	applyPatchTool: mocks.applyPatch,
}));
vi.mock("../api/services/worker-tools/replace-content", () => ({
	replaceContentTool: mocks.replaceContent,
}));
vi.mock("../api/services/worker-tools/run-command", () => ({
	runCommandTool: mocks.runCommand,
}));
vi.mock("../api/services/worker-tools/run-background-command", () => ({
	runBackgroundCommandTool: mocks.runBackgroundCommand,
}));
vi.mock("../api/services/worker-tools/run-verification", () => ({
	runVerificationTool: mocks.runVerification,
}));
vi.mock("../api/services/worker-tools/run-check", () => ({
	runCheckTool: mocks.runCheck,
	completionCheckTool: mocks.completionCheck,
}));
vi.mock("../api/modules/codingAgent", () => ({
	collectTestInventoryTool: mocks.collectTestInventory,
	recordTestConditionMappingTool: mocks.recordTestConditionMapping,
}));
vi.mock(
	"../api/modules/ontology/exploration/project-exploration-catalog-tool",
	() => ({
		projectExplorationCatalogTool: mocks.catalog,
		projectExplorationCatalogUnavailableResult: mocks.catalogUnavailable,
	}),
);
vi.mock("../api/services/worker-tools/mcp-call-tool", () => ({
	mcpCallTool: mocks.mcpCall,
}));
vi.mock("../api/services/worker-tools/git", () => ({
	gitStatusTool: mocks.gitStatus,
	gitDiffTool: mocks.gitDiff,
}));

const safetyPolicy = {
	allowedPaths: ["src/**"],
	externalAllowedPaths: ["/external/**"],
	deniedPaths: ["secret/**"],
	blockedCommands: ["rm"],
	maxCommandSeconds: 91,
};

function dispatch(
	toolName: WorkerToolName,
	args: Record<string, unknown> = {},
	overrides: Record<string, unknown> = {},
) {
	return executeWorkerTool({
		toolName,
		args,
		repoRoot: "/repo",
		taskId: "task-input",
		readFiles: ["already.ts"],
		safetyPolicy,
		toolContext: { readFileCache: new Map() },
		runtimeEnvironment: { TEST_VALUE: "yes" },
		confinementRequired: true,
		...overrides,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.authority.mockResolvedValue({ ok: true });
	for (const [name, mock] of Object.entries(mocks)) {
		if (
			name !== "result" &&
			name !== "authority" &&
			name !== "catalogUnavailable" &&
			"mockResolvedValue" in mock
		) {
			mock.mockResolvedValue(mocks.result(nameToToolName(name)));
		}
	}
	mocks.catalogUnavailable.mockReturnValue(
		mocks.result("project_exploration_catalog"),
	);
});

describe("executeWorkerTool routing", () => {
	it("routes list_dir with path policy and all optional arguments", async () => {
		const output = await dispatch("list_dir", {
			relativePath: "src",
			recursive: true,
			skipIgnored: false,
			maxEntries: 7,
		});
		expect(output.result).toBe(await resolvedResult(mocks.listDir));
		expect(mocks.listDir).toHaveBeenCalledWith({
			relativePath: "src",
			recursive: true,
			skipIgnored: false,
			maxEntries: 7,
			repoRoot: "/repo",
			allowedPaths: ["src/**"],
			deniedPaths: ["secret/**"],
		});
	});

	it("routes find_file", async () => {
		await dispatch("find_file", {
			fileMask: "*.ts",
			relativePath: "src",
			recursive: false,
			maxResults: 3,
		});
		expect(mocks.findFile).toHaveBeenCalledWith({
			fileMask: "*.ts",
			relativePath: "src",
			recursive: false,
			maxResults: 3,
			repoRoot: "/repo",
			allowedPaths: ["src/**"],
			deniedPaths: ["secret/**"],
		});
	});

	it("tracks a newly and successfully read file", async () => {
		const output = await dispatch("read_file", {
			filePath: "fresh.ts",
			startLine: 2,
			endLine: 9,
			fresh: true,
			compressionMode: "off",
		});
		expect(output.readFilesChanged).toEqual(["already.ts", "fresh.ts"]);
		expect(mocks.readFile).toHaveBeenCalledWith(
			expect.objectContaining({
				filePath: "fresh.ts",
				startLine: 2,
				endLine: 9,
				fresh: true,
				compressionMode: "off",
				readCache: expect.any(Map),
			}),
		);
	});

	it.each([
		["already tracked", "already.ts", mocks.result("read_file")],
		["failed", "failed.ts", { ...mocks.result("read_file"), ok: false }],
		["non-string path", 42, mocks.result("read_file")],
	])("does not change read files for a %s read", async (_name, filePath, result) => {
		mocks.readFile.mockResolvedValueOnce(result);
		const output = await dispatch("read_file", { filePath });
		expect(output).toEqual({ result });
	});

	it.each([
		["argument", "task-arg", "task-arg"],
		["input", undefined, "task-input"],
		["empty fallback", undefined, ""],
	])("routes read_current_specification using the %s task id", async (_name, taskArg, expected) => {
		await dispatch(
			"read_current_specification",
			{
				taskId: taskArg,
				view: "summary",
				includeDesignContext: true,
			},
			expected ? {} : { taskId: undefined },
		);
		expect(mocks.readCurrentSpecification).toHaveBeenCalledWith({
			taskId: expected,
			view: "summary",
			includeDesignContext: true,
		});
	});

	it("routes inspect_structure", async () => {
		await dispatch("inspect_structure", {
			filePath: "src/index.ts",
			includeImports: true,
			previewPrimitives: false,
			maxPaths: 8,
		});
		expect(mocks.inspectStructure).toHaveBeenCalledWith({
			filePath: "src/index.ts",
			repoRoot: "/repo",
			includeImports: true,
			previewPrimitives: false,
			maxPaths: 8,
			allowedPaths: ["src/**"],
			deniedPaths: ["secret/**"],
		});
	});

	it("routes search_files, search_web, and fetch_content", async () => {
		await dispatch("search_files", {
			query: "needle",
			glob: "**/*.ts",
			maxResults: 12,
			caseSensitive: true,
		});
		await dispatch("search_web", { query: "docs", maxResults: 4 });
		await dispatch("fetch_content", {
			url: "https://example.test",
			maxChars: 99,
		});
		expect(mocks.searchFiles).toHaveBeenCalledWith({
			query: "needle",
			repoRoot: "/repo",
			glob: "**/*.ts",
			maxResults: 12,
			caseSensitive: true,
			allowedPaths: ["src/**"],
			deniedPaths: ["secret/**"],
		});
		expect(mocks.searchWeb).toHaveBeenCalledWith({
			query: "docs",
			maxResults: 4,
		});
		expect(mocks.fetchContent).toHaveBeenCalledWith({
			url: "https://example.test",
			maxChars: 99,
		});
	});

	it("routes copy_directory", async () => {
		await dispatch("copy_directory", {
			sourcePath: "fixture",
			targetPath: "target",
			overwrite: true,
			exclude: ["node_modules"],
		});
		expect(mocks.copyDirectory).toHaveBeenCalledWith({
			sourcePath: "fixture",
			targetPath: "target",
			overwrite: true,
			exclude: ["node_modules"],
			repoRoot: "/repo",
			allowedPaths: ["src/**"],
			deniedPaths: ["secret/**"],
		});
	});

	it("routes import_project with every argument", async () => {
		await dispatch("import_project", {
			repoUrl: "https://example.test/repo.git",
			templateId: "template",
			variant: "minimal",
			overlays: ["react"],
			targetPath: "target",
			ref: "main",
			depth: 2,
			overwrite: true,
			stripGitDir: false,
			exclude: ["tmp"],
			initialize: true,
		});
		expect(mocks.importProject).toHaveBeenCalledWith(
			expect.objectContaining({
				repoUrl: "https://example.test/repo.git",
				templateId: "template",
				variant: "minimal",
				overlays: ["react"],
				targetPath: "target",
				ref: "main",
				depth: 2,
				overwrite: true,
				stripGitDir: false,
				exclude: ["tmp"],
				initialize: true,
			}),
		);
	});

	it("routes clone_git_repo and materialize_template", async () => {
		await dispatch("clone_git_repo", {
			repoUrl: "ssh://repo",
			targetPath: "clone",
			ref: "v1",
			depth: 1,
			overwrite: false,
			stripGitDir: true,
		});
		await dispatch("materialize_template", {
			templateId: "web",
			variant: "full",
			overlays: ["tailwind"],
			targetPath: "app",
			overwrite: true,
			exclude: ["dist"],
		});
		expect(mocks.cloneGitRepo).toHaveBeenCalledWith(
			expect.objectContaining({ repoUrl: "ssh://repo", stripGitDir: true }),
		);
		expect(mocks.materializeTemplate).toHaveBeenCalledWith(
			expect.objectContaining({ templateId: "web", overlays: ["tailwind"] }),
		);
	});

	it("routes apply_patch and both replace_content modes", async () => {
		await dispatch("apply_patch", { patchContent: "*** Begin Patch" });
		await dispatch("replace_content", {
			filePath: "a.ts",
			needle: "old",
			replacement: "new",
			mode: "regex",
			allowMultipleOccurrences: true,
		});
		await dispatch("replace_content", {
			filePath: "b.ts",
			needle: "old",
			replacement: "new",
		});
		expect(mocks.applyPatch).toHaveBeenCalledWith({
			patchContent: "*** Begin Patch",
			repoRoot: "/repo",
			allowedPaths: ["src/**"],
			deniedPaths: ["secret/**"],
		});
		expect(mocks.replaceContent).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				mode: "regex",
				allowMultipleOccurrences: true,
			}),
		);
		expect(mocks.replaceContent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ mode: "literal" }),
		);
	});

	it("routes run_command with policy, environment, and confinement", async () => {
		await dispatch("run_command", {
			command: "npm test",
			cwd: "api",
			timeoutSeconds: 10,
			compressionMode: "auto",
		});
		expect(mocks.runCommand).toHaveBeenCalledWith({
			command: "npm test",
			repoRoot: "/repo",
			cwd: "api",
			blockedCommands: ["rm"],
			allowedPaths: ["src/**"],
			deniedPaths: ["secret/**"],
			timeoutSeconds: 10,
			compressionMode: "auto",
			maxCommandSeconds: 91,
			environment: { TEST_VALUE: "yes" },
			confinementRequired: true,
		});
	});

	it.each([
		["argument", "run-arg", "run-arg"],
		["input", undefined, "run-input"],
		["absent", undefined, undefined],
	])("routes run_background_command with the %s run id", async (_name, argRunId, expectedRunId) => {
		await dispatch(
			"run_background_command",
			{
				command: "watch",
				cwd: "src",
				runId: argRunId,
				repositoryId: "repository",
			},
			expectedRunId === "run-input" ? { runId: "run-input" } : {},
		);
		expect(mocks.runBackgroundCommand).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "watch",
				taskId: "task-input",
				runId: expectedRunId,
				repositoryId: "repository",
				environment: { TEST_VALUE: "yes" },
			}),
		);
	});

	it("routes run_verification with explicit values and defaults", async () => {
		await dispatch("run_verification", {
			command: "npm test",
			reason: "regression",
			runId: "run-arg",
			verificationDocumentId: "verification",
			cwd: "tests",
			timeoutSeconds: 22,
			compressionMode: "off",
		});
		await dispatch(
			"run_verification",
			{ command: "npm test" },
			{ runId: "run-input" },
		);
		expect(mocks.runVerification).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				reason: "regression",
				runId: "run-arg",
				verificationDocumentId: "verification",
			}),
		);
		expect(mocks.runVerification).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ reason: "verification", runId: "run-input" }),
		);
	});

	it("routes run_check with explicit values and defaults", async () => {
		await dispatch("run_check", {
			command: "npm run lint",
			checkKind: "lint",
			displayMode: "summary",
			cwd: "api",
			timeoutSeconds: 15,
		});
		await dispatch("run_check", { command: "npm test" });
		expect(mocks.runCheck).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ checkKind: "lint", displayMode: "summary" }),
		);
		expect(mocks.runCheck).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ checkKind: "other" }),
		);
	});

	it.each([
		["arguments", "task-arg", "run-arg", "task-arg", "run-arg"],
		["inputs", undefined, undefined, "task-input", "run-input"],
		["empty defaults", undefined, undefined, "", ""],
	])("routes completion_check from %s", async (_name, taskArg, runArg, expectedTask, expectedRun) => {
		await dispatch(
			"completion_check",
			{
				taskId: taskArg,
				runId: runArg,
				verificationDocumentId: "doc",
			},
			expectedTask === "task-input"
				? { runId: "run-input" }
				: expectedTask === ""
					? { taskId: undefined, runId: undefined }
					: {},
		);
		expect(mocks.completionCheck).toHaveBeenCalledWith({
			taskId: expectedTask,
			runId: expectedRun,
			verificationDocumentId: "doc",
			repoRoot: "/repo",
		});
	});

	it("routes collect_test_inventory with repository policy", async () => {
		await dispatch(
			"collect_test_inventory",
			{
				cwd: "tests",
				cursor: "next",
				limit: 20,
				filePaths: ["a.test.ts"],
			},
			{ runId: "run-input" },
		);
		expect(mocks.collectTestInventory).toHaveBeenCalledWith({
			taskId: "task-input",
			runId: "run-input",
			repoRoot: "/repo",
			cwd: "tests",
			cursor: "next",
			limit: 20,
			filePaths: ["a.test.ts"],
			blockedCommands: ["rm"],
			allowedPaths: ["src/**"],
			externalAllowedPaths: ["/external/**"],
			deniedPaths: ["secret/**"],
			maxCommandSeconds: 91,
			confinementRequired: true,
		});
	});

	it("routes record_test_condition_mapping", async () => {
		const mappings = [
			{ inventoryCaseId: "case-1", conditionIds: ["condition-1"] },
		];
		await dispatch(
			"record_test_condition_mapping",
			{
				verificationDocumentId: "doc",
				inventoryId: "inventory",
				mappings,
			},
			{ runId: "run-input" },
		);
		expect(mocks.recordTestConditionMapping).toHaveBeenCalledWith({
			taskId: "task-input",
			runId: "run-input",
			repoRoot: "/repo",
			verificationDocumentId: "doc",
			inventoryId: "inventory",
			mappings,
		});
	});

	it("returns catalog unavailable without access and routes with access", async () => {
		const unavailable = await dispatch("project_exploration_catalog", {
			focus: { terms: ["worker"] },
		});
		expect(unavailable.result).toBe(
			mocks.catalogUnavailable.mock.results.at(-1)?.value,
		);
		expect(mocks.catalog).not.toHaveBeenCalled();

		await dispatch(
			"project_exploration_catalog",
			{ focus: { paths: ["api/index.ts"] } },
			{
				projectExplorationCatalogAccess: {
					serverId: "server",
					projectPath: "/registered",
					expectedHead: "abc123",
				},
			},
		);
		expect(mocks.catalog).toHaveBeenCalledWith({
			serverId: "server",
			projectPath: "/registered",
			executionPath: "/repo",
			expectedHead: "abc123",
			focus: { paths: ["api/index.ts"] },
		});
	});

	it("routes MCP and git tools", async () => {
		await dispatch("mcp_call_tool", {
			serverId: "server",
			toolName: "lookup",
			arguments: { query: "night" },
		});
		await dispatch("git_status");
		await dispatch("git_diff");
		expect(mocks.mcpCall).toHaveBeenCalledWith({
			serverId: "server",
			toolName: "lookup",
			arguments: { query: "night" },
		});
		expect(mocks.gitStatus).toHaveBeenCalledWith({ repoRoot: "/repo" });
		expect(mocks.gitDiff).toHaveBeenCalledWith({ repoRoot: "/repo" });
	});
});

describe("executeWorkerTool policy and failures", () => {
	it("checks workspace authority before a side effect and continues when allowed", async () => {
		await dispatch(
			"apply_patch",
			{ patchContent: "patch" },
			{ runId: "run-1" },
		);
		expect(mocks.authority).toHaveBeenCalledWith({
			runId: "run-1",
			taskId: "task-input",
			requestedRoot: "/repo",
		});
		expect(mocks.applyPatch).toHaveBeenCalled();
	});

	it("returns a stable failed result when workspace authority rejects", async () => {
		mocks.authority.mockResolvedValueOnce({
			ok: false,
			code: "RUN_WORKSPACE_ROOT_MISMATCH",
			message: "wrong workspace",
		});
		const output = await dispatch(
			"run_command",
			{ command: "touch blocked" },
			{ runId: "run-1" },
		);
		expect(output.result).toMatchObject({
			ok: false,
			toolName: "run_command",
			payload: {},
			error: {
				code: "RUN_WORKSPACE_ROOT_MISMATCH",
				message: "wrong workspace",
				retryable: false,
			},
		});
		expect(output.result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(output.result.finishedAt).toBe(output.result.startedAt);
		expect(mocks.runCommand).not.toHaveBeenCalled();
	});

	it("does not check authority for a read-only tool even when runId exists", async () => {
		await dispatch("list_dir", {}, { runId: "run-1" });
		expect(mocks.authority).not.toHaveBeenCalled();
	});

	it("passes through a failed tool result without rewriting it", async () => {
		const failed = {
			...mocks.result("search_web"),
			ok: false,
			error: { code: "NETWORK", message: "offline", retryable: true },
		};
		mocks.searchWeb.mockResolvedValueOnce(failed);
		await expect(dispatch("search_web", { query: "x" })).resolves.toEqual({
			result: failed,
		});
	});

	it("propagates dependency exceptions", async () => {
		mocks.fetchContent.mockRejectedValueOnce(new Error("transport exploded"));
		await expect(
			dispatch("fetch_content", { url: "https://example.test" }),
		).rejects.toThrow("transport exploded");
	});

	it("passes undefined policy and optional fields through", async () => {
		await dispatch(
			"list_dir",
			{},
			{
				taskId: undefined,
				safetyPolicy: undefined,
				toolContext: undefined,
				runtimeEnvironment: undefined,
				confinementRequired: undefined,
				readFiles: [],
			},
		);
		expect(mocks.listDir).toHaveBeenCalledWith({
			relativePath: undefined,
			recursive: undefined,
			skipIgnored: undefined,
			maxEntries: undefined,
			repoRoot: "/repo",
			allowedPaths: undefined,
			deniedPaths: undefined,
		});
	});

	it("rejects an unknown tool name", async () => {
		await expect(dispatch("not_a_tool" as WorkerToolName)).rejects.toThrow(
			"Unsupported tool name: not_a_tool",
		);
	});
});

function nameToToolName(name: string) {
	const names: Record<string, string> = {
		readCurrentSpecification: "read_current_specification",
		inspectStructure: "inspect_structure",
		searchFiles: "search_files",
		searchWeb: "search_web",
		fetchContent: "fetch_content",
		copyDirectory: "copy_directory",
		importProject: "import_project",
		cloneGitRepo: "clone_git_repo",
		materializeTemplate: "materialize_template",
		applyPatch: "apply_patch",
		replaceContent: "replace_content",
		runCommand: "run_command",
		runBackgroundCommand: "run_background_command",
		runVerification: "run_verification",
		runCheck: "run_check",
		completionCheck: "completion_check",
		collectTestInventory: "collect_test_inventory",
		recordTestConditionMapping: "record_test_condition_mapping",
		catalog: "project_exploration_catalog",
		mcpCall: "mcp_call_tool",
		gitStatus: "git_status",
		gitDiff: "git_diff",
		listDir: "list_dir",
		findFile: "find_file",
		readFile: "read_file",
	};
	return names[name] ?? name;
}

async function resolvedResult(mock: typeof mocks.listDir) {
	return mock.mock.results.at(-1)?.value;
}
