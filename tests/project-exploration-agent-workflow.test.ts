import { describe, expect, it } from "vitest";
import { buildProjectExplorationAgentWorkflow } from "../api/modules/ontology/exploration/project-exploration-agent-workflow";

describe("Project Exploration agent workflow", () => {
	it("requires one catalog lookup before planning or workspace exploration when available", () => {
		const workflow = buildProjectExplorationAgentWorkflow({
			version: 2,
			available: true,
			preparationStatus: "ready",
			preparedAt: "2026-08-09T00:00:00.000Z",
			freshness: {
				status: "fresh",
				sourceRevision: { kind: "git_commit", value: "abc123" },
			},
			readiness: {
				codeStructure: "ready",
				usability: "ready",
				reasonCodes: [],
				coverage: {
					moduleCount: 1,
					edgeCount: 1,
					symbolCount: 1,
					entrypointCount: 1,
					testMappingCount: 1,
				},
			},
			preparation: {
				reused: false,
				durationMs: 1,
				pollCount: 0,
			},
		} as never);

		expect(workflow).toMatchObject({
			availability: "available",
			capability: "project_exploration_catalog",
		});
		const instructions = workflow.instructionsJa.join("\n");
		expect(instructions).toContain(
			"最初のTodo計画、read_current_specification、list_dir、search_files、read_fileより前",
		);
		expect(instructions).toContain("既知の候補fileがあっても");
		expect(instructions).toContain("省略しない");
	});

	it("keeps the catalog unavailable path fail-open", () => {
		const workflow = buildProjectExplorationAgentWorkflow(null);

		expect(workflow).toMatchObject({
			availability: "unavailable",
			reason: "run_capability_missing",
		});
		expect(workflow.instructionsJa.join("\n")).toContain(
			"通常のworkspace toolで探索",
		);
	});
});
