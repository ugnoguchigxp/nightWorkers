import { describe, expect, it } from "vitest";
import { z } from "zod";
import { nightWorkersTodoListInputSchema } from "../api/mcp/nightworkers-tool-schemas";
import { requiresCurrentTodo } from "../api/modules/codingAgent/context/context-packet";
import { renderCodingAgentTodoPlanSummary } from "../api/modules/codingAgent/context/todo-prompt-context";
import { todoCommandJsonSchema } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-manifest";

describe("Coding Agent Todo local SystemContext contract", () => {
	it("gives both runtime lanes the same reminder-oriented Todo field guidance", () => {
		const mcpSchema = JSON.stringify(
			z.toJSONSchema(nightWorkersTodoListInputSchema),
		);
		const nativeSchema = JSON.stringify(todoCommandJsonSchema);
		for (const expected of [
			"最優先で読む局所SystemContext",
			"該当制約、非目標、参照先、判断済み事項、検証条件",
			"共通SystemContextや設計書全文は複製しない",
			"観測可能な条件",
		]) {
			expect(mcpSchema).toContain(expected);
			expect(nativeSchema).toContain(expected);
		}
		expect(mcpSchema).toContain('"required":["title","systemContext"');
		expect(nativeSchema).toContain(
			'"required":["title","systemContext","nextAction"]',
		);
		expect(mcpSchema).toContain('"maxItems":12');
		expect(nativeSchema).toContain('"maxItems":12');
	});

	it("requires a current Todo only after the LLM adopts a Todo plan", () => {
		const packet = {
			planSummary: { todos: [] },
			currentTodo: null,
		};
		expect(requiresCurrentTodo(packet)).toBe(false);
		expect(
			requiresCurrentTodo({
				...packet,
				planSummary: { todos: [{ id: "todo-1" }] },
			}),
		).toBe(true);
		expect(
			requiresCurrentTodo({
				...packet,
				planSummary: { todos: [{ id: "todo-1" }] },
				currentTodo: { id: "todo-1" },
			}),
		).toBe(false);
	});

	it("bounds accumulated terminal Todo summaries while retaining active work", () => {
		const summary = renderCodingAgentTodoPlanSummary([
			...Array.from({ length: 30 }, (_, index) => ({
				id: `done-${index + 1}`,
				seq: index + 1,
				title: `完了 ${index + 1}`,
				taskType: "coding",
				status: "passed",
			})),
			{
				id: "active",
				seq: 31,
				title: "現在の実装",
				taskType: "implementation",
				status: "running",
			},
		]);

		expect(summary).toContain('"id":"active"');
		expect(summary).toContain('"status":"running"');
		expect(summary).toContain('"id":"done-30"');
		expect(summary).not.toContain('"id":"done-1"');
		expect(summary).toContain("Omitted terminal Todo count: 26");
	});
});
