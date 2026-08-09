import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const modelMocks = vi.hoisted(() => ({
	card: null as null | Record<string, unknown>,
	getCodexToolCardModel: vi.fn(),
	hasCodexToolCard: vi.fn(),
	isNormalCodexToolCardVisible: vi.fn(() => true),
	statusLabel: vi.fn(() => "status-label"),
	codexToolCodeBlockMaxHeight: vi.fn(
		(_card: unknown, debug: boolean, block: string) =>
			`${block}:${debug ? "debug" : "normal"}`,
	),
}));

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineCodexToolCardModel",
	() => ({
		getCodexToolCardModel: modelMocks.getCodexToolCardModel,
		hasCodexToolCard: modelMocks.hasCodexToolCard,
		isNormalCodexToolCardVisible: modelMocks.isNormalCodexToolCardVisible,
		statusLabel: modelMocks.statusLabel,
		codexToolCodeBlockMaxHeight: modelMocks.codexToolCodeBlockMaxHeight,
	}),
);

vi.mock("../src/modules/nightworkers/components/LazyDetails", () => ({
	LazyDetails: ({
		children,
		defaultOpen,
		summary,
	}: {
		children: ReactNode;
		defaultOpen: boolean;
		summary: ReactNode;
	}) => (
		<section data-default-open={String(defaultOpen)}>
			{summary}
			{children}
		</section>
	),
}));

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineMarkdown",
	() => ({
		NightWorkersCodeBlock: ({
			code,
			filename,
			language,
			maxHeight,
		}: {
			code: string;
			filename: string;
			language: string;
			maxHeight: number | string;
		}) => (
			<pre
				data-filename={filename}
				data-language={language}
				data-max-height={String(maxHeight)}
			>
				{code}
			</pre>
		),
	}),
);

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineDiffView",
	() => ({
		DiffCodeBlock: ({ code, label }: { code: string; label: string }) => (
			<div data-diff-label={label}>{code}</div>
		),
	}),
);

import {
	CodexToolCard,
	NormalCodexToolCard,
} from "../src/modules/nightworkers/components/ThreadTimelineCodexToolCard";

const event = {
	kind: "tool.result",
	status: "completed",
	payloadJson: {},
} as never;

function baseCard(overrides: Record<string, unknown> = {}) {
	return {
		lifecycle: "result",
		status: "ok",
		toolName: "nightworkers.todo_list",
		codexKind: "mcp",
		title: "Codex MCP",
		summary: "Todo result",
		metadata: [],
		...overrides,
	};
}

function verification(overrides: Record<string, unknown> = {}) {
	return {
		checkKind: "test",
		state: "passed",
		headline: "テストが完了しました",
		resultText: "tests passed",
		evidence: "saved",
		conditionIds: [],
		...overrides,
	};
}

function normalMarkup(
	card: Record<string, unknown>,
	history?: Record<string, unknown>,
) {
	modelMocks.card = card;
	return renderToStaticMarkup(
		<NormalCodexToolCard
			event={event}
			verificationHistory={history as never}
		/>,
	);
}

function debugMarkup(card: Record<string, unknown>, withSeq = false) {
	modelMocks.card = card;
	return renderToStaticMarkup(
		<CodexToolCard
			event={(withSeq ? { ...event, seq: 17 } : event) as never}
		/>,
	);
}

beforeEach(() => {
	modelMocks.card = null;
	modelMocks.getCodexToolCardModel.mockImplementation(() => modelMocks.card);
	modelMocks.isNormalCodexToolCardVisible.mockReturnValue(true);
	modelMocks.statusLabel.mockReturnValue("status-label");
	modelMocks.codexToolCodeBlockMaxHeight.mockClear();
});

describe("ThreadTimelineCodexToolCard component coverage", () => {
	it("returns no card for absent or normal-mode-hidden models", () => {
		expect(renderToStaticMarkup(<CodexToolCard event={event} />)).toBe("");
		expect(renderToStaticMarkup(<NormalCodexToolCard event={event} />)).toBe(
			"",
		);

		modelMocks.card = baseCard();
		modelMocks.isNormalCodexToolCardVisible.mockReturnValue(false);
		expect(renderToStaticMarkup(<NormalCodexToolCard event={event} />)).toBe(
			"",
		);
	});

	it("renders generic cards with sequence, metadata, previews, and errors", () => {
		const complete = baseCard({
			providerItemId: "provider-17",
			metadata: [
				{ label: "server", value: "nightworkers" },
				{ label: "tool", value: "todo_list" },
				{ label: "operation", value: "done" },
				{ label: "hidden", value: "fourth" },
			],
			argumentsPreview: '{"operation":"done"}',
			resultPreview: '{"ok":true}',
			outputPreview: "saved",
			errorMessage: "warning",
			detailsFilename: "todo.details.txt",
		});
		const debug = debugMarkup(complete, true);
		expect(debug).toContain("#17");
		expect(debug).toContain("providerItemId: provider-17");
		expect(debug).toContain("arguments:");
		expect(debug).toContain("result:");
		expect(debug).toContain("output:");
		expect(debug).toContain("error: warning");
		expect(debug).toContain('data-filename="todo.details.txt"');

		const normal = normalMarkup(complete);
		expect(normal).toContain("status-label");
		expect(normal).toContain("server: nightworkers");
		expect(normal).toContain("operation: done");
		expect(normal).not.toContain("<span>hidden: fourth</span>");
		expect(normal).toContain('data-default-open="false"');
		expect(modelMocks.statusLabel).toHaveBeenCalled();

		const minimal = debugMarkup(baseCard());
		expect(minimal).not.toContain("#17");
		expect(minimal).toContain('data-filename="nightworkers.todo_list.txt"');
	});

	it("renders edit diff cards with and without optional output", () => {
		const edit = baseCard({
			codexKind: "edit_command",
			title: "Codex edit",
			summary: "sed edit | src/app.ts",
			editDiffPreview: {
				label: "sed preview",
				diff: "--- src/app.ts\n+++ src/app.ts\n-old\n+new",
			},
			outputPreview: "updated one file",
			detailsFilename: "sed.output.txt",
		});
		const withOutput = normalMarkup(edit);
		expect(withOutput).toContain("コード変更");
		expect(withOutput).toContain('data-default-open="true"');
		expect(withOutput).toContain('data-diff-label="sed preview"');
		expect(withOutput).toContain("updated one file");
		expect(withOutput).toContain('data-filename="sed.output.txt"');

		const withoutOutput = normalMarkup({ ...edit, outputPreview: undefined });
		expect(withoutOutput).toContain("-old");
		expect(withoutOutput).not.toContain("sed.output.txt");
	});

	it("renders failed, running, pending, and completed command states", () => {
		const failed = normalMarkup(
			baseCard({
				codexKind: "command",
				command: "bun run test",
				commandClass: "verification",
				status: "failed",
				lifecycle: "failed",
				outputPreview: "\n  first failure  \nsecond failure",
				exitCode: 1,
			}),
		);
		expect(failed).toContain("失敗");
		expect(failed).toContain("verification");
		expect(failed).toContain("exit 1");
		expect(failed).toContain("first failure");
		expect(failed).toContain('data-default-open="true"');

		const pending = normalMarkup(
			baseCard({
				codexKind: "command",
				command: "bun run dev",
				commandClass: undefined,
				status: "running",
				lifecycle: "started",
				outputPreview: "  \n",
				exitCode: null,
			}),
		);
		expect(pending).toContain("実行中");
		expect(pending).toContain("exit pending");
		expect(pending).toContain("exitCode=pending");
		expect(pending).toContain('data-default-open="false"');

		const running = normalMarkup(
			baseCard({
				codexKind: "command",
				command: "bun run build",
				status: "ok",
				lifecycle: "progress",
				outputPreview: undefined,
				exitCode: undefined,
			}),
		);
		expect(running).toContain("実行中");

		const completed = debugMarkup(
			baseCard({
				codexKind: "command",
				command: "echo done",
				status: "ok",
				lifecycle: "result",
				outputPreview: undefined,
				exitCode: undefined,
			}),
		);
		expect(completed).toContain("完了");
		expect(completed).toContain('data-max-height="240"');
	});

	it("renders verification evidence, checklist, quality gate, and history variants", () => {
		const rich = normalMarkup(
			baseCard({
				verification: verification({
					command: "bun run verify",
					exitCode: null,
					resultText: "",
					conditionIds: ["AC-1", "AC-2"],
					checklist: {
						complete: false,
						failedRequired: 2,
						unknownRequired: 1,
					},
					qualityGate: {
						passed: false,
						inventory: "passed",
						testExecution: "failed",
						fullVerify: "unknown",
					},
				}),
			}),
			{
				lastFullPass: null,
				freshness: "stale",
				staleReason: "later_verification_failed",
			},
		);
		expect(rich).toContain("完了条件 AC-1, AC-2");
		expect(rich).toContain("証跡を保存済み");
		expect(rich).toContain("終了コード 未確定");
		expect(rich).toContain("未確認の完了条件 3件");
		expect(rich).toContain("Quality Gate: 未通過");
		expect(rich).toContain("Full Verify成功履歴なし");
		expect(rich).toContain("最終Full Verify: 未実行");
		expect(rich).toContain("結果はまだありません。");
		expect(rich).toContain("内部の実行詳細");

		const completeChecklist = normalMarkup(
			baseCard({
				verification: verification({
					state: "failed",
					evidence: "not_saved",
					checklist: {
						complete: true,
						failedRequired: 0,
						unknownRequired: 0,
					},
					qualityGate: {
						passed: true,
						inventory: "passed",
						testExecution: "passed",
						fullVerify: "passed",
					},
				}),
			}),
			{
				lastFullPass: {
					eventId: "full-pass",
					occurredAt: "2026-08-09T01:02:03.000Z",
				},
				freshness: "current",
				staleReason: null,
			},
		);
		expect(completeChecklist).toContain("証跡は未保存");
		expect(completeChecklist).toContain("完了条件をすべて確認済み");
		expect(completeChecklist).toContain("Quality Gate: 通過");
		expect(completeChecklist).toContain("実行時点: Full Verify有効");
		expect(completeChecklist).toContain("Current");

		for (const [state, evidence] of [
			["running", "unknown"],
			["needs_action", "unknown"],
		] as const) {
			const markup = normalMarkup(
				baseCard({ verification: verification({ state, evidence }) }),
			);
			expect(markup).toContain("証跡を確認中");
		}

		const staleChanged = normalMarkup(
			baseCard({ verification: verification() }),
			{
				lastFullPass: { eventId: "old", occurredAt: "" },
				freshness: "stale",
				staleReason: "code_changed",
			},
		);
		expect(staleChanged).toContain("時刻不明");
		expect(staleChanged).toContain("Stale（コード変更後）");

		const staleFailure = normalMarkup(
			baseCard({ verification: verification() }),
			{
				lastFullPass: { eventId: "old", occurredAt: "invalid" },
				freshness: "stale",
				staleReason: "later_verification_failed",
			},
		);
		expect(staleFailure).toContain("Stale（後続の検証失敗）");
	});

	it("renders every Evidence Check confirmation, verify, action, and mapping label", () => {
		const cases = [
			{
				confirmation: "settled",
				verify: "passed",
				suggestedAction: "write_final_report",
				mapping: { status: "not_required", matched: 0, total: 0 },
			},
			{
				confirmation: "confirmed",
				verify: "failed",
				suggestedAction: "confirm_evidence_check",
				mapping: { status: "missing", matched: 1, total: 3 },
			},
			{
				confirmation: "awaiting_confirmation",
				verify: "stale",
				suggestedAction: "record_mapping",
			},
			{
				confirmation: "awaiting_initial_verify",
				verify: "not_run",
				suggestedAction: "fix_verify",
			},
			{
				confirmation: "checking",
				verify: "unknown",
				suggestedAction: "run_verify",
			},
			{
				confirmation: "confirmed",
				verify: "passed",
				suggestedAction: "run_verify",
			},
			{
				confirmation: "unknown",
				verify: "unknown",
				suggestedAction: "wait",
			},
			{
				confirmation: "unknown",
				verify: "unknown",
				suggestedAction: "unknown",
			},
		];
		const markup = cases
			.map((evidenceCheck) =>
				normalMarkup(
					baseCard({
						verification: verification({
							state: "needs_action",
							evidenceCheck,
						}),
					}),
				),
			)
			.join("\n");

		for (const expected of [
			"Evidence Check: 確定済み",
			"Evidence Check: 確認済み",
			"Evidence Check: 確認待ち",
			"Evidence Check: 初回Verify待ち",
			"Evidence Check: 確認中",
			"Evidence Check: 状態未確定",
			"初回Verify: 成功",
			"Follow-up Verify: 失敗",
			"初回Verify: 要再実行",
			"初回Verify: 未実行",
			"初回Verify: 状態未確定",
			"次の操作: 完了報告",
			"次の操作: Evidence Checkを確認",
			"次の操作: テスト対応を記録（任意）",
			"次の操作: Verify失敗を修正",
			"次の操作: Project Verifyを実行",
			"次の操作: Follow-up Verifyを実行",
			"次の操作: 確認結果を待機",
			"次の操作: 状態を確認",
			"テスト対応: 対象外（参考情報）",
			"テスト対応: 1/3（参考情報・完了判定には不使用）",
		]) {
			expect(markup).toContain(expected);
		}
	});
});
