import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execFile: vi.fn(),
	canonicalizeTaskEvent: vi.fn(),
	changedFilesFromDiff: vi.fn(),
	getTaskRun: vi.fn(),
	getTask: vi.fn(),
	getRepository: vi.fn(),
	listTaskEventsForRun: vi.fn(),
	listTaskMessages: vi.fn(),
	parseChangedPathsFromDiff: vi.fn(),
	toErrorMessage: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: (
		file: string,
		args: string[],
		options: Record<string, unknown>,
		callback: (error: unknown, result?: unknown) => void,
	) => {
		mocks
			.execFile(file, args, options)
			.then((result) => callback(null, result))
			.catch((error) => callback(error));
	},
}));

vi.mock("../api/services/run-events/canonicalize", () => ({
	canonicalizeTaskEvent: mocks.canonicalizeTaskEvent,
}));

vi.mock("../api/modules/codingAgent", () => ({
	changedFilesFromDiff: mocks.changedFilesFromDiff,
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getTaskRun: mocks.getTaskRun,
	getTask: mocks.getTask,
	getRepository: mocks.getRepository,
	listTaskEventsForRun: mocks.listTaskEventsForRun,
	listTaskMessages: mocks.listTaskMessages,
}));

vi.mock("../api/modules/nightworkers/run-orchestration/git-ownership", () => ({
	parseChangedPathsFromDiff: mocks.parseChangedPathsFromDiff,
}));

vi.mock("../api/modules/nightworkers/run-orchestration/utils", () => ({
	toErrorMessage: mocks.toErrorMessage,
}));

import {
	buildReviewTarget,
	findLatestPlanArtifact,
} from "../api/modules/review/review-targets.service";

const run = {
	id: "run-1",
	taskId: "task-1",
	repositoryId: "repository-1",
	worktreePath: null,
	diffPatch: "run-one-diff",
};

const task = {
	id: "task-1",
	repositoryId: "repository-1",
};

const repository = {
	id: "repository-1",
	localPath: "/repo/root",
};

function gitResult(stdout = "", stderr = "") {
	return { stdout, stderr };
}

function statusToken(status: string, filePath: string) {
	return `${status} ${filePath}\0`;
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.getTaskRun.mockResolvedValue(run);
	mocks.getTask.mockResolvedValue(task);
	mocks.getRepository.mockResolvedValue(repository);
	mocks.listTaskEventsForRun.mockResolvedValue([]);
	mocks.listTaskMessages.mockResolvedValue([]);
	mocks.canonicalizeTaskEvent.mockImplementation((row) => row);
	mocks.changedFilesFromDiff.mockReturnValue([]);
	mocks.parseChangedPathsFromDiff.mockReturnValue([]);
	mocks.toErrorMessage.mockImplementation((error: unknown) =>
		error instanceof Error ? error.message : String(error),
	);
	mocks.execFile.mockResolvedValue(gitResult());
});

describe("review targets service extra coverage", () => {
	it("validates run, repository ownership, and workspace availability", async () => {
		mocks.getTaskRun.mockResolvedValueOnce(null);
		await expect(buildReviewTarget({ runId: "missing" })).rejects.toMatchObject(
			{
				statusCode: 404,
			},
		);

		mocks.getTaskRun.mockResolvedValueOnce({
			...run,
			repositoryId: null,
		});
		mocks.getTask.mockResolvedValueOnce(null);
		await expect(buildReviewTarget({ runId: run.id })).rejects.toThrow(
			"Repository not found for run",
		);

		mocks.getTaskRun.mockResolvedValueOnce({
			...run,
			repositoryId: null,
		});
		mocks.getTask.mockResolvedValueOnce(task);
		mocks.getRepository.mockResolvedValueOnce(null);
		await expect(buildReviewTarget({ runId: run.id })).rejects.toThrow(
			"Repository not found",
		);

		mocks.getRepository.mockResolvedValueOnce({
			...repository,
			localPath: "",
		});
		await expect(buildReviewTarget({ runId: run.id })).rejects.toThrow(
			"Repository not found",
		);
	});

	it("returns empty discovery warnings with task repository and worktree fallbacks", async () => {
		mocks.getTaskRun.mockResolvedValueOnce({
			...run,
			repositoryId: null,
			worktreePath: "/repo/worktree",
		});
		const result = await buildReviewTarget({ runId: run.id });
		expect(result).toMatchObject({
			repositoryId: task.repositoryId,
			repoRoot: "/repo/worktree",
			targetFiles: [],
			planArtifact: { messageId: null, title: null, source: "missing" },
		});
		expect(result.warnings.map((warning) => warning.code)).toEqual([
			"no_edit_signals",
			"plan_artifact_missing",
		]);
	});

	it("discovers, normalizes, merges, maps, and sorts all current target signals", async () => {
		const secondRun = {
			...run,
			id: "run-2",
			diffPatch: "run-two-diff",
		};
		const foreignRun = { ...run, id: "foreign", taskId: "other-task" };
		mocks.getTaskRun.mockImplementation(async (id: string) => {
			if (id === run.id) return run;
			if (id === secondRun.id) return secondRun;
			if (id === "foreign") return foreignRun;
			return null;
		});
		mocks.listTaskEventsForRun.mockImplementation(async (runId: string) => {
			if (runId === run.id) {
				return [
					{ id: "ignored", type: "run.started", data: {} },
					{ id: "invalid-data", type: "git.diff_collected", data: [] },
					{
						id: "codex-event",
						type: "git.diff_collected",
						data: {
							provider: "codex",
							changedFiles: [
								"a/src/a.ts",
								"b/src/b.ts",
								123,
								"",
								"bad\0path.ts",
								"../outside.ts",
								"/repo/root/src/absolute.ts",
								"/outside.ts",
							],
							changes: [
								null,
								{ path: '"src/quoted.ts"' },
								{ file: "src\\windows.ts" },
							],
							diff: "event-diff",
						},
					},
					{
						id: "tool-event",
						type: "git.diff_collected",
						data: {
							source: "native-tool",
							changedFiles: ["src/tool.ts", "src/fail.ts"],
						},
					},
				];
			}
			return [
				{
					id: "",
					type: "git.diff_collected",
					data: { source: "worker", changedFiles: ["src/default.ts"] },
				},
			];
		});
		mocks.changedFilesFromDiff.mockImplementation((diff: string) =>
			diff === "event-diff" ? ["src/from-event-diff.ts"] : [],
		);
		mocks.parseChangedPathsFromDiff.mockImplementation((diff: string) => {
			if (diff === "run-one-diff")
				return ["src/from-run-patch.ts", "src/a.ts", "../invalid-patch.ts"];
			if (diff === "run-two-diff") return ["src/from-second-run.ts"];
			return [];
		});

		const dirtyPaths = [
			statusToken("??", "src/a.ts"),
			statusToken("A ", "src/b.ts"),
			statusToken(" D", "src/quoted.ts"),
			statusToken(" M", "src/windows.ts"),
			statusToken("R ", "src/from-event-diff.ts"),
			"src/renamed-destination.ts\0",
			statusToken("C ", "src/from-run-patch.ts"),
			"src/copied-destination.ts\0",
			statusToken("  ", "src/default.ts"),
			statusToken("??", "src/tool.ts"),
			statusToken(" M", "src/fail.ts"),
			statusToken(" M", "unrelated.ts"),
			"?? \0",
		].join("");
		mocks.execFile.mockImplementation(async (_file: string, args: string[]) => {
			if (args[0] === "status") return gitResult(dirtyPaths);
			const filePath = args.at(-1) ?? "";
			if (args.includes("--no-index")) {
				if (filePath === "src/a.ts") return gitResult("untracked a diff");
				if (filePath === "src/tool.ts") {
					throw { stdout: "untracked tool diff" };
				}
				return gitResult();
			}
			if (filePath === "src/fail.ts") throw new Error("path diff failed");
			return args.includes("--cached")
				? gitResult(`staged ${filePath}`)
				: gitResult(`unstaged ${filePath}`);
		});
		mocks.listTaskMessages.mockResolvedValue([
			{
				id: "plan-1",
				messageType: "markdown_document",
				content: "# Feature Plan\nbody",
				metadataJson: { intent: "feature_plan", title: "Plan title" },
			},
		]);

		const result = await buildReviewTarget({
			runId: run.id,
			runIds: [run.id, secondRun.id, "missing", "foreign"],
		});
		expect(result.planArtifact).toEqual({
			messageId: "plan-1",
			title: "Plan title",
			source: "plan_artifact",
		});
		expect(result.targetFiles.map((file) => file.path)).toEqual(
			[...result.targetFiles.map((file) => file.path)].sort(),
		);
		expect(
			result.targetFiles.find((file) => file.path === "src/a.ts"),
		).toMatchObject({
			status: "added",
			diff: "untracked a diff",
			sources: expect.arrayContaining([
				"codex_file_change",
				"run_diff_patch",
				"current_git_diff",
			]),
			eventIds: ["codex-event"],
		});
		expect(
			result.targetFiles.find((file) => file.path === "src/tool.ts")?.diff,
		).toBe("untracked tool diff");
		expect(
			result.targetFiles.find((file) => file.path === "src/fail.ts")?.diff,
		).toBe("");
		expect(
			result.targetFiles.find((file) => file.path === "src/default.ts")?.status,
		).toBe("unknown");
		expect(result.signalOnlyFiles).toEqual(
			expect.arrayContaining(["src/absolute.ts", "src/from-second-run.ts"]),
		);
		expect(result.diffOnlyFiles).toEqual(
			expect.arrayContaining([
				"src/copied-destination.ts",
				"src/renamed-destination.ts",
				"unrelated.ts",
			]),
		);
		expect(result.warnings.map((warning) => warning.code)).toEqual(
			expect.arrayContaining([
				"diff_read_failed",
				"edit_signal_without_current_diff",
				"current_diff_without_edit_signal",
			]),
		);
	});

	it("maps deleted, renamed, copied, modified, and unknown dirty statuses", async () => {
		mocks.parseChangedPathsFromDiff.mockReturnValue([
			"deleted.ts",
			"renamed.ts",
			"copied.ts",
			"modified.ts",
			"unknown.ts",
		]);
		mocks.execFile.mockImplementation(async (_file: string, args: string[]) => {
			if (args[0] === "status") {
				return gitResult(
					[
						statusToken(" D", "deleted.ts"),
						statusToken("R ", "renamed.ts"),
						"rename-target.ts\0",
						statusToken("C ", "copied.ts"),
						"copy-target.ts\0",
						statusToken(" M", "modified.ts"),
						statusToken("  ", "unknown.ts"),
					].join(""),
				);
			}
			return gitResult();
		});
		const result = await buildReviewTarget({ runId: run.id });
		expect(
			Object.fromEntries(
				result.targetFiles.map((file) => [file.path, file.status]),
			),
		).toMatchObject({
			"deleted.ts": "deleted",
			"renamed.ts": "renamed",
			"copied.ts": "modified",
			"modified.ts": "modified",
			"unknown.ts": "unknown",
		});
	});

	it("limits oversized signal sets and reports every signal as stale", async () => {
		const paths = Array.from(
			{ length: 82 },
			(_, index) => `src/file-${index}.ts`,
		);
		mocks.parseChangedPathsFromDiff.mockReturnValue(paths);
		const result = await buildReviewTarget({ runId: run.id });
		const limitWarning = result.warnings.find(
			(warning) => warning.code === "target_file_limit_exceeded",
		);
		expect(limitWarning).toMatchObject({
			severity: "blocking",
			paths: ["src/file-80.ts", "src/file-81.ts"],
		});
		expect(result.signalOnlyFiles).toHaveLength(82);
	});

	it("converts git status and path diff failures into blocking and warning results", async () => {
		mocks.parseChangedPathsFromDiff.mockReturnValue(["src/fail.ts"]);
		mocks.execFile.mockRejectedValueOnce("git unavailable");
		const result = await buildReviewTarget({ runId: run.id });
		expect(result.warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "diff_read_failed",
					severity: "blocking",
					message: expect.stringContaining("git unavailable"),
				}),
			]),
		);
	});

	it("uses stderr and empty fallbacks for failed untracked diffs", async () => {
		mocks.parseChangedPathsFromDiff.mockReturnValue(["stderr.ts", "empty.ts"]);
		mocks.execFile.mockImplementation(async (_file: string, args: string[]) => {
			if (args[0] === "status") {
				return gitResult(
					statusToken("??", "stderr.ts") + statusToken("??", "empty.ts"),
				);
			}
			if (args.includes("--no-index")) {
				if (args.at(-1) === "stderr.ts") throw { stderr: "stderr diff" };
				throw {};
			}
			return args.includes("--cached")
				? gitResult("staged fallback")
				: gitResult("");
		});
		const result = await buildReviewTarget({ runId: run.id });
		expect(
			result.targetFiles.find((file) => file.path === "stderr.ts")?.diff,
		).toBe("stderr diff");
		expect(
			result.targetFiles.find((file) => file.path === "empty.ts")?.diff,
		).toBe("staged fallback");
	});

	it("selects the latest valid plan and derives optional Markdown titles", async () => {
		mocks.listTaskMessages.mockResolvedValueOnce([
			{
				id: "feature",
				messageType: "markdown_document",
				content: "# Feature heading\nbody",
				metadataJson: { intent: "feature_plan", title: "Explicit title" },
			},
			{
				id: "invalid-intent",
				messageType: "markdown_document",
				content: "# Invalid",
				metadataJson: { intent: "other" },
			},
			{
				id: "not-markdown",
				messageType: "text",
				content: "# Text",
				metadataJson: { intent: "implementation_plan" },
			},
			{
				id: "latest",
				messageType: "markdown_document",
				content: "intro\n# Latest heading  \nbody",
				metadataJson: { intent: "implementation_plan", title: 123 },
			},
		]);
		await expect(findLatestPlanArtifact(task.id)).resolves.toEqual({
			id: "latest",
			title: "Latest heading",
			body: "intro\n# Latest heading  \nbody",
		});

		mocks.listTaskMessages.mockResolvedValueOnce([
			{
				id: "no-title",
				messageType: "markdown_document",
				content: "No heading",
				metadataJson: ["invalid"],
			},
		]);
		await expect(findLatestPlanArtifact(task.id)).resolves.toBeNull();

		mocks.listTaskMessages.mockResolvedValueOnce([
			{
				id: "no-heading",
				messageType: "markdown_document",
				content: "No heading",
				metadataJson: { intent: "feature_plan" },
			},
		]);
		await expect(findLatestPlanArtifact(task.id)).resolves.toEqual({
			id: "no-heading",
			title: null,
			body: "No heading",
		});

		mocks.listTaskMessages.mockResolvedValueOnce([
			{
				id: "plain-text",
				messageType: "text",
				content: "not a plan",
				metadataJson: { intent: "feature_plan" },
			},
		]);
		await expect(findLatestPlanArtifact(task.id)).resolves.toBeNull();

		mocks.listTaskMessages.mockResolvedValueOnce([]);
		await expect(findLatestPlanArtifact(task.id)).resolves.toBeNull();
	});
});
