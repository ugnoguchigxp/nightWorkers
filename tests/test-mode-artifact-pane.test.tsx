import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { ArtifactPane } from "../src/modules/nightworkers/components/ArtifactPane";
import type {
	Repository,
	TaskRun,
	WorkbenchArtifactRef,
} from "../src/modules/nightworkers/types";
import {
	buildTaskEvent,
	buildTaskMessage,
	buildTaskRun,
} from "./helpers/nightworkers-fixtures";

const project: Repository = {
	id: "22222222-2222-4222-8222-222222222222",
	name: "nightWorkers",
	localPath: "/Users/y.noguchi/Code/nightWorkers",
	branch: "main",
	allowed: true,
	queueEnabled: false,
	maxConcurrentSessions: 1,
	createdAt: "2026-07-08T00:00:00.000Z",
	updatedAt: "2026-07-08T00:00:00.000Z",
};

const testModeArtifact: WorkbenchArtifactRef = {
	id: "test-mode-task-1",
	taskId: "11111111-1111-4111-8111-111111111111",
	kind: "test_mode",
	title: "Test Mode",
	source: { type: "test_mode" },
	createdAt: "2026-07-08T00:00:00.000Z",
};

describe("Test Mode artifact pane", () => {
	it("shows checklist conditions derived from the latest implementation plan", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- API が成功し、長い完了条件の説明も省略されずに一覧内で全文読める",
				"- [AC-010] UI が状態を表示する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
			},
		});

		const markup = renderToStaticMarkup(
			<ArtifactPane
				activeProject={project}
				activeSessionId="11111111-1111-4111-8111-111111111111"
				focusType="artifact"
				selectedArtifact={testModeArtifact}
				taskMessages={[implementationPlan]}
				activityArtifacts={[]}
				fileEntries={[]}
				fileEntriesByDirectory={{}}
				expandedDirectories={{}}
				loadingDirectories={{}}
				selectedFile={null}
				selectedFilePath={null}
				isFilesLoading={false}
				isFileLoading={false}
				projectDiff={null}
				isDiffLoading={false}
				onToggleDirectory={async () => undefined}
				onOpenFile={vi.fn()}
				onRefreshFiles={async () => undefined}
				onRefreshDiff={async () => undefined}
			/>,
		);

		expect(markup).toContain("テスト実装ワークフロー開始");
		expect(markup).toContain("実装開始");
		expect(markup).toContain("証跡テストチェック");
		expect(markup).toContain("LLM コードレビュー");
		expect(markup).toContain("ユニットテスト実行");
		expect(markup).not.toContain("実装完了");
		expect(markup).toContain("待機中");
		expect(markup).not.toContain(
			"通常の実装実行とは独立して、検証チェックリストに沿ったテスト実行を開始します。",
		);
		expect(markup).not.toContain("検証 JSON がまだありません");
		expect(markup).not.toContain("件の条件");
		expect(markup).toContain("AC-001");
		expect(markup).toContain(
			"API が成功し、長い完了条件の説明も省略されずに一覧内で全文読める",
		);
		expect(markup).toContain("whitespace-normal break-words");
		expect(markup).not.toContain("truncate text-slate-200");
		expect(markup).toContain("AC-010");
		expect(markup).toContain("UI が状態を表示する");
	});

	it("shows Test Mode actions even when the task is archived", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [AC-001] API が成功する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
			},
		});

		const activeMarkup = renderTestModePane({
			taskMessages: [implementationPlan],
			activeTaskStatus: "running",
		});
		const archivedMarkup = renderTestModePane({
			taskMessages: [implementationPlan],
			activeTaskStatus: "cancelled",
		});

		expect(activeMarkup).toContain("テスト実装ワークフロー開始");
		expect(activeMarkup).toContain("実装開始");
		expect(archivedMarkup).toContain("テスト実装ワークフロー開始");
		expect(archivedMarkup).toContain("ユニットテスト実行");
		expect(archivedMarkup).toContain("LLM コードレビュー");
	});

	it("shows workflow progress from the latest Test Mode run", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [AC-001] API が成功する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
			},
		});
		const latestRun = buildTaskRun({
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			events: [
				buildTaskEvent({
					id: "read-spec-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "read_current_specification",
								result: { ok: true, payload: {} },
							},
						},
					},
				}),
				buildTaskEvent({
					id: "run-check-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "run_check",
								ok: false,
								status: "failed",
								result: {
									checkKind: "test",
								},
							},
						},
					},
				}),
			],
		});

		const markup = renderTestModePane({
			taskMessages: [implementationPlan],
			latestRun,
		});

		expect(markup).toContain("実装開始");
		expect(markup).toContain("完了");
		expect(markup).not.toContain("実装完了");
		expect(markup).toContain("ユニットテスト実行");
		expect(markup).toContain("失敗");
		expect(markup).toContain("証跡テストチェック");
		expect(markup).toContain("LLM コードレビュー");
		expect(markup).toContain("待機中");
	});

	it("marks LLM code review progress from reviewer events", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [AC-001] API が成功する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
			},
		});
		const latestRun = buildTaskRun({
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			events: [
				buildTaskEvent({
					id: "run-check-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "run_check",
								ok: true,
								status: "completed",
								result: {
									checkKind: "test",
								},
							},
						},
					},
				}),
				buildTaskEvent({
					id: "completion-check-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "completion_check",
								ok: true,
								status: "completed",
								result: {
									llmSummary: "OK completion_check",
								},
							},
						},
					},
				}),
				buildTaskEvent({
					id: "llm-review-event",
					eventType: "review.llm_finished",
					payloadJson: {
						runEvent: {
							type: "review.llm_finished",
							data: {
								status: "completed",
							},
						},
					},
				}),
			],
		});

		const markup = renderTestModePane({
			taskMessages: [implementationPlan],
			latestRun,
		});

		expect(markup).toContain("LLM コードレビュー");
		expect(markup).not.toContain("実装完了");
		expect(markup.match(/完了/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
		expect(markup).toContain("メンテナンスモードに移行");
		expect(markup).toContain(
			"/sessions/11111111-1111-4111-8111-111111111111?artifact=review_status",
		);
	});

	it("shows completed review evaluations with changes requested as improvement work", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [AC-001] API が成功する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
			},
		});
		const latestRun = buildTaskRun({
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			events: [
				buildTaskEvent({
					id: "run-check-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "run_check",
								ok: true,
								status: "completed",
								result: { checkKind: "test" },
							},
						},
					},
				}),
				buildTaskEvent({
					id: "completion-check-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "completion_check",
								ok: true,
								status: "completed",
								result: { llmSummary: "OK completion_check" },
							},
						},
					},
				}),
				buildTaskEvent({
					id: "review-evaluation-finished",
					eventType: "review.evaluation_finished",
					payloadJson: {
						runEvent: {
							type: "review.evaluation_finished",
							data: {
								status: "completed",
								deterministicVerdict: "changes_requested",
								llmVerdict: "changes_requested",
								finalReviewerVerdict: "changes_requested",
								blockingFindingCount: 1,
								reviewer: { kind: "combined" },
								reviewResult: {
									verdict: "changes_requested",
									findings: [
										{
											severity: "blocking",
											title: "Final report is present",
											body: "Rubric criterion failed: Final report is present",
										},
									],
								},
							},
						},
					},
				}),
			],
		});

		const markup = renderTestModePane({
			taskMessages: [implementationPlan],
			latestRun,
		});
		const reviewStepStart = markup.indexOf("LLM コードレビュー");
		const reviewCardStart = markup.indexOf("LLM コードレビュー実行結果");

		expect(markup).toContain("LLM コードレビュー実行結果");
		expect(markup).toContain("改善点あり");
		expect(markup).toContain("verdict=changes_requested");
		expect(markup).toContain("blocking: Final report is present");
		expect(markup).not.toContain("ERROR");
		expect(markup.slice(reviewStepStart, reviewCardStart)).toContain(
			"確認待ち",
		);
		expect(markup).not.toContain("メンテナンスモードに移行");
	});

	it("uses run detail events for workflow progress when latest run has no embedded events", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [AC-001] API が成功する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
			},
		});
		const latestRun = buildTaskRun({
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			events: [],
		});
		const latestRunEvents = [
			buildTaskEvent({
				id: "run-check-event",
				payloadJson: {
					runEvent: {
						data: {
							toolName: "nightworkers.run_check",
							mcpTool: "run_check",
							status: "completed",
							result: {
								content: [
									{
										type: "text",
										text: JSON.stringify({
											ok: true,
											toolName: "run_check",
											payload: {
												checkKind: "test",
												llmSummary: "OK unit tests",
											},
										}),
									},
								],
							},
						},
					},
				},
			}),
			buildTaskEvent({
				id: "completion-check-event",
				payloadJson: {
					runEvent: {
						data: {
							toolName: "nightworkers.completion_check",
							mcpTool: "completion_check",
							ok: true,
							status: "completed",
							result: {
								structured_content: {
									payload: {
										llmSummary: "OK completion_check",
									},
								},
							},
						},
					},
				},
			}),
			buildTaskEvent({
				id: "llm-review-event",
				eventType: "review.llm_finished",
				payloadJson: {
					runEvent: {
						type: "review.llm_finished",
						data: {
							status: "completed",
						},
					},
				},
			}),
		];

		const markup = renderTestModePane({
			taskMessages: [implementationPlan],
			latestRun,
			latestRunEvents,
		});

		expect(markup).toContain("ユニットテスト実行結果");
		expect(markup).toContain("OK unit tests");
		expect(markup).not.toContain("証跡テストチェック結果");
		expect(markup).not.toContain("OK completion_check");
		expect(markup).toContain("確認済み");
		expect(markup.match(/完了/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
	});

	it("marks degraded reviewer_evaluation tool results as needs human review", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [AC-001] API が成功する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
			},
		});
		const latestRun = buildTaskRun({
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			events: [
				buildTaskEvent({
					id: "run-check-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "run_check",
								ok: true,
								status: "completed",
								result: { checkKind: "test" },
							},
						},
					},
				}),
				buildTaskEvent({
					id: "completion-check-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "completion_check",
								ok: true,
								status: "completed",
								result: { llmSummary: "OK completion_check" },
							},
						},
					},
				}),
				buildTaskEvent({
					id: "reviewer-evaluation-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "reviewer_evaluation",
								status: "failed",
								result: {
									content: [
										{
											type: "text",
											text: JSON.stringify({
												ok: false,
												toolName: "reviewer_evaluation",
												payload: {
													status: "degraded",
													degradedReasons: [
														"llm_reviewer_provider_not_configured",
													],
												},
												error: {
													code: "REVIEWER_EVALUATION_DEGRADED",
													message: "Reviewer evaluation degraded.",
												},
											}),
										},
									],
									structured_content: {
										error: {
											code: "REVIEWER_EVALUATION_DEGRADED",
											message: "Reviewer evaluation degraded.",
										},
									},
								},
							},
						},
					},
				}),
			],
		});

		const markup = renderTestModePane({
			taskMessages: [implementationPlan],
			latestRun,
		});

		expect(markup).toContain("LLM コードレビュー");
		expect(markup).toContain("確認待ち");
		expect(markup).toContain("LLM コードレビュー実行結果");
		expect(markup).toContain("ERROR");
		expect(markup).toContain("status=degraded");
		expect(markup).toContain("degraded=llm_reviewer_provider_not_configured");
		expect(markup).not.toContain("メンテナンスモードに移行");
	});

	it("shows the latest approved LLM review result card without stale degraded output", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [AC-001] API が成功する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
			},
		});
		const latestRun = buildTaskRun({
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			events: [
				buildTaskEvent({
					id: "reviewer-evaluation-degraded",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "reviewer_evaluation",
								status: "failed",
								result: {
									content: [
										{
											type: "text",
											text: JSON.stringify({
												ok: false,
												toolName: "reviewer_evaluation",
												payload: {
													status: "degraded",
													finalReviewerVerdict: "changes_requested",
													degradedReasons: [
														"llm_reviewer_provider_not_configured",
													],
												},
											}),
										},
									],
								},
							},
						},
					},
				}),
				buildTaskEvent({
					id: "reviewer-evaluation-approved",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "reviewer_evaluation",
								status: "completed",
								result: {
									content: [
										{
											type: "text",
											text: JSON.stringify({
												ok: true,
												toolName: "reviewer_evaluation",
												payload: {
													status: "completed",
													finalReviewerVerdict: "approved",
													blockingFindingCount: 0,
													degradedReasons: [],
													llm: {
														provider: "codex",
														model: "gpt-5.4-mini",
													},
													reviewResult: {
														verdict: "approved",
														findings: [],
													},
												},
											}),
										},
									],
								},
							},
						},
					},
				}),
			],
		});

		const markup = renderTestModePane({
			taskMessages: [implementationPlan],
			latestRun,
		});

		expect(markup).toContain("LLM コードレビュー実行結果");
		expect(markup).toContain("OK");
		expect(markup).toContain("status=completed");
		expect(markup).toContain("verdict=approved");
		expect(markup).toContain("llm=codex/gpt-5.4-mini");
		expect(markup).not.toContain("llm_reviewer_provider_not_configured");
		expect(markup).not.toContain("status=degraded");
	});

	it("shows managed check results from the latest Test Mode run", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [AC-001] API が成功する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
			},
		});
		const latestRun = buildTaskRun({
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			events: [
				buildTaskEvent({
					id: "run-check-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "run_check",
								ok: true,
								status: "completed",
								result: {
									checkKind: "test",
									llmSummary: "OK test\nexitCode=0\nstdoutArtifact=stdout-1",
								},
							},
						},
					},
				}),
				buildTaskEvent({
					id: "completion-check-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "completion_check",
								ok: true,
								status: "completed",
								result: {
									llmSummary: "OK completion_check",
								},
							},
						},
					},
				}),
			],
		});

		const markup = renderTestModePane({
			taskMessages: [implementationPlan],
			latestRun,
		});

		expect(markup).toContain("ユニットテスト実行結果");
		expect(markup).toContain("OK test");
		expect(markup).not.toContain("証跡テストチェック結果");
		expect(markup).not.toContain("OK completion_check");
		expect(markup).toContain("確認済み");
	});

	it("overwrites failed managed checks with later passing verification commands", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [AC-001] API が成功する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
			},
		});
		const latestRun = buildTaskRun({
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			events: [
				buildTaskEvent({
					id: "typecheck-started",
					payloadJson: {
						runEvent: {
							type: "tool.call_started",
							data: {
								toolName: "nightworkers.run_check",
								mcpTool: "run_check",
								status: "in_progress",
								arguments: { checkKind: "typecheck" },
							},
						},
					},
				}),
				buildTaskEvent({
					id: "typecheck-managed-failed",
					payloadJson: {
						runEvent: {
							type: "tool.call_finished",
							data: {
								toolName: "nightworkers.run_check",
								mcpTool: "run_check",
								status: "failed",
								result: {
									content: [
										{
											type: "text",
											text: JSON.stringify({
												ok: false,
												toolName: "run_check",
												payload: {
													checkKind: "typecheck",
													llmSummary:
														"ERROR typecheck\nstdoutArtifact=old-typecheck",
												},
											}),
										},
									],
								},
							},
						},
					},
				}),
				buildTaskEvent({
					id: "test-managed-failed",
					payloadJson: {
						runEvent: {
							type: "tool.call_finished",
							data: {
								toolName: "nightworkers.run_check",
								mcpTool: "run_check",
								status: "failed",
								result: {
									content: [
										{
											type: "text",
											text: JSON.stringify({
												ok: false,
												toolName: "run_check",
												payload: {
													checkKind: "test",
													llmSummary: "ERROR test\nstdoutArtifact=old-test",
												},
											}),
										},
									],
								},
							},
						},
					},
				}),
				buildTaskEvent({
					id: "verify-managed-failed",
					payloadJson: {
						runEvent: {
							type: "tool.call_finished",
							data: {
								toolName: "nightworkers.run_check",
								mcpTool: "run_check",
								status: "failed",
								result: {
									content: [
										{
											type: "text",
											text: JSON.stringify({
												ok: false,
												toolName: "run_check",
												payload: {
													checkKind: "verify",
													llmSummary: "ERROR verify\nstdoutArtifact=old-verify",
												},
											}),
										},
									],
								},
							},
						},
					},
				}),
				buildTaskEvent({
					id: "typecheck-command-passed",
					payloadJson: {
						runEvent: {
							type: "tool.call_finished",
							data: {
								toolName: "command_execution",
								commandClass: "verification",
								command: "/bin/zsh -lc 'bun run typecheck'",
								status: "completed",
								exitCode: 0,
								aggregatedOutput: "",
							},
						},
					},
				}),
				buildTaskEvent({
					id: "test-command-passed",
					payloadJson: {
						runEvent: {
							type: "tool.call_finished",
							data: {
								toolName: "command_execution",
								commandClass: "verification",
								command: "/bin/zsh -lc 'bun run test'",
								status: "completed",
								exitCode: 0,
								aggregatedOutput: "tests passed",
							},
						},
					},
				}),
				buildTaskEvent({
					id: "verify-command-passed",
					payloadJson: {
						runEvent: {
							type: "tool.call_finished",
							data: {
								toolName: "command_execution",
								commandClass: "broad_verification",
								command: "/bin/zsh -lc 'bun run verify'",
								status: "completed",
								exitCode: 0,
								aggregatedOutput: "OK verify complete",
							},
						},
					},
				}),
				buildTaskEvent({
					id: "completion-check-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "completion_check",
								ok: true,
								status: "completed",
								result: {
									llmSummary: "OK completion_check",
								},
							},
						},
					},
				}),
			],
		});

		const markup = renderTestModePane({
			taskMessages: [implementationPlan],
			latestRun,
		});

		expect(markup).toContain("typecheck 実行結果");
		expect(markup).toContain("OK typecheck");
		expect(markup).toContain("ユニットテスト実行結果");
		expect(markup).toContain("OK test");
		expect(markup).toContain("verify 実行結果");
		expect(markup).toContain("OK verify");
		expect(markup).not.toContain("ERROR typecheck");
		expect(markup).not.toContain("ERROR test");
		expect(markup).not.toContain("ERROR verify");
		expect(markup).not.toContain("other 実行結果");
		expect(markup).not.toContain("old-typecheck");
		expect(markup).not.toContain("old-test");
		expect(markup).not.toContain("old-verify");

		const unitStepStart = markup.indexOf("ユニットテスト実行");
		const evidenceStepStart = markup.indexOf("証跡テストチェック");
		expect(markup.slice(unitStepStart, evidenceStepStart)).toContain("完了");
	});

	it("marks only covered checklist conditions from completion check details", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [AC-001] API が成功する",
				"- [AC-002] UI が状態を表示する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
			},
		});
		const latestRun = buildTaskRun({
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			events: [
				buildTaskEvent({
					id: "completion-check-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "completion_check",
								ok: false,
								status: "completed",
								result: {
									llmSummary: "ERROR completion_check",
									result: {
										ok: false,
										conditions: [
											{
												conditionId: "AC-001",
												text: "API が成功する",
												required: true,
												status: "passed",
											},
											{
												conditionId: "AC-002",
												text: "UI が状態を表示する",
												required: true,
												status: "pending",
											},
										],
										failedRequired: [],
										unknownRequired: [{ conditionId: "AC-002" }],
									},
								},
							},
						},
					},
				}),
			],
		});

		const markup = renderTestModePane({
			taskMessages: [implementationPlan],
			latestRun,
		});
		const firstCondition = markup.slice(
			markup.indexOf("AC-001"),
			markup.indexOf("AC-002"),
		);
		const secondCondition = markup.slice(markup.indexOf("AC-002"));

		expect(markup).not.toContain("証跡テストチェック結果");
		expect(firstCondition).toContain("合格");
		expect(secondCondition).toContain("不明");
	});

	it("reads prefixed NightWorkers MCP check events from structured content", () => {
		const implementationPlan = buildTaskMessage({
			id: "implementation-plan-message",
			messageType: "markdown_document",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [AC-001] API が成功する",
			].join("\n"),
			metadataJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
				verificationDocumentId: "55555555-5555-4555-8555-555555555555",
			},
		});
		const latestRun = buildTaskRun({
			contextSnapshot: {
				executionMode: "test",
				testMode: { action: "plan_and_implement_tests" },
			},
			events: [
				buildTaskEvent({
					id: "verify-check-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "nightworkers.run_check",
								mcpTool: "run_check",
								status: "completed",
								result: {
									structured_content: {
										payload: {
											checkKind: "verify",
											llmSummary: "OK verify",
										},
									},
								},
							},
						},
					},
				}),
				buildTaskEvent({
					id: "completion-check-event",
					payloadJson: {
						runEvent: {
							data: {
								toolName: "nightworkers.completion_check",
								mcpTool: "completion_check",
								status: "completed",
								result: {
									structured_content: {
										payload: {
											llmSummary: "OK completion_check",
										},
									},
								},
							},
						},
					},
				}),
				buildTaskEvent({
					id: "llm-review-event",
					eventType: "review.llm_finished",
					payloadJson: {
						runEvent: {
							type: "review.llm_finished",
							data: {
								status: "degraded",
							},
						},
					},
				}),
			],
		});

		const markup = renderTestModePane({
			taskMessages: [implementationPlan],
			latestRun,
		});

		expect(markup).toContain("verify 実行結果");
		expect(markup).toContain("OK verify");
		expect(markup).not.toContain("証跡テストチェック結果");
		expect(markup).not.toContain("OK completion_check");
		expect(markup).toContain("確認待ち");
		const unitStepStart = markup.indexOf("ユニットテスト実行");
		const evidenceStepStart = markup.indexOf("証跡テストチェック");
		expect(markup.slice(unitStepStart, evidenceStepStart)).toContain("完了");
	});
});

function renderTestModePane(input: {
	taskMessages: Parameters<typeof ArtifactPane>[0]["taskMessages"];
	activeTaskStatus?: string | null;
	latestRun?: TaskRun;
	latestRunEvents?: Parameters<typeof ArtifactPane>[0]["latestRunEvents"];
}) {
	return renderToStaticMarkup(
		<ArtifactPane
			activeProject={project}
			activeSessionId="11111111-1111-4111-8111-111111111111"
			focusType="artifact"
			selectedArtifact={testModeArtifact}
			latestRun={input.latestRun}
			latestRunEvents={input.latestRunEvents}
			taskMessages={input.taskMessages}
			activityArtifacts={[]}
			fileEntries={[]}
			fileEntriesByDirectory={{}}
			expandedDirectories={{}}
			loadingDirectories={{}}
			selectedFile={null}
			selectedFilePath={null}
			isFilesLoading={false}
			isFileLoading={false}
			projectDiff={null}
			isDiffLoading={false}
			onToggleDirectory={async () => undefined}
			onOpenFile={vi.fn()}
			onRefreshFiles={async () => undefined}
			onRefreshDiff={async () => undefined}
			activeTaskStatus={input.activeTaskStatus}
		/>,
	);
}
