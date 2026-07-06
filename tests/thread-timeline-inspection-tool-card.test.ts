import { describe, expect, it } from "vitest";
import { buildNormalTranscriptItems } from "../src/modules/nightworkers/components/ThreadTimeline";
import { getInspectionToolCardModel } from "../src/modules/nightworkers/components/ThreadTimelineInspectionToolCard";

describe("ThreadTimeline inspection tool cards", () => {
	it("extracts read_file started details", () => {
		const card = getInspectionToolCardModel({
			kind: "tool.call",
			status: "started",
			payloadJson: {
				runEvent: {
					type: "tool.call_started",
					data: {
						agentEventType: "tool.started",
						iteration: 3,
					},
				},
				agentEventType: "tool.started",
				payload: {
					toolName: "read_file",
					arguments: {
						filePath: "src/routes/root.tsx",
						startLine: 10,
						endLine: 30,
						fresh: true,
					},
				},
			},
		});

		expect(card).toMatchObject({
			lifecycle: "started",
			status: "started",
			toolName: "read_file",
			title: "Read file",
			target: "src/routes/root.tsx",
			badges: ["fresh"],
		});
		expect(card?.options).toContainEqual({
			label: "requested",
			value: "10-30",
		});
	});

	it("extracts read_file cached result details", () => {
		const card = getInspectionToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				runEvent: {
					type: "tool.call_finished",
					data: {
						agentEventType: "tool.finished",
						iteration: 3,
					},
				},
				agentEventType: "tool.finished",
				payload: {
					step: 3,
					toolName: "read_file",
					ok: true,
					arguments: {
						filePath: "src/routes/root.tsx",
					},
					payload: {
						totalLines: 84,
						linesReturned: 0,
						startLine: 0,
						endLine: 0,
						cached: true,
						truncated: true,
						compression: { strategy: "read_cache_marker" },
					},
				},
			},
		});

		expect(card).toMatchObject({
			lifecycle: "result",
			status: "ok",
			toolName: "read_file",
			target: "src/routes/root.tsx",
			badges: ["cached", "truncated", "read_cache_marker"],
		});
		expect(card?.metrics).toContainEqual({
			label: "lines",
			value: "0-0 / total 84",
		});
		expect(card?.metrics).toContainEqual({ label: "returned", value: "0" });
	});

	it("extracts native/api read_file result payload directly from runEvent data", () => {
		const card = getInspectionToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				runEvent: {
					type: "tool.call_finished",
					data: {
						callId: "call-read-file",
						toolName: "read_file",
						arguments: {
							filePath: "src/app/page.tsx",
							startLine: 1,
							endLine: 20,
						},
						ok: true,
						result: {
							content: "1: export default function Page() {}",
							totalLines: 42,
							linesReturned: 20,
							startLine: 1,
							endLine: 20,
							cached: false,
							truncated: false,
						},
					},
				},
			},
		});

		expect(card).toMatchObject({
			lifecycle: "result",
			status: "ok",
			toolName: "read_file",
			target: "src/app/page.tsx",
		});
		expect(card?.options).toContainEqual({ label: "requested", value: "1-20" });
		expect(card?.metrics).toContainEqual({
			label: "lines",
			value: "1-20 / total 42",
		});
		expect(card?.metrics).toContainEqual({ label: "returned", value: "20" });
	});

	it("extracts list_dir result counts and preview", () => {
		const card = getInspectionToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				runEvent: {
					type: "tool.call_finished",
					data: {
						agentEventType: "tool.finished",
						iteration: 4,
					},
				},
				agentEventType: "tool.finished",
				payload: {
					step: 4,
					toolName: "list_dir",
					ok: true,
					arguments: {
						relativePath: "src/modules",
						recursive: true,
						maxEntries: 20,
					},
					payload: {
						dirs: ["src/modules/nightworkers"],
						files: ["src/modules/nightworkers/index.ts"],
						truncated: false,
					},
				},
			},
		});

		expect(card).toMatchObject({
			lifecycle: "result",
			status: "ok",
			toolName: "list_dir",
			title: "List directory",
			target: "src/modules",
		});
		expect(card?.options).toContainEqual({ label: "recursive", value: "true" });
		expect(card?.metrics).toContainEqual({ label: "dirs", value: "1" });
		expect(card?.metrics).toContainEqual({ label: "files", value: "1" });
		expect(card?.preview).toContain("src/modules/nightworkers/index.ts");
	});

	it("extracts search_files query and matches", () => {
		const card = getInspectionToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				runEvent: {
					type: "tool.call_finished",
					data: {
						agentEventType: "tool.finished",
					},
				},
				agentEventType: "tool.finished",
				payload: {
					toolName: "search_files",
					ok: true,
					arguments: {
						query: "read_file",
						glob: "*.ts",
					},
					payload: {
						count: 1,
						engine: "ripgrep",
						matches: [
							{ filePath: "api/tool.ts", lineNumber: 12, excerpt: "read_file" },
						],
					},
				},
			},
		});

		expect(card).toMatchObject({
			toolName: "search_files",
			query: "read_file",
		});
		expect(card?.options).toContainEqual({ label: "glob", value: "*.ts" });
		expect(card?.metrics).toContainEqual({ label: "matches", value: "1" });
		expect(card?.preview).toContain("api/tool.ts:12:read_file");
	});

	it("extracts git_status summary", () => {
		const card = getInspectionToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				runEvent: {
					type: "tool.call_finished",
					data: {
						toolName: "git_status",
						result: {
							ok: true,
							toolName: "git_status",
							payload: {
								branch: "feature/tool-cards",
								isDirty: true,
								modifiedCount: 2,
								untrackedCount: 1,
								shortStatus: " M src/file.ts\n?? spec/plan.md",
							},
						},
					},
				},
			},
		});

		expect(card).toMatchObject({
			toolName: "git_status",
			target: "feature/tool-cards",
			badges: ["dirty"],
			preview: " M src/file.ts\n?? spec/plan.md",
		});
		expect(card?.metrics).toContainEqual({ label: "modified", value: "2" });
		expect(card?.metrics).toContainEqual({ label: "untracked", value: "1" });
	});

	it("keeps inspection tool cards visible in normal transcript mode", () => {
		const items = buildNormalTranscriptItems([
			{
				kind: "user_turn",
				id: "user:1",
				turnId: "user-1",
				events: [],
				text: "ファイルを確認して",
			},
			{
				kind: "activity",
				id: "activity:read-file",
				event: {
					id: "read-file",
					taskId: "task-1",
					runId: "run-1",
					kind: "tool.call",
					source: "worker",
					status: "started",
					seq: 1,
					text: "read_file started",
					payloadJson: {
						runEvent: {
							runId: "run-1",
							type: "tool.call_started",
							data: {
								agentEventType: "tool.started",
								iteration: 2,
							},
						},
						agentEventType: "tool.started",
						payload: {
							toolName: "read_file",
							arguments: { filePath: "src/routes/root.tsx" },
						},
					},
					createdAt: "2026-06-16T00:00:00.000Z",
					visibility: "visible",
				} as never,
			},
		]);

		expect(items.map((item) => item.id)).toEqual([
			"user:1",
			"activity:read-file",
		]);
	});
});
