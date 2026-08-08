import { describe, expect, it } from "vitest";
import {
	buildNativeApiModelVisibleSummary,
	capNativeApiToolResultContent,
	projectWorkerResultToMcpStructuredPayload,
	projectWorkerResultToNativeApiToolResult,
} from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-result-projector";

function worker(
	toolName: string,
	payload: unknown,
	overrides: Record<string, unknown> = {},
) {
	return {
		ok: true,
		toolName,
		startedAt: "2026-08-08T00:00:00Z",
		finishedAt: "2026-08-08T00:00:01Z",
		payload,
		...overrides,
	} as never;
}

function visible(
	toolName: string,
	payload: unknown,
	overrides: Record<string, unknown> = {},
) {
	return JSON.parse(
		projectWorkerResultToNativeApiToolResult(
			worker(toolName, payload, overrides),
		).content,
	).payload;
}

describe("native API tool result projector coverage", () => {
	it("preserves ordinary payloads and projects every error field variant", () => {
		let result = projectWorkerResultToNativeApiToolResult(
			worker("ordinary", { value: 1 }),
		);
		expect(JSON.parse(result.content)).toMatchObject({
			modelVisiblePayload: "full",
			payload: { value: 1 },
		});
		result = projectWorkerResultToNativeApiToolResult(
			worker("ordinary", null, {
				ok: false,
				error: {
					code: "FAILED",
					message: "failed",
					retryable: false,
					recovery: { action: "retry" },
				},
			}),
		);
		expect(result.error).toEqual({
			code: "FAILED",
			message: "failed",
			retryable: false,
			recovery: { action: "retry" },
		});
		result = projectWorkerResultToNativeApiToolResult(
			worker("ordinary", null, {
				ok: false,
				error: { code: "FAILED", message: "failed" },
			}),
		);
		expect(result.error).toEqual({ code: "FAILED", message: "failed" });
	});

	it("projects Todo guidance and full progress variants", () => {
		expect(
			visible("todo_list", {
				intentStatus: "needs_plan",
				guidance: { message: "Plan first" },
			}),
		).toEqual({
			intentStatus: "needs_plan",
			guidance: { message: "Plan first" },
		});
		const payload = visible("todo_list", {
			command: { op: 1 },
			todos: [
				{ title: "Pending", status: "pending" },
				{ title: "Running", status: "running" },
				{ title: "Passed", status: "passed" },
				{ title: "Skipped", status: "skipped" },
				{
					title: "Blocked",
					status: "needs_human",
					humanBlockerJson: { reason: "input" },
				},
				{ title: "Unknown", status: 1 },
			],
			currentTodo: {
				title: "Running",
				status: "running",
				systemContext: "context",
				lastFailure: "failure",
				attemptCount: 2,
			},
		});
		expect(payload).toMatchObject({
			progress: {
				total: 6,
				pending: 1,
				running: 1,
				passed: 1,
				skipped: 1,
				needsHuman: 1,
				terminal: 2,
			},
			currentTodo: {
				systemContext: "context",
				lastFailure: "failure",
				attemptCount: 2,
			},
			nextTodo: { title: "Pending", status: "pending" },
			humanBlocker: { reason: "input" },
		});
		expect(
			visible("todo_list", { todos: [], currentTodo: "bad" }),
		).toMatchObject({ currentTodo: null, nextTodo: null, humanBlocker: null });
		expect(
			visible("todo_list", { todos: [], currentTodo: { context: "legacy" } })
				.currentTodo,
		).toMatchObject({
			systemContext: "legacy",
			lastFailure: null,
			attemptCount: 0,
		});
	});

	it("projects template, git, empty, and post-import variants", () => {
		const files = Array.from({ length: 25 }, (_, index) => `file-${index}`);
		const payload = visible("import_project", {
			mode: "template",
			template: {
				templateId: "starter",
				variant: "full",
				targetPath: "/repo",
				files,
			},
			git: {
				repoUrl: "https://example.test/repo",
				ref: "main",
				targetPath: "/repo",
				command: ["git", "clone"],
			},
			postImport: {
				targetPath: "/repo",
				manifest: {
					status: "found",
					packageName: "app",
					scripts: { test: "vitest" },
					recommendedVerificationCommands: ["test"],
					notableFiles: ["package.json"],
				},
				llmContext: {
					status: "missing",
					path: null,
					rawContent: 2,
					errorMessage: "none",
				},
				gitInitialization: {
					status: "passed",
					command: ["git", "init"],
					baselineCommit: null,
				},
				initialization: {
					status: "skipped",
					command: null,
					skippedReason: "existing",
					errorMessage: null,
				},
			},
		});
		expect(payload.template).toMatchObject({
			fileCount: 25,
			files: files.slice(0, 20),
		});
		expect(payload.git.repoUrl).toContain("example.test");
		expect(payload.postImport.llmContext.rawContentDigest).toBeNull();
		expect(payload.postImport.gitInitialization.baselineCommit).toBeUndefined();
		expect(
			visible("import_project", { template: null, git: [], postImport: null }),
		).toMatchObject({ template: null, git: null, postImport: null });
	});

	it("returns full specifications and compacts normal long documents", () => {
		const full = {
			view: "full",
			content: "complete",
			secret: { retained: true },
		};
		expect(
			projectWorkerResultToMcpStructuredPayload(
				worker("read_current_specification", full),
			),
		).toBe(full);
		const content = `# Title\n${"body\n".repeat(2000)}## Tail\n${"end".repeat(1000)}`;
		const payload = visible("read_current_specification", {
			taskId: "task-1",
			found: true,
			view: "compact",
			content,
			fullContentChars: Number.NaN,
			digest: 1,
			assembledDesignContext: {
				taskId: "task-1",
				summary: "s".repeat(1300),
				sections: Array.from({ length: 14 }, (_, index) => ({
					kind: `kind-${index}`,
					title: `Section ${index}`,
					content: "c".repeat(index === 0 ? 1700 : 10),
				})),
			},
		});
		expect(payload.digest).toBeNull();
		expect(payload.contentChars).toBe(content.length);
		expect(payload.compactContent).toContain("[specification-compact-view]");
		expect(payload.assembledDesignContext.summary).toContain(
			"[summary-truncated]",
		);
		expect(payload.assembledDesignContext.sections).toHaveLength(12);
		expect(payload.assembledDesignContext.sections[0].content).toContain(
			"[section-truncated]",
		);
		expect(
			visible("read_current_specification", {
				view: "compact",
				content: "short",
				assembledDesignContext: null,
			}).compactContent,
		).toBe("short");
	});

	it("compacts rich verification documents, test cases, commands, and checklist evidence", () => {
		const conditions = Array.from({ length: 10 }, (_, index) => ({
			id: `AC-${index}`,
			text: "text".repeat(200),
			category: "behavior",
			verificationKind: "test",
			expectedEvidence: "test output",
			expectedResult: "result".repeat(200),
			failureMeaning: "failure".repeat(200),
			testCase:
				index === 0
					? {
							target: "target".repeat(200),
							preconditions: ["pre".repeat(200)],
							action: "act".repeat(200),
							assertions: ["assert".repeat(200)],
						}
					: null,
			required: true,
		}));
		const payload = visible("read_current_specification", {
			view: "verification",
			content: "x".repeat(1700),
			verification: {
				verificationDocumentId: "doc-1",
				verificationArtifactId: "artifact-1",
				summary: "summary",
				document: {
					version: 1,
					specId: "spec",
					specPath: "spec.md",
					generatedAt: "now",
					conditions,
					commands: [
						{
							id: "cmd",
							label: "Test",
							command: "test",
							cwd: "/repo",
							conditionIds: ["AC-0"],
						},
					],
				},
				checklist: [
					{
						conditionId: "AC-0",
						text: "check".repeat(100),
						required: true,
						status: "passed",
						evidenceIds: [1, 2, 3, 4, 5, 6],
						lastCheckedAt: "now",
						reason: "ok",
					},
				],
			},
		});
		expect(payload.compactContent).toContain(
			"[verification-spec-content-truncated]",
		);
		expect(payload.assembledDesignContext).toBeUndefined();
		expect(payload.verification.document.conditions[0].text).toContain(
			"[truncated]",
		);
		expect(
			payload.verification.document.conditions[0].testCase.target,
		).toContain("[truncated]");
		expect(
			payload.verification.document.conditions[1].testCase,
		).toBeUndefined();
		expect(payload.verification.checklist[0]).toMatchObject({
			evidenceIds: [2, 3, 4, 5, 6],
			evidenceCount: 6,
		});
		expect(
			visible("read_current_specification", {
				view: "verification",
				content: "short",
				verification: {},
			}).verification,
		).toBeUndefined();
	});

	it("summarizes short and long git diffs", () => {
		const short = "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new";
		let payload = visible("git_diff", {
			hasChanges: true,
			diffStat: "1 file",
			diff: short,
		});
		expect(payload).toMatchObject({
			fileCount: 1,
			hunkCount: 1,
			insertions: 1,
			deletions: 1,
			compactDiff: short,
		});
		expect(payload.files[0]).toEqual({ oldPath: "a.ts", path: "a.ts" });
		const long = `${short}\n${"line\n".repeat(2000)}`;
		payload = visible("git_diff", { hasChanges: true, diff: long });
		expect(payload.compactDiff).toContain("[git-diff-compact-view]");
		expect(visible("git_diff", { diff: null }).diffChars).toBe(0);
	});

	it("projects catalog, run-check, completion receipt, inventory, and mapping variants", () => {
		expect(
			visible("project_exploration_catalog", {
				status: "unavailable",
				catalog: null,
			}),
		).toEqual({
			status: "unavailable",
			catalog: null,
			fallbackToRepositoryExploration: true,
		});
		expect(
			visible("project_exploration_catalog", {
				status: "available",
				catalog: {},
			}).fallbackToRepositoryExploration,
		).toBe(false);
		expect(
			visible("run_check", {
				checkKind: "lint",
				status: "failed",
				reason: "errors",
			}),
		).toEqual({ status: "failed", reason: "errors" });
		expect(
			visible("run_check", {
				checkKind: "test",
				status: "evidence_error",
				retryable: true,
				structuredCaseCount: 1,
				resolvedCaseCount: 0,
			}),
		).toMatchObject({ retryable: true });
		expect(
			visible("completion_check", {
				result: {
					ok: true,
					reason: undefined,
					assurance: { receiptDigest: "receipt" },
				},
			}),
		).toMatchObject({ ready: true, reason: null, receiptDigest: "receipt" });
		expect(visible("collect_test_inventory", { cases: "bad" })).toMatchObject({
			nextCursor: null,
			cases: [],
		});
		expect(
			visible("record_test_condition_mapping", {
				inventoryId: "i",
				definitionDigest: "d",
				selectionCount: 2,
				mappingCount: 1,
				selections: ["a"],
			}),
		).toEqual({
			inventoryId: "i",
			definitionDigest: "d",
			selectionCount: 2,
			mappingCount: 1,
			selections: ["a"],
		});
	});

	it("bounds oversized structured payload and tool result content", () => {
		const payload = projectWorkerResultToMcpStructuredPayload(
			worker("ordinary", { text: "x".repeat(20_000) }),
		) as Record<string, unknown>;
		expect(payload).toMatchObject({
			modelVisiblePayload: "compact",
			toolName: "ordinary",
			truncated: true,
		});
		expect(payload.originalChars).toBeGreaterThan(12_000);
		const capped = capNativeApiToolResultContent(
			{ ok: true, content: "x".repeat(1000), payload: null } as never,
			{ contentLimitChars: 100, omittedReason: "test_limit" },
		);
		expect(capped.content.length).toBeLessThan(1000);
		expect(capped.modelVisibleSummary?.omittedReason).toBe("test_limit");
		const summary = buildNativeApiModelVisibleSummary({
			content: "x".repeat(1000),
			contentLimitChars: 100,
		});
		expect(summary.truncated).toBe(true);
	});
});
