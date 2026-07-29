import { describe, expect, it } from "vitest";
import { buildImplementationDirectRunFixtureTurns } from "../api/e2eFixtures/implementation-direct-run-fixture";

describe("isolated Coding Agent implementation fixture", () => {
	it("uses only the public provider-tool contract in a stable sequence", () => {
		const turns = buildImplementationDirectRunFixtureTurns();
		expect(turns.map((turn) => turn.toolCalls[0]?.name ?? null)).toEqual([
			"read_file",
			"todo_list",
			"apply_patch",
			"run_verification",
			"git_diff",
			"todo_list",
			null,
		]);
		expect(
			turns.flatMap((turn) => turn.toolCalls).map((call) => call.name),
		).not.toContain("execute_task_action");
	});
});
