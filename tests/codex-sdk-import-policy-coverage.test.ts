import { describe, expect, it } from "vitest";
import {
	buildProjectImportCancelledReport,
	buildProjectImportFailureReport,
	getProjectImportOutcome,
} from "../api/modules/codingAgent/runtime/codex-sdk/codex-sdk-import-policy";

function event(payload: unknown, type = "tool_call_finished") {
	return { type, payload } as never;
}

function importPayload(overrides: Record<string, unknown> = {}) {
	return {
		toolName: "nightworkers.import_project",
		providerItemId: "provider-1",
		status: "completed",
		...overrides,
	};
}

describe("Codex SDK project import policy coverage", () => {
	it("ignores unrelated runtime events, tools, and successful imports", () => {
		expect(getProjectImportOutcome(event({}, "tool_call_started"))).toBeNull();
		expect(getProjectImportOutcome(event(null))).toBeNull();
		expect(
			getProjectImportOutcome(event({ toolName: "import_project" })),
		).toBeNull();
		expect(getProjectImportOutcome(event(importPayload()))).toBeNull();
	});

	it("projects cancellation with and without a provider item", () => {
		const identified = getProjectImportOutcome(
			event(importPayload({ status: "cancelled" })),
		);
		const anonymous = getProjectImportOutcome(
			event(importPayload({ status: "cancelled", providerItemId: 7 })),
		);
		expect(identified).toEqual({
			kind: "cancelled",
			toolName: "nightworkers.import_project",
			providerItemId: "provider-1",
		});
		expect(anonymous).toMatchObject({ providerItemId: null });
		expect(buildProjectImportCancelledReport(identified as never)).toContain(
			"providerItemId=provider-1",
		);
		expect(buildProjectImportCancelledReport(anonymous as never)).not.toContain(
			"providerItemId",
		);
	});

	it("reads explicit, direct, structured, and content error messages", () => {
		const cases = [
			[importPayload({ error: "explicit" }), "explicit"],
			[importPayload({ result: { error: { message: "direct" } } }), "direct"],
			[
				importPayload({
					result: { structuredContent: { error: { message: "structured" } } },
				}),
				"structured",
			],
			[
				importPayload({
					result: {
						content: [
							null,
							{ text: "" },
							{ text: "{" },
							{ text: JSON.stringify({ error: { message: "content" } }) },
						],
					},
				}),
				"content",
			],
		] as const;
		for (const [payload, message] of cases) {
			expect(getProjectImportOutcome(event(payload))).toMatchObject({
				kind: "failed",
				error: message,
				retryableTransportCancel: false,
			});
		}
	});

	it("falls back for failed and MCP error results", () => {
		expect(
			getProjectImportOutcome(
				event(importPayload({ status: "failed", result: {} })),
			),
		).toMatchObject({ error: "nightworkers.import_project failed" });
		expect(
			getProjectImportOutcome(
				event(importPayload({ result: { isError: true } })),
			),
		).toMatchObject({
			error: "NightWorkers MCP tool returned an error result.",
		});
		expect(
			getProjectImportOutcome(
				event(importPayload({ result: [], status: "failed" })),
			),
		).toMatchObject({ error: "nightworkers.import_project failed" });
	});

	it("only marks the exact transport cancellation shape as retryable", () => {
		for (const result of [null, undefined]) {
			expect(
				getProjectImportOutcome(
					event(
						importPayload({
							status: "failed",
							error: "user cancelled MCP tool call",
							result,
						}),
					),
				),
			).toMatchObject({ retryableTransportCancel: true });
		}
		expect(
			getProjectImportOutcome(
				event(
					importPayload({
						status: "failed",
						error: "user cancelled MCP tool call",
						result: {},
					}),
				),
			),
		).toMatchObject({ retryableTransportCancel: false });
	});

	it("builds retryable and ordinary failure reports", () => {
		const retryable = getProjectImportOutcome(
			event(
				importPayload({
					status: "failed",
					error: "user cancelled MCP tool call",
					result: null,
				}),
			),
		);
		const ordinary = getProjectImportOutcome(
			event(
				importPayload({
					status: "failed",
					error: "denied",
					providerItemId: null,
				}),
			),
		);
		expect(buildProjectImportFailureReport(retryable as never)).toContain(
			"before the MCP server returned",
		);
		expect(buildProjectImportFailureReport(ordinary as never)).toBe(
			"Project import failed: denied. Stopping without fallback implementation.",
		);
	});
});
