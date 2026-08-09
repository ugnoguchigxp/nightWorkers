import { describe, expect, it } from "vitest";
import {
	buildOpenTodoRuntimeContractWarning,
	dedupeRuntimeContractWarnings,
	mergeRuntimeContractSnapshot,
	normalizeRuntimeContractWarnings,
	summarizeRuntimeContractWarnings,
} from "../api/modules/codingAgent/runtime/shared/runtime-contract";

describe("runtime contract coverage", () => {
	it("rejects invalid warnings and normalizes every optional field", () => {
		expect(normalizeRuntimeContractWarnings(null)).toEqual([]);
		const warnings = normalizeRuntimeContractWarnings([
			null,
			[],
			{},
			{ code: 1, message: "bad" },
			{
				code: "FULL",
				message: "full",
				severity: "error",
				providerItemId: "provider",
				toolName: "tool",
				todoId: "todo",
				todoSeq: 2,
				changedFiles: ["a.ts", 1, "b.ts"],
				command: "npm test",
				todoEvidenceSource: "db",
				sequence: -2.7,
				occurredAt: "now",
				count: 2.9,
			},
			{
				code: "DEFAULTS",
				message: "defaults",
				severity: "invalid",
				providerItemId: 1,
				changedFiles: null,
				todoEvidenceSource: "invalid",
				sequence: Number.POSITIVE_INFINITY,
				count: Number.NaN,
			},
		]);
		expect(warnings).toEqual([
			expect.objectContaining({
				code: "FULL",
				severity: "error",
				changedFiles: ["a.ts", "b.ts"],
				sequence: 0,
				count: 2,
			}),
			expect.objectContaining({
				code: "DEFAULTS",
				severity: "warning",
				providerItemId: null,
				changedFiles: undefined,
				sequence: undefined,
			}),
		]);
	});

	it("deduplicates by identity fields and accumulates bounded counts", () => {
		const first = {
			code: "DUP",
			severity: "info" as const,
			message: "first",
			providerItemId: null,
			toolName: null,
			todoId: null,
			todoSeq: null,
			count: 0,
		};
		const merged = dedupeRuntimeContractWarnings([
			first,
			{ ...first, message: "second", count: 3 },
			{ ...first, code: "OTHER", changedFiles: ["a.ts"] },
		]);
		expect(merged).toHaveLength(2);
		expect(merged[0]?.count).toBe(4);
	});

	it("summarizes by severity, count, then code", () => {
		const summary = summarizeRuntimeContractWarnings([
			{ code: "B", message: "b", severity: "warning", count: 2 },
			{ code: "A", message: "a", severity: "warning", count: 2 },
			{ code: "B", message: "b2", severity: "error", count: 1 },
			{ code: "I", message: "i", severity: "info", count: 4 },
		]);
		expect(summary).toEqual({
			totalCount: 9,
			warningCount: 2,
			errorCount: 3,
			codes: [
				{ code: "B", severity: "error", count: 3 },
				{ code: "A", severity: "warning", count: 2 },
				{ code: "I", severity: "info", count: 4 },
			],
		});
	});

	it("merges legacy Codex warnings into a runtime snapshot", () => {
		const merged = mergeRuntimeContractSnapshot(
			{
				keep: true,
				runtimeContract: {
					lane: "existing",
					warnings: [{ code: "A", message: "a", severity: "warning" }],
				},
				codexContract: {
					warnings: [{ code: "B", message: "b", severity: "error" }],
				},
			},
			[{ code: "A", message: "again", severity: "warning" }],
			{ lane: "native-api" },
		);
		expect(merged).toMatchObject({
			keep: true,
			runtimeContract: {
				lane: "native-api",
				warningSummary: { totalCount: 3, errorCount: 1, warningCount: 2 },
			},
		});
		expect(
			mergeRuntimeContractSnapshot([], [], {}).runtimeContract.lane,
		).toBeNull();
		expect(
			mergeRuntimeContractSnapshot(
				{ runtimeContract: [], codexContract: [] },
				[],
				{},
			).runtimeContract.warnings,
		).toEqual([]);
	});

	it("builds open-Todo warnings with and without an item", () => {
		expect(
			buildOpenTodoRuntimeContractWarning([
				{ id: "todo-1", seq: 3, title: "Test" },
			]),
		).toMatchObject({ todoId: "todo-1", todoSeq: 3 });
		expect(buildOpenTodoRuntimeContractWarning([])).toMatchObject({
			todoId: null,
			todoSeq: null,
		});
	});
});
