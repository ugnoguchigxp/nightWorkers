import { describe, expect, it } from "vitest";
import { z } from "zod";
import { nightWorkersTodoListInputSchema } from "../api/mcp/nightworkers-tool-schemas";
import { todoCommandJsonSchema } from "../api/services/agent-runtime/native-api-runner/native-api-tool-manifest";

describe("Coding Agent Todo local SystemContext contract", () => {
	it("gives both runtime lanes the same reminder-oriented Todo field guidance", () => {
		const mcpSchema = JSON.stringify(
			z.toJSONSchema(nightWorkersTodoListInputSchema),
		);
		const nativeSchema = JSON.stringify(todoCommandJsonSchema);
		for (const expected of [
			"局所SystemContext兼リマインダー",
			"quality gate、verify、template/import、安全規則",
			"共通SystemContextや設計書全文は複製しない",
			"観測可能な条件",
		]) {
			expect(mcpSchema).toContain(expected);
			expect(nativeSchema).toContain(expected);
		}
	});
});
