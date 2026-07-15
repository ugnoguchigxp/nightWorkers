import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const agentRoot = path.resolve("api/modules/missionPilot/agent");

describe("Mission Pilot no-transcript boundary", () => {
	it("does not import worker turns, tool calls, logs, or stream subscriptions", () => {
		const sources = fs
			.readdirSync(agentRoot)
			.filter((name) => name.endsWith(".ts"))
			.map((name) => fs.readFileSync(path.join(agentRoot, name), "utf8"))
			.join("\n");
		for (const forbidden of [
			"nativeApiTurns",
			"nativeApiToolCalls",
			"logContent",
			"diffPatch",
			"registerTaskRunStream",
			"tool_result history",
		]) {
			expect(sources).not.toContain(forbidden);
		}
	});

	it("keeps native turn precedence inside the public outcome seam only", () => {
		const seam = fs.readFileSync(
			path.resolve("api/services/agent-runtime/public-run-outcome.ts"),
			"utf8",
		);
		expect(seam).toContain("nativeApiTurns");
		expect(seam).toContain("lastAssistantContent");
	});
});
