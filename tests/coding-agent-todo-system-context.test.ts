import { describe, expect, it } from "vitest";
import { z } from "zod";
import { nightWorkersTodoListInputSchema } from "../api/mcp/nightworkers-tool-schemas";
import { requiresCurrentTodo } from "../api/modules/codingAgent/context/context-packet";
import { renderCodingAgentTodoPlanSummary } from "../api/modules/codingAgent/context/todo-prompt-context";
import { todoCommandJsonSchema } from "../api/modules/codingAgent/runtime/native-api-runner/native-api-tool-manifest";

describe("Coding Agent Todo local SystemContext contract", () => {
	it("gives both runtime lanes the same minimal Todo step contract", () => {
		const mcpSchema = JSON.stringify(
			z.toJSONSchema(nightWorkersTodoListInputSchema),
		);
		const nativeSchema = JSON.stringify(todoCommandJsonSchema);
		expect(mcpSchema).toContain(
			"stepで生成するfieldはtitleとsystemContextだけ",
		);
		expect(nativeSchema).toContain("この工程で最優先する1〜3文の局所指示");
		expect(mcpSchema).toContain('"required":["title","systemContext"');
		expect(nativeSchema).toContain('"required":["title","systemContext"]');
		expect(mcpSchema).toContain('"maxItems":12');
		expect(nativeSchema).toContain('"maxItems":12');
		for (const removedField of [
			"nextAction",
			"acceptanceCriteria",
			"dependsOn",
			"objective",
		]) {
			expect(mcpSchema).not.toContain(removedField);
			expect(nativeSchema).not.toContain(removedField);
		}
	});

	it("rejects extra generated fields instead of silently discarding them", () => {
		expect(
			nightWorkersTodoListInputSchema.safeParse({
				command: {
					op: "plan",
					steps: [
						{
							title: "実装",
							systemContext: "対象を実装する。",
							doneWhen: "完了する。",
						},
					],
				},
			}).success,
		).toBe(false);
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

	it("summarizes progress and next work without replaying current detail or history", () => {
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

		expect(summary).not.toContain('"id":"active"');
		expect(summary).not.toContain('"title":"現在の実装"');
		expect(summary).toContain('"terminal":30');
		expect(summary).not.toContain('"id":"done-30"');
		expect(summary).not.toContain('"id":"done-1"');
	});
});
