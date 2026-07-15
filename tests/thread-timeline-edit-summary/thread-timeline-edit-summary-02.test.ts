import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	buildNormalTranscriptItems,
	buildVisibleEditDiffSummary,
	getActivityCode,
	getToolArguments,
	getToolResult,
} from "../../src/modules/nightworkers/components/ThreadTimeline";
import { getAgentEditSummary } from "../../src/modules/nightworkers/components/ThreadTimelineAgentCards";
import {
	getVisibleCliCommandSummary,
	NormalTranscriptItemView,
} from "../../src/modules/nightworkers/components/ThreadTimelineNormalTranscript";

describe("ThreadTimeline edit summaries", () => {
	it("builds an apply_patch summary from a tool call start event", () => {
		const summary = getAgentEditSummary({
			id: "event-apply-patch-start",
			message: "[Worker Tool Call] Invoking tool apply_patch...",
			payloadJson: {
				toolName: "apply_patch",
				arguments: {
					patchContent: [
						"*** Begin Patch",
						"*** Update File: src/greeting.txt",
						"@@",
						"-hello",
						"+hello world",
						"*** End Patch",
					].join("\n"),
				},
			},
		} as never);

		expect(summary).toEqual({
			toolName: "apply_patch",
			sections: [{ path: "src/greeting.txt", added: 1, deleted: 1 }],
			codeBlocks: [
				{
					code: [
						"*** Begin Patch",
						"*** Update File: src/greeting.txt",
						"@@",
						"-hello",
						"+hello world",
						"*** End Patch",
					].join("\n"),
					filename: "apply_patch.patch",
					language: "diff",
				},
			],
		});
	});

	it("builds a CLI command summary from a persisted run_command event", () => {
		const summary = getVisibleCliCommandSummary({
			id: "event-run-command-finished",
			taskId: "task-1",
			kind: "tool.result",
			source: "worker",
			status: "completed",
			seq: 1,
			text: "[Worker Tool Result] Tool run_command execution SUCCESS.",
			payloadJson: {
				runEvent: {
					type: "tool.call_finished",
					data: {
						toolName: "run_command",
						arguments: { command: "pnpm test" },
						result: {
							ok: true,
							toolName: "run_command",
							payload: { command: "pnpm test", exitCode: 0 },
						},
					},
				},
			},
			createdAt: "2026-06-05T00:00:00.000Z",
			visibility: "visible",
		} as never);

		expect(summary).toEqual({ toolName: "run_command", command: "pnpm test" });
	});

	it("builds a visible command summary from Codex command_execution activity", () => {
		const summary = getVisibleCliCommandSummary({
			id: "activity-codex-command",
			taskId: "task-1",
			kind: "tool.call",
			source: "worker",
			seq: 1,
			text: "command_execution | pnpm test | in_progress",
			payloadJson: {
				payload: {
					provider: "codex",
					toolName: "command_execution",
					command: "pnpm test",
					status: "in_progress",
					aggregatedOutput: "running tests",
				},
			},
		} as never);

		expect(summary).toEqual({
			toolName: "command_execution",
			command: "pnpm test",
			output: "running tests",
		});
	});

	it("shows changed-file-only Codex diff detection as a code change card", () => {
		const event = {
			id: "activity-file-change",
			taskId: "task-1",
			kind: "file.diff",
			source: "worker",
			seq: 1,
			text: "Changed files (1)\nsrc/fizzbuzz.ts",
			payloadJson: {
				payload: {
					provider: "codex",
					changedFiles: ["src/fizzbuzz.ts"],
				},
			},
		} as never;

		expect(buildVisibleEditDiffSummary(event)).toEqual([
			{ path: "src/fizzbuzz.ts", added: 0, deleted: 0, changedOnly: true },
		]);
		expect(getActivityCode(event)).toBe("");
		expect(
			buildNormalTranscriptItems([
				{ kind: "activity", id: "activity-file-change", event },
			]).map((item) => item.id),
		).toEqual(["activity-file-change"]);
		const markup = renderToStaticMarkup(
			createElement(NormalTranscriptItemView, {
				item: { kind: "activity", id: "activity-file-change", event },
				onOpenArtifact: () => {},
			}),
		);
		expect(markup).toContain("コード変更");
		expect(markup).toContain("src/fizzbuzz.ts");
		expect(markup).not.toContain("changed-files.txt");
		expect(markup).not.toContain("nightworkers-code-block");
	});

	it("keeps each completed Codex file_change and drops its started duplicate", () => {
		const codexFileChange = (
			id: string,
			providerItemId: string,
			providerEventType: "item.started" | "item.completed",
		) =>
			({
				id,
				taskId: "task-1",
				runId: "run-1",
				kind: "file.diff",
				source: "worker",
				status: "completed",
				seq: id === "started" ? 1 : id === "completed-1" ? 2 : 3,
				payloadJson: {
					payload: {
						provider: "codex",
						providerItemId,
						providerEventType,
						status:
							providerEventType === "item.completed"
								? "completed"
								: "in_progress",
						changedFiles: ["src/app.ts"],
						changes: [{ path: "src/app.ts", kind: "update" }],
					},
				},
			}) as never;
		const started = codexFileChange("started", "file-change-1", "item.started");
		const completed1 = codexFileChange(
			"completed-1",
			"file-change-1",
			"item.completed",
		);
		const completed2 = codexFileChange(
			"completed-2",
			"file-change-2",
			"item.completed",
		);

		expect(buildVisibleEditDiffSummary(started)).toEqual([]);
		expect(buildVisibleEditDiffSummary(completed1)).toEqual([
			{
				path: "src/app.ts",
				added: 0,
				deleted: 0,
				changedOnly: true,
				changeKind: "update",
			},
		]);
		expect(
			buildNormalTranscriptItems([
				{ kind: "activity", id: "started", event: started },
				{ kind: "activity", id: "completed-1", event: completed1 },
				{ kind: "activity", id: "completed-2", event: completed2 },
			]).map((item) => item.id),
		).toEqual(["completed-1", "completed-2"]);

		const markup = renderToStaticMarkup(
			createElement(NormalTranscriptItemView, {
				item: { kind: "activity", id: "completed-1", event: completed1 },
				onOpenArtifact: () => {},
			}),
		);
		expect(markup).toContain("変更");
		expect(markup).toContain("src/app.ts");
		expect(markup).not.toContain("nightworkers-code-block");
	});

	it("compacts stored absolute Codex file paths in change-only cards", () => {
		const root = "/Users/example/Code/todolist";
		const event = {
			id: "absolute-file-change",
			taskId: "task-1",
			kind: "file.diff",
			source: "worker",
			seq: 1,
			payloadJson: {
				payload: {
					provider: "codex",
					changedFiles: [
						`${root}/api/app/hono.ts`,
						`${root}/api/db/schema.ts`,
						`${root}/shared/schemas/todo.ts`,
					],
				},
			},
		} as never;
		const markup = renderToStaticMarkup(
			createElement(NormalTranscriptItemView, {
				item: { kind: "activity", id: "absolute-file-change", event },
				onOpenArtifact: () => {},
			}),
		);

		expect(markup).toContain("api/app/hono.ts");
		expect(markup).toContain("shared/schemas/todo.ts");
		expect(markup).not.toContain(root);
		expect(markup).not.toContain("nightworkers-code-block");
	});

	it("keeps rendering collected git diff when it is available", () => {
		const diff = [
			"diff --git a/src/fizzbuzz.ts b/src/fizzbuzz.ts",
			"new file mode 100644",
			"--- /dev/null",
			"+++ b/src/fizzbuzz.ts",
			"@@ -0,0 +1 @@",
			"+export const fizzbuzz = true;",
		].join("\n");
		const event = {
			id: "activity-file-diff",
			taskId: "task-1",
			kind: "file.diff",
			source: "worker",
			seq: 1,
			payloadJson: {
				payload: {
					provider: "codex",
					changedFiles: ["src/fizzbuzz.ts"],
					diff,
				},
			},
		} as never;

		expect(buildVisibleEditDiffSummary(event)).toEqual([
			{ path: "src/fizzbuzz.ts", added: 1, deleted: 0 },
		]);
		expect(getActivityCode(event)).toBe(diff);
		const markup = renderToStaticMarkup(
			createElement(NormalTranscriptItemView, {
				item: { kind: "activity", id: "activity-file-diff", event },
				onOpenArtifact: () => {},
			}),
		);
		expect(markup).toContain("コード差分");
		expect(markup).toContain("+1");
		expect(markup).toContain("-0");
		expect(markup).toContain("nightworkers-diff-view");
		expect(markup).toContain("export const fizzbuzz = true;");
		expect(
			getAgentEditSummary({
				id: "event-file-diff",
				type: "info",
				eventType: "git.diff_collected",
				message: "[Codex] Workspace diff collected: 1 file(s).",
				payloadJson: {
					runEvent: {
						type: "git.diff_collected",
						data: {
							provider: "codex",
							source: "post_run_git_diff",
							changedFiles: ["src/fizzbuzz.ts"],
							diff,
						},
					},
				},
			} as never),
		).toMatchObject({
			toolName: "git_diff",
			sections: [{ path: "src/fizzbuzz.ts", added: 1, deleted: 0 }],
			codeBlocks: [
				{
					filename: "workspace.diff",
					language: "diff",
					code: diff,
				},
			],
		});
	});

	it("builds a CLI command summary from a schema-first tool.started event", () => {
		const summary = getVisibleCliCommandSummary({
			id: "event-run-verification-started",
			taskId: "task-1",
			runId: "run-1",
			kind: "tool.call",
			source: "worker",
			status: "started",
			seq: 1,
			text: "run_verification started",
			payloadJson: {
				runEvent: {
					runId: "run-1",
					type: "tool.call_started",
					data: {
						agentEventType: "tool.started",
						iteration: 3,
					},
				},
				agentEventType: "tool.started",
				payload: {
					toolName: "run_verification",
					arguments: { command: "pnpm typecheck", reason: "type safety" },
				},
			},
			createdAt: "2026-06-05T00:00:00.000Z",
			visibility: "visible",
		} as never);

		expect(summary).toEqual({
			toolName: "run_verification",
			command: "pnpm typecheck",
		});
	});

	it("builds an apply_patch summary from a custom tool call shaped payload", () => {
		const summary = getAgentEditSummary({
			id: "event-custom-apply-patch",
			message: "custom_tool_call apply_patch",
			payloadJson: {
				toolCall: {
					name: "apply_patch",
					arguments: {
						patchContent: [
							"*** Begin Patch",
							"*** Add File: src/new-file.txt",
							"+created",
							"*** End Patch",
						].join("\n"),
					},
				},
			},
		} as never);

		expect(summary?.toolName).toBe("apply_patch");
		expect(summary?.sections).toEqual([
			{ path: "src/new-file.txt", added: 1, deleted: 0 },
		]);
		expect(summary?.codeBlocks).toEqual([
			{
				code: [
					"*** Begin Patch",
					"*** Add File: src/new-file.txt",
					"+created",
					"*** End Patch",
				].join("\n"),
				filename: "apply_patch.patch",
				language: "diff",
			},
		]);
	});

	it("builds an apply_patch summary from native/api unified diff arguments", () => {
		const patchContent = [
			"diff --git a/src/app/page.tsx b/src/app/page.tsx",
			"new file mode 100644",
			"--- /dev/null",
			"+++ b/src/app/page.tsx",
			"@@ -0,0 +1,3 @@",
			"+export default function Page() {",
			"+  return null;",
			"+}",
		].join("\n");
		const event = {
			id: "native-apply-patch-started",
			taskId: "task-1",
			runId: "run-1",
			kind: "tool.call",
			source: "worker",
			status: "started",
			seq: 10,
			message: "[NativeApiRunner] apply_patch started.",
			payloadJson: {
				runEvent: {
					runId: "run-1",
					type: "tool.call_started",
					data: {
						callId: "call-apply-patch",
						toolName: "apply_patch",
						arguments: { patchContent },
					},
				},
			},
		} as never;

		expect(getAgentEditSummary(event)).toMatchObject({
			toolName: "apply_patch",
			sections: [{ path: "src/app/page.tsx", added: 3, deleted: 0 }],
		});
		expect(buildVisibleEditDiffSummary(event)).toEqual([
			{ path: "src/app/page.tsx", added: 3, deleted: 0 },
		]);
		expect(getActivityCode(event)).toContain("+++ b/src/app/page.tsx");
	});

	it("keeps native/api apply_patch result visible from changedFiles only", () => {
		const event = {
			id: "native-apply-patch-result",
			taskId: "task-1",
			runId: "run-1",
			kind: "tool.result",
			source: "worker",
			status: "completed",
			seq: 11,
			text: "apply_patch finished",
			message: "[NativeApiRunner] apply_patch finished.",
			payloadJson: {
				runEvent: {
					runId: "run-1",
					type: "tool.call_finished",
					data: {
						callId: "call-apply-patch",
						toolName: "apply_patch",
						ok: true,
						result: {
							applied: true,
							changedFiles: [
								"src/app/page.tsx",
								123,
								null,
								"src/app/layout.tsx",
							],
							stdout: "",
							stderr: "",
						},
					},
				},
			},
			createdAt: "2026-06-17T00:00:00.000Z",
			visibility: "visible",
		} as never;

		expect(getAgentEditSummary(event)?.sections).toEqual([
			{ path: "src/app/page.tsx", detail: "applied" },
			{ path: "src/app/layout.tsx", detail: "applied" },
		]);
		expect(buildVisibleEditDiffSummary(event)).toEqual([
			{ path: "src/app/page.tsx", added: 0, deleted: 0, changedOnly: true },
			{ path: "src/app/layout.tsx", added: 0, deleted: 0, changedOnly: true },
		]);
		expect(
			buildNormalTranscriptItems([
				{ kind: "activity", id: "activity:native-result", event },
			]).map((item) => item.id),
		).toEqual(["activity:native-result"]);
	});

	it("parses native/api delete-only unified diffs", () => {
		const event = {
			id: "native-apply-patch-delete",
			taskId: "task-1",
			runId: "run-1",
			kind: "tool.call",
			source: "worker",
			status: "started",
			seq: 12,
			payloadJson: {
				runEvent: {
					type: "tool.call_started",
					data: {
						toolName: "apply_patch",
						arguments: {
							patchContent: [
								"diff --git a/src/old.ts b/src/old.ts",
								"deleted file mode 100644",
								"--- a/src/old.ts",
								"+++ /dev/null",
								"@@ -1,2 +0,0 @@",
								"-export const old = true;",
								"-export const stale = true;",
							].join("\n"),
						},
					},
				},
			},
		} as never;

		expect(buildVisibleEditDiffSummary(event)).toEqual([
			{ path: "src/old.ts", added: 0, deleted: 2 },
		]);
	});

	it("preserves legacy helper null results for started events without result payloads", () => {
		const payload = {
			runEvent: {
				type: "tool.call_started",
				data: {
					toolName: "read_file",
				},
			},
		};

		expect(getToolArguments(payload)).toBeNull();
		expect(getToolResult(payload)).toBeNull();
	});

	it("does not mistake ordinary payload kind fields for activity event wrappers", () => {
		expect(
			getToolArguments({
				toolName: "inspect_structure",
				kind: "tsx",
				arguments: { filePath: "src/app/page.tsx" },
			}),
		).toEqual({ filePath: "src/app/page.tsx" });
	});

	it("builds a replace_content summary from tool arguments", () => {
		const summary = getAgentEditSummary({
			id: "event-replace-content-start",
			message: "[Worker Tool Call] Invoking tool replace_content...",
			payloadJson: {
				toolName: "replace_content",
				arguments: {
					filePath: "src/greeting.txt",
					needle: "hello",
					replacement: "hello world",
				},
			},
		} as never);

		expect(summary).toEqual({
			toolName: "replace_content",
			sections: [
				{
					path: "src/greeting.txt",
					added: 1,
					deleted: 1,
					detail: "replacement requested",
				},
			],
			codeBlocks: [
				{
					code: [
						"--- src/greeting.txt",
						"+++ src/greeting.txt",
						"# replacement requested",
						"- hello",
						"+ hello world",
					].join("\n"),
					filename: "src/greeting.txt.replace.diff",
					language: "diff",
				},
			],
		});
	});

	it("uses replace_content result filePath when arguments are absent", () => {
		const event = {
			id: "native-replace-content-result",
			taskId: "task-1",
			runId: "run-1",
			kind: "tool.result",
			source: "worker",
			status: "completed",
			seq: 13,
			payloadJson: {
				runEvent: {
					type: "tool.call_finished",
					data: {
						toolName: "replace_content",
						ok: true,
						result: {
							applied: true,
							occurrences: 1,
							filePath: "src/greeting.txt",
						},
					},
				},
			},
		} as never;

		expect(buildVisibleEditDiffSummary(event)).toEqual([
			{ path: "src/greeting.txt", added: 0, deleted: 0 },
		]);
	});
});
