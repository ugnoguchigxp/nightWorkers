import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateModuleBoundaries } from "../scripts/check-module-boundaries.mjs";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe("Mission Pilot and Coding Agent role boundaries", () => {
	it("forbids direct imports between role modules", () => {
		const root = createFixture();
		write(
			root,
			"api/modules/missionPilot/mission-pilot.service.ts",
			'import { startCodingAgent } from "../codingAgent/coding-agent.service";\n',
		);
		write(
			root,
			"api/modules/codingAgent/coding-agent.repository.ts",
			"export const startCodingAgent = true;\n",
		);

		const result = evaluateModuleBoundaries(root);

		expect(result.ok).toBe(false);
		expect(result.errors).toContain(
			"api/modules/missionPilot/mission-pilot.service.ts: direct import between role modules is forbidden (api/modules/missionPilot -> api/modules/codingAgent: ../codingAgent/coding-agent.service)",
		);
	});

	it("allows both roles to depend on a neutral shared module", () => {
		const root = createFixture();
		write(
			root,
			"api/modules/missionPilot/mission-pilot.service.ts",
			'import { startRun } from "../taskRun/task-run.command";\nexport const missionPilot = startRun;\n',
		);
		write(
			root,
			"api/modules/codingAgent/coding-agent.service.ts",
			'import { startRun } from "../taskRun/task-run.command";\nexport const codingAgent = startRun;\n',
		);
		write(
			root,
			"api/modules/taskRun/task-run.command.ts",
			"export const startRun = true;\n",
		);

		const result = evaluateModuleBoundaries(root);

		expect(result.ok).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it("allows role modules to use agentsShare but forbids the reverse dependency", () => {
		const root = createFixture();
		write(
			root,
			"api/modules/missionPilot/mission-pilot.service.ts",
			'import { agentEvent } from "../agentsShare/agent-event";\nexport const missionPilot = agentEvent;\n',
		);
		write(
			root,
			"api/modules/agentsShare/agent-event.ts",
			'import { missionPilot } from "../missionPilot/mission-pilot.service";\nexport const agentEvent = missionPilot;\n',
		);

		const result = evaluateModuleBoundaries(root);

		expect(result.ok).toBe(false);
		expect(result.errors).toContain(
			"api/modules/agentsShare/agent-event.ts: agentsShare must not depend on a role module (api/modules/agentsShare -> api/modules/missionPilot: ../missionPilot/mission-pilot.service)",
		);
	});

	it("forbids role-owned production files outside the role module", () => {
		const root = createFixture();
		write(
			root,
			"api/services/mission-pilot-plan.service.ts",
			"export const missionPilotPlan = true;\n",
		);
		write(
			root,
			"api/services/agent-runtime/runtime.ts",
			"export const runtime = true;\n",
		);

		const result = evaluateModuleBoundaries(root);

		expect(result.ok).toBe(false);
		expect(result.errors).toContain(
			"api/services/mission-pilot-plan.service.ts: Mission Pilot production code must live under its role module",
		);
		expect(result.errors).toContain(
			"api/services/agent-runtime/runtime.ts: production code is forbidden under a retired path",
		);
	});

	it("allows explicitly exempt Mission Pilot database schemas", () => {
		const root = createFixture();
		write(
			root,
			"api/db/mission-pilot-schema.ts",
			"export const missionPilotSchema = true;\n",
		);

		const result = evaluateModuleBoundaries(root);

		expect(result.ok).toBe(true);
		expect(result.errors).toEqual([]);
	});
});

function createFixture() {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "nightworkers-role-boundary-"),
	);
	temporaryRoots.push(root);
	write(
		root,
		".agent-ontology/boundary-policy.json",
		JSON.stringify({
			version: 1,
			enforcedPublicApiRoots: [],
			roleModuleRoots: ["api/modules/missionPilot", "api/modules/codingAgent"],
			agentSharedModuleRoots: ["api/modules/agentsShare"],
			roleOwnedPathRules: [
				{
					role: "Mission Pilot",
					markers: ["mission-pilot", "missionPilot"],
					allowedRoots: ["api/modules/missionPilot"],
					exemptPrefixes: ["api/db/"],
				},
				{
					role: "Coding Agent",
					markers: ["coding-agent", "codingAgent"],
					allowedRoots: ["api/modules/codingAgent"],
					exemptPrefixes: [],
				},
			],
			forbiddenProductionPathPrefixes: ["api/services/agent-runtime"],
			domainForbiddenImports: [],
		}),
	);
	return root;
}

function write(root: string, relativePath: string, content: string) {
	const target = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, content);
}
