import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	buildChatVerificationEvidenceHistory,
	buildNormalTranscriptItems,
} from "../src/modules/nightworkers/components/ThreadTimeline";
import {
	CodexToolCard,
	getCodexToolCardModel,
	hasCodexToolCard,
	NormalCodexToolCard,
} from "../src/modules/nightworkers/components/ThreadTimelineCodexToolCard";

describe("ThreadTimeline Codex tool cards", () => {
	it("turns a managed run_check result into a user-facing verification summary", () => {
		const card = getCodexToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				payload: {
					provider: "codex",
					providerEventType: "item.completed",
					providerItemId: "run-check-1",
					mcpServer: "nightworkers",
					mcpTool: "run_check",
					toolName: "nightworkers.run_check",
					arguments: {
						command: "bun run typecheck",
						checkKind: "typecheck",
						conditionIds: ["AC-002"],
					},
					result: {
						structuredContent: {
							payload: {
								command: "bun run typecheck",
								checkKind: "typecheck",
								exitCode: 0,
								managedEvidence: true,
								evidenceRunId: "evidence-1",
								checklist: {
									complete: true,
									failedRequired: 0,
									unknownRequired: 0,
								},
							},
						},
						content: [
							{
								type: "text",
								text: JSON.stringify({ ok: true }),
							},
						],
					},
					status: "completed",
				},
			},
		});

		expect(card).toMatchObject({
			title: "検証",
			summary: "型チェックが完了しました",
			status: "ok",
			verification: {
				checkKind: "typecheck",
				state: "passed",
				command: "bun run typecheck",
				resultText: "OK typecheck\nexitCode=0",
				evidence: "saved",
				conditionIds: ["AC-002"],
			},
		});
	});

	it("uses the actual managed check outcome instead of MCP transport completion", () => {
		const card = getCodexToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				payload: {
					provider: "codex",
					providerEventType: "item.completed",
					providerItemId: "run-check-failed",
					mcpServer: "nightworkers",
					mcpTool: "run_check",
					toolName: "nightworkers.run_check",
					arguments: { checkKind: "test", command: "bun run test" },
					result: {
						structuredContent: {
							payload: {
								checkKind: "test",
								exitCode: 1,
								managedEvidence: false,
							},
						},
						content: [
							{
								type: "text",
								text: JSON.stringify({ ok: false }),
							},
						],
					},
					status: "completed",
				},
			},
		});

		expect(card).toMatchObject({
			summary: "テストが失敗しました",
			status: "failed",
			verification: {
				state: "failed",
				evidence: "not_saved",
			},
		});
	});

	it("treats the managed run_verification tool as a Full Verify card", () => {
		const card = getCodexToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				payload: {
					provider: "codex",
					providerEventType: "item.completed",
					providerItemId: "run-verification",
					mcpServer: "nightworkers",
					mcpTool: "run_verification",
					toolName: "nightworkers.run_verification",
					arguments: { command: "bun run verify" },
					result: {
						structuredContent: {
							payload: {
								command: "bun run verify",
								exitCode: 0,
								verified: true,
							},
						},
					},
					status: "completed",
				},
			},
		});

		expect(card).toMatchObject({
			title: "検証",
			summary: "総合検証が完了しました",
			verification: {
				checkKind: "verify",
				state: "passed",
				command: "bun run verify",
			},
		});
	});

	it("renders completion_check as a quality-gate result instead of saved evidence", () => {
		const card = getCodexToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				payload: {
					provider: "codex",
					providerEventType: "item.completed",
					mcpServer: "nightworkers",
					mcpTool: "completion_check",
					toolName: "nightworkers.completion_check",
					result: {
						structuredContent: {
							payload: {
								llmSummary: "ERROR completion_check",
								result: {
									qualityGate: {
										passed: false,
										inventory: { status: "passed" },
										testExecution: { status: "passed" },
										fullVerify: { status: "failed" },
									},
								},
							},
						},
						content: [{ type: "text", text: JSON.stringify({ ok: false }) }],
					},
					status: "completed",
				},
			},
		});

		expect(card).toMatchObject({
			title: "Evidence Check",
			summary: "完了条件の確認が失敗しました",
			verification: {
				checkKind: "completion_check",
				state: "failed",
				evidence: "unknown",
				qualityGate: {
					passed: false,
					inventory: "passed",
					testExecution: "passed",
					fullVerify: "failed",
				},
			},
		});
	});

	it("renders a confirmed Evidence Check as a follow-up Verify state", () => {
		const event = completionCheckEvent({
			id: "evidence-check-confirmed",
			seq: 2,
			confirmation: "confirmed",
			verify: "passed",
			suggestedAction: "run_verify",
			ok: false,
		});
		const card = getCodexToolCardModel(event);

		expect(card).toMatchObject({
			title: "Evidence Check",
			summary: "Evidence Checkを確認しました",
			status: "ok",
			verification: {
				checkKind: "completion_check",
				state: "needs_action",
				evidence: "saved",
				evidenceCheck: {
					confirmation: "confirmed",
					verify: "passed",
					suggestedAction: "run_verify",
					mapping: {
						status: "missing",
						matched: 0,
						total: 8,
					},
				},
			},
		});

		const markup = renderToStaticMarkup(
			createElement(NormalCodexToolCard, {
				event,
				verificationHistory: {
					lastFullPass: {
						eventId: "full-pass",
						occurredAt: "2026-08-01T13:15:31.000Z",
					},
					freshness: "current",
					staleReason: null,
				},
			}),
		);
		const expandedMarkup = renderToStaticMarkup(
			createElement(CodexToolCard, { event }),
		);

		expect(markup).toContain("Evidence Check: 確認済み");
		expect(markup).toContain("次の操作: Follow-up Verifyを実行");
		expect(expandedMarkup).toContain("初回Verify: 成功");
		expect(expandedMarkup).toContain(
			"テスト対応: 0/8（参考情報・完了判定には不使用）",
		);
		expect(markup).toContain("実行時点: Full Verify有効");
		expect(markup).not.toContain("完了条件の確認が失敗しました");
		expect(markup).not.toContain("証跡を確認中");
		expect(markup).not.toContain("Full Verify後に要再検証");
	});

	it("keeps completed run_check evidence visible in the normal chat transcript", () => {
		const event = {
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				payload: {
					provider: "codex",
					providerEventType: "item.completed",
					providerItemId: "run-check-render",
					mcpServer: "nightworkers",
					mcpTool: "run_check",
					toolName: "nightworkers.run_check",
					arguments: {
						checkKind: "test",
						command: "bun run test",
					},
					result: {
						structuredContent: {
							payload: {
								checkKind: "test",
								exitCode: 0,
								managedEvidence: true,
							},
						},
					},
					status: "completed",
				},
			},
		} as never;
		const markup = renderToStaticMarkup(
			createElement(NormalCodexToolCard, {
				event,
			}),
		);

		expect(markup).toContain("テストが完了しました");
		expect(markup).toContain("証跡を保存済み");
		expect(
			buildNormalTranscriptItems([
				{ kind: "activity", id: "run-check", event },
			]),
		).toHaveLength(1);
	});

	it("extracts Codex MCP started details", () => {
		const card = getCodexToolCardModel({
			kind: "tool.call",
			status: "started",
			payloadJson: {
				payload: {
					provider: "codex",
					providerEventType: "item.started",
					providerItemId: "mcp-todo-1",
					mcpServer: "nightworkers",
					mcpTool: "todo_list",
					toolName: "nightworkers.todo_list",
					arguments: {
						runId: "run-1",
						operation: "replace",
						todos: [{ seq: 1, title: "実装" }],
					},
					status: "in_progress",
				},
			},
		});

		expect(card).toMatchObject({
			lifecycle: "started",
			status: "started",
			providerItemId: "mcp-todo-1",
			toolName: "nightworkers.todo_list",
			codexKind: "mcp",
			title: "Codex MCP",
			summary: "nightworkers.todo_list | operation=replace",
		});
		expect(card?.metadata).toContainEqual({
			label: "server",
			value: "nightworkers",
		});
		expect(card?.metadata).toContainEqual({
			label: "tool",
			value: "todo_list",
		});
		expect(card?.argumentsPreview).toContain('"operation": "replace"');
	});

	it("extracts Codex MCP failed result details from runEvent data", () => {
		const card = getCodexToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				runEvent: {
					type: "tool.call_finished",
					data: {
						provider: "codex",
						providerEventType: "item.completed",
						providerItemId: "mcp-todo-2",
						mcpServer: "nightworkers",
						mcpTool: "todo_list",
						toolName: "nightworkers.todo_list",
						arguments: {
							runId: "run-1",
							operation: "done",
							seq: 1,
						},
						result: {
							content: [
								{
									type: "text",
									text: '{"error":{"code":"CURRENT_TODO_NOT_UNIQUE"}}',
								},
							],
						},
						error: "CURRENT_TODO_NOT_UNIQUE",
						status: "failed",
					},
				},
			},
		});

		expect(card).toMatchObject({
			lifecycle: "result",
			status: "failed",
			providerItemId: "mcp-todo-2",
			summary: "nightworkers.todo_list | operation=done | seq=1",
			errorMessage: "CURRENT_TODO_NOT_UNIQUE",
		});
		expect(card?.resultPreview).toContain("CURRENT_TODO_NOT_UNIQUE");
	});

	it("strips terminal control sequences from Codex command output previews", () => {
		const card = getCodexToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				payload: {
					provider: "codex",
					providerEventType: "item.completed",
					providerItemId: "cmd-build",
					toolName: "command_execution",
					command: "bun run build",
					commandClass: "verification",
					aggregatedOutput:
						"\u001b[2K\rtransforming...\u001b[32m✓\u001b[39m 1899 modules transformed.\u0007\nrendering chunks...",
					exitCode: 0,
					status: "completed",
				},
			},
		});

		expect(card?.summary).toBe("検証チェックが完了しました");
		expect(card?.detailsFilename).toBe("command result");
		expect(card?.outputPreview).toContain("transforming...");
		expect(card?.outputPreview).toContain("✓ 1899 modules transformed.");
		expect(card?.outputPreview).not.toContain(String.fromCharCode(27));
		expect(card?.outputPreview).not.toContain(String.fromCharCode(7));
		expect(card?.outputPreview).not.toContain("\r");
		expect(card?.outputPreview).not.toContain("[2K");
		expect(card?.outputPreview).not.toContain("[32m");
		expect(card?.outputPreview).not.toContain("[39m");
	});

	it("renders completed Codex commands as expanded CLI result cards", () => {
		const markup = renderToStaticMarkup(
			createElement(NormalCodexToolCard, {
				event: {
					kind: "tool.result",
					status: "completed",
					payloadJson: {
						payload: {
							provider: "codex",
							providerEventType: "item.completed",
							providerItemId: "cmd-test",
							toolName: "command_execution",
							command: "bun run test",
							commandClass: "verification",
							aggregatedOutput: ["line 1", "line 2", "line 3", "line 4"].join(
								"\n",
							),
							exitCode: 0,
							status: "completed",
						},
					},
				},
			}),
		);

		expect(markup).toContain("$ bun run test");
		expect(markup).toContain("run_check.sh");
		expect(markup).toContain("line 1");
	});

	it("renders command execution results in a CLI-style block", () => {
		const markup = renderToStaticMarkup(
			createElement(CodexToolCard, {
				event: {
					kind: "tool.result",
					status: "completed",
					payloadJson: {
						payload: {
							provider: "codex",
							providerEventType: "item.completed",
							providerItemId: "cmd-result-cli",
							toolName: "command_execution",
							command: "bun run test",
							commandClass: "verification",
							aggregatedOutput: "12 tests passed",
							exitCode: 0,
							status: "completed",
						},
					},
				} as never,
			}),
		);

		expect(markup).toContain("$ bun run test");
		expect(markup).toContain("12 tests passed");
		expect(markup).toContain("run_check.sh");
	});

	it("hides in-progress verification commands until a result is available", () => {
		const markup = renderToStaticMarkup(
			createElement(NormalCodexToolCard, {
				event: {
					kind: "tool.call",
					status: "started",
					payloadJson: {
						payload: {
							provider: "codex",
							providerEventType: "item.started",
							providerItemId: "cmd-preview",
							toolName: "command_execution",
							command: "bun run test",
							commandClass: "verification",
							aggregatedOutput: "12 tests passed\nall green",
							exitCode: null,
							status: "in_progress",
						},
					},
				} as never,
			}),
		);

		expect(markup).toBe("");
	});

	it("renders expanded Codex MCP result blocks 104px shorter than before", () => {
		const markup = renderToStaticMarkup(
			createElement(CodexToolCard, {
				event: {
					kind: "tool.result",
					status: "completed",
					payloadJson: {
						payload: {
							provider: "codex",
							providerEventType: "item.completed",
							providerItemId: "item_118",
							mcpServer: "nightworkers",
							mcpTool: "todo_list",
							toolName: "nightworkers.todo_list",
							arguments: { operation: "done", runId: "run-1", seq: 4 },
							result: { ok: true },
							status: "completed",
						},
					},
				},
			}),
		);

		expect(markup).toContain("nightworkers.todo_list.txt");
		expect(markup).toContain("max-height:216px");
	});

	it("renders sed in-place commands as Codex edit diff previews", () => {
		const card = getCodexToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				payload: {
					provider: "codex",
					providerEventType: "item.completed",
					providerItemId: "cmd-sed-edit",
					toolName: "command_execution",
					command: "sed -i '' 's/oldTitle/newTitle/g' src/App.tsx",
					commandClass: "inspection",
					aggregatedOutput: "",
					exitCode: 0,
					status: "completed",
				},
			},
		});

		expect(card).toMatchObject({
			codexKind: "edit_command",
			title: "Codex edit",
			summary: "sed edit | src/App.tsx | oldTitle -> newTitle",
			editDiffPreview: {
				label: "sed edit preview",
			},
		});
		expect(card?.metadata).toContainEqual({
			label: "file",
			value: "src/App.tsx",
		});
		expect(card?.editDiffPreview?.diff).toContain("--- src/App.tsx");
		expect(card?.editDiffPreview?.diff).toContain("- oldTitle");
		expect(card?.editDiffPreview?.diff).toContain("+ newTitle");
	});

	it("does not build Codex cards for changed-file-only diff detection logs", () => {
		expect(
			hasCodexToolCard({
				kind: "file.diff",
				status: "completed",
				payloadJson: {
					payload: {
						provider: "codex",
						providerEventType: "item.completed",
						providerItemId: "file-change-1",
						changedFiles: ["src/fizzbuzz.ts"],
						status: "completed",
					},
				},
			}),
		).toBe(false);
	});

	it("keeps Codex MCP tool cards visible in normal transcript mode", () => {
		const items = buildNormalTranscriptItems([
			{
				kind: "user_turn",
				id: "user:1",
				turnId: "user-1",
				events: [],
				text: "実装してください",
			},
			{
				kind: "activity",
				id: "activity:codex-mcp",
				event: {
					id: "codex-mcp",
					taskId: "task-1",
					runId: "run-1",
					kind: "tool.result",
					source: "worker",
					status: "completed",
					seq: 2,
					payloadJson: {
						payload: {
							provider: "codex",
							providerItemId: "mcp-todo-visible",
							mcpServer: "nightworkers",
							mcpTool: "todo_list",
							toolName: "nightworkers.todo_list",
							arguments: { operation: "done", seq: 1 },
							result: { ok: true },
							status: "completed",
						},
					},
					createdAt: "2026-06-18T00:00:00.000Z",
					visibility: "visible",
				} as never,
			},
		]);

		expect(items.map((item) => item.id)).toContain("activity:codex-mcp");
	});

	it("dedupes repeated Codex command updates by provider item and lifecycle", () => {
		const items = buildNormalTranscriptItems([
			{
				kind: "activity",
				id: "activity:cmd-start-1",
				event: codexCommandEvent(
					"cmd-start-1",
					"tool.call",
					"item.started",
					"started",
				),
			},
			{
				kind: "activity",
				id: "activity:cmd-start-duplicate",
				event: codexCommandEvent(
					"cmd-start-duplicate",
					"tool.call",
					"item.started",
					"started",
				),
			},
			{
				kind: "activity",
				id: "activity:cmd-result",
				event: codexCommandEvent(
					"cmd-result",
					"tool.result",
					"item.completed",
					"completed",
				),
			},
		]);

		expect(items.map((item) => item.id)).toEqual(["activity:cmd-result"]);
	});

	it("treats a native broad verification result as a Full Verify card", () => {
		const card = getCodexToolCardModel({
			kind: "tool.result",
			status: "completed",
			payloadJson: {
				payload: {
					provider: "codex",
					providerEventType: "item.completed",
					providerItemId: "full-verify",
					toolName: "command_execution",
					command: "bun run verify",
					commandClass: "broad_verification",
					aggregatedOutput: "all gates passed",
					exitCode: 0,
					status: "completed",
				},
			},
		});

		expect(card).toMatchObject({
			title: "検証",
			summary: "総合検証が完了しました",
			verification: {
				checkKind: "verify",
				state: "passed",
			},
		});
	});

	it("keeps the last Full Verify and marks later evidence stale after code changes", () => {
		const fullVerify = nativeVerificationEvent({
			id: "full-pass",
			seq: 1,
			commandClass: "broad_verification",
			exitCode: 0,
			createdAt: "2026-07-17T08:00:00.000Z",
		});
		const codeChange = {
			id: "code-change",
			taskId: "task-1",
			runId: "run-1",
			kind: "file.diff",
			source: "worker",
			status: "completed",
			seq: 2,
			payloadJson: { payload: { changedFiles: ["src/app.ts"] } },
			createdAt: "2026-07-17T08:05:00.000Z",
			visibility: "visible",
		} as never;
		const focusedPass = nativeVerificationEvent({
			id: "focused-pass",
			seq: 3,
			commandClass: "verification",
			exitCode: 0,
			createdAt: "2026-07-17T08:06:00.000Z",
		});
		const history = buildChatVerificationEvidenceHistory([
			fullVerify,
			codeChange,
			focusedPass,
		]);

		expect(history.get("full-pass")).toMatchObject({
			freshness: "current",
			lastFullPass: { eventId: "full-pass" },
		});
		expect(history.get("focused-pass")).toMatchObject({
			freshness: "stale",
			staleReason: "code_changed",
			lastFullPass: { eventId: "full-pass" },
		});
	});

	it("keeps a previous Full Verify after failure and refreshes it on the next Full Verify pass", () => {
		const history = buildChatVerificationEvidenceHistory([
			nativeVerificationEvent({
				id: "first-full-pass",
				seq: 1,
				commandClass: "broad_verification",
				exitCode: 0,
				createdAt: "2026-07-17T08:00:00.000Z",
			}),
			nativeVerificationEvent({
				id: "focused-failure",
				seq: 2,
				commandClass: "verification",
				exitCode: 1,
				createdAt: "2026-07-17T08:05:00.000Z",
			}),
			nativeVerificationEvent({
				id: "second-full-pass",
				seq: 3,
				commandClass: "broad_verification",
				exitCode: 0,
				createdAt: "2026-07-17T08:10:00.000Z",
			}),
		]);

		expect(history.get("focused-failure")).toMatchObject({
			freshness: "stale",
			staleReason: "later_verification_failed",
			lastFullPass: { eventId: "first-full-pass" },
		});
		expect(history.get("second-full-pass")).toMatchObject({
			freshness: "current",
			staleReason: null,
			lastFullPass: { eventId: "second-full-pass" },
		});
	});

	it("does not stale a Full Verify while Evidence Check awaits follow-up Verify", () => {
		const history = buildChatVerificationEvidenceHistory([
			nativeVerificationEvent({
				id: "full-pass-before-evidence-check",
				seq: 1,
				commandClass: "broad_verification",
				exitCode: 0,
				createdAt: "2026-08-01T13:15:31.000Z",
			}),
			completionCheckEvent({
				id: "confirmed-awaiting-followup",
				seq: 2,
				confirmation: "confirmed",
				verify: "passed",
				suggestedAction: "run_verify",
				ok: false,
			}),
		]);

		expect(history.get("confirmed-awaiting-followup")).toMatchObject({
			freshness: "current",
			staleReason: null,
			lastFullPass: { eventId: "full-pass-before-evidence-check" },
		});
	});

	it("renders the Full Verify snapshot on a verification evidence card", () => {
		const event = nativeVerificationEvent({
			id: "focused-after-full",
			seq: 2,
			commandClass: "verification",
			exitCode: 0,
			createdAt: "2026-07-17T08:06:00.000Z",
		});
		const markup = renderToStaticMarkup(
			createElement(NormalCodexToolCard, {
				event,
				verificationHistory: {
					lastFullPass: {
						eventId: "full-pass",
						occurredAt: "2026-07-17T08:00:00.000Z",
					},
					freshness: "stale",
					staleReason: "code_changed",
				},
			}),
		);

		expect(markup).toContain("実行時点: Full Verify後に要再検証");
		expect(markup).toContain("Stale（コード変更後）");
	});

	it("supports TaskEvent fallback payloads before activity projection flushes", () => {
		expect(
			hasCodexToolCard({
				eventType: "tool.call_finished",
				type: "info",
				message: "[Codex] MCP tool finished: nightworkers.todo_list",
				payloadJson: {
					payload: {
						provider: "codex",
						providerItemId: "fallback-mcp",
						mcpServer: "nightworkers",
						mcpTool: "todo_list",
						toolName: "nightworkers.todo_list",
						arguments: { operation: "list" },
						result: { ok: true },
						status: "completed",
					},
				},
			} as never),
		).toBe(true);
	});

	it("does not take over dedicated import project cards", () => {
		expect(
			getCodexToolCardModel({
				kind: "tool.result",
				payloadJson: {
					payload: {
						provider: "codex",
						providerItemId: "import-1",
						mcpServer: "nightworkers",
						mcpTool: "import_project",
						toolName: "nightworkers.import_project",
						result: { ok: true },
						status: "completed",
					},
				},
			}),
		).toBeNull();
	});
});

function codexCommandEvent(
	id: string,
	kind: "tool.call" | "tool.result",
	providerEventType: "item.started" | "item.completed",
	status: "started" | "completed",
) {
	return {
		id,
		taskId: "task-1",
		runId: "run-1",
		kind,
		source: "worker",
		status,
		seq: 1,
		payloadJson: {
			payload: {
				provider: "codex",
				providerEventType,
				providerItemId: "cmd-provider-1",
				toolName: "command_execution",
				command: "pnpm test",
				commandClass: "verification",
				aggregatedOutput: status === "completed" ? "ok" : "",
				exitCode: status === "completed" ? 0 : null,
				status,
			},
		},
		createdAt: "2026-06-18T00:00:00.000Z",
		visibility: "visible",
	} as never;
}

function nativeVerificationEvent(input: {
	id: string;
	seq: number;
	commandClass: "verification" | "broad_verification";
	exitCode: number;
	createdAt: string;
}) {
	return {
		id: input.id,
		taskId: "task-1",
		runId: "run-1",
		kind: "tool.result",
		source: "worker",
		status: input.exitCode === 0 ? "completed" : "failed",
		seq: input.seq,
		payloadJson: {
			payload: {
				provider: "codex",
				providerEventType: "item.completed",
				providerItemId: input.id,
				toolName: "command_execution",
				command:
					input.commandClass === "broad_verification"
						? "bun run verify"
						: "bun run test",
				commandClass: input.commandClass,
				aggregatedOutput: input.exitCode === 0 ? "ok" : "failed",
				exitCode: input.exitCode,
				status: input.exitCode === 0 ? "completed" : "failed",
			},
		},
		createdAt: input.createdAt,
		visibility: "visible",
	} as never;
}

function completionCheckEvent(input: {
	id: string;
	seq: number;
	confirmation: "confirmed" | "settled";
	verify: "passed" | "failed";
	suggestedAction: "run_verify" | "fix_verify" | "write_final_report";
	ok: boolean;
}) {
	const result = {
		ok: input.ok,
		mapping: {
			status: "missing",
			matched: 0,
			total: 8,
		},
		verify: { status: input.verify },
		confirmation: { status: input.confirmation },
		suggestedAction: input.suggestedAction,
		...(input.ok ? {} : { reason: "evidence_check_followup_verify_required" }),
	};
	return {
		id: input.id,
		taskId: "task-1",
		runId: "run-1",
		kind: "tool.result",
		source: "worker",
		status: "completed",
		seq: input.seq,
		payloadJson: {
			payload: {
				provider: "codex",
				providerEventType: "item.completed",
				providerItemId: input.id,
				mcpServer: "nightworkers",
				mcpTool: "completion_check",
				toolName: "nightworkers.completion_check",
				result: {
					structured_content: {
						payload: {
							llmSummary: input.ok
								? "OK completion_check"
								: "ERROR completion_check",
							result,
						},
					},
					content: [
						{
							type: "text",
							text: JSON.stringify({ ok: input.ok }),
						},
					],
				},
				status: input.ok ? "completed" : "failed",
			},
		},
		createdAt: "2026-08-01T13:15:40.000Z",
		visibility: "visible",
	} as never;
}
