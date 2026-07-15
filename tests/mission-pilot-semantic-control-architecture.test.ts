import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const agentRoot = path.resolve("api/modules/missionPilot/agent");

describe("Mission Pilot agent semantic-control architecture", () => {
	it("does not reintroduce fixed domain phase transitions or Todo projections", () => {
		const source = fs
			.readdirSync(agentRoot)
			.filter((name) => name.endsWith(".ts"))
			.map((name) => fs.readFileSync(path.join(agentRoot, name), "utf8"))
			.join("\n");
		for (const forbidden of [
			"MissionPilotPostQueuePhase",
			"implementationCycle",
			"testCycle",
			"reviewCycle",
			"missionPilotPhaseRuns",
			"missionPilotTestSnapshots",
			"missionPilotReviewDecisions",
			"missionPilotCloseouts",
			"start_test",
			"start_review",
			"run_closeout",
			"repository_bootstrapping",
			"implementation_todo",
		]) {
			expect(source).not.toContain(forbidden);
		}
	});

	it("uses only lifecycle state names in the new runtime", () => {
		const runtime = fs.readFileSync(
			path.join(agentRoot, "mission-pilot-agent-runtime.ts"),
			"utf8",
		);
		for (const lifecycle of ["running", "waiting", "attention", "stopped"])
			expect(runtime).toContain(`"${lifecycle}"`);
	});

	it("routes questionnaire-ready through a typed event before legacy autonomy", () => {
		const source = fs.readFileSync(
			path.resolve(
				"api/modules/missionPilot/mission-pilot-questionnaire.service.ts",
			),
			"utf8",
		);
		const agentBranch = source.indexOf('pilot?.runtimeKind === "agent"');
		const legacyDraft = source.indexOf(
			"const generated = buildMissionPilotQuestionnaireDraft",
			agentBranch,
		);
		expect(agentBranch).toBeGreaterThan(-1);
		expect(source.slice(agentBranch, legacyDraft)).toContain(
			"recordMissionPilotQuestionnaireReady(session)",
		);
		const adapter = fs.readFileSync(
			path.join(agentRoot, "mission-pilot-questionnaire-event.adapter.ts"),
			"utf8",
		);
		expect(adapter).toContain('type: "questionnaire.ready"');
		expect(agentBranch).toBeLessThan(legacyDraft);
	});
});
