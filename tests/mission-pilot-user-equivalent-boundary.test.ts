import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

function files(directory: string): string[] {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const target = path.join(directory, entry.name);
		return entry.isDirectory()
			? files(target)
			: entry.name.endsWith(".ts")
				? [target]
				: [];
	});
}

function activeMissionPilotSources() {
	return files(path.join(root, "packages/mission-pilot/src/backend/runtime"))
		.filter(
			(file) =>
				!(
					file.includes(`${path.sep}routes${path.sep}`) &&
					file.includes("fixture")
				),
		)
		.map((file) => ({
			file: path.relative(root, file),
			source: fs.readFileSync(file, "utf8"),
		}));
}

describe("Mission Pilot user-equivalent boundary", () => {
	it("has no Coding Agent import, role contract, or event-payload dependency", () => {
		for (const { file, source } of activeMissionPilotSources()) {
			expect(source, `${file} imports Coding Agent implementation`).not.toMatch(
				/from\s+["'][^"']*(?:modules\/)?codingAgent(?:\/|["'])/,
			);
			expect(
				source,
				`${file} imports a Coding Agent role contract`,
			).not.toMatch(
				/from\s+["'][^"']*agentsShare\/(?:contracts|ports)\/coding-agent-run/,
			);
			expect(source, `${file} parses a Coding Agent event`).not.toContain(
				"coding_agent.requested",
			);
		}
	});

	it("cannot inspect repository folders or Git state directly", () => {
		for (const { file, source } of activeMissionPilotSources()) {
			expect(
				source,
				`${file} imports a filesystem or process inspection API`,
			).not.toMatch(
				/from\s+["']node:(?:child_process|fs|fs\/promises|path)["']/,
			);
			expect(
				source,
				`${file} imports repository inspection implementation`,
			).not.toMatch(
				/from\s+["'][^"']*(?:gitworktree|queue-repository-readiness|project-repository-identity|repository-state)(?:\/|["'])/,
			);
		}
	});

	it("dispatches the initial prompt through the shared user intake boundary", () => {
		const source = fs.readFileSync(
			path.join(
				root,
				"packages/mission-pilot/src/backend/runtime/mission-pilot-initial-prompt.service.ts",
			),
			"utf8",
		);
		expect(source).toContain("submitTaskUserIntake");
		expect(source).not.toContain("run.implementation.start");
		expect(source).not.toContain("startCodingAgentRun");
		expect(source).not.toContain("repositoryRef");
	});

	it("does not wake the agent merely because a Coding Agent Run started", () => {
		const source = fs.readFileSync(
			path.join(
				root,
				"packages/mission-pilot/src/backend/runtime/mission-pilot.service.ts",
			),
			"utf8",
		);
		expect(source).toContain('if (event.type === "task.run.started") return;');
	});

	it("removes legacy repository inspection fields from private context", async () => {
		const { sanitizeMissionPilotContext } = await import(
			"@nightworkers/mission-pilot/testing"
		);
		expect(
			sanitizeMissionPilotContext({
				version: 1,
				repository: { localPath: "/project" },
				session: {
					id: "session-1",
					repositoryId: "repository-1",
					worktreePath: "/worktree",
				},
				task: {
					title: "Task",
					repoRoot: "/project",
					gitHead: "abc123",
					materialization: { kind: "existing_git" },
				},
				plan: { revision: 2 },
			}),
		).toEqual({
			version: 1,
			session: { id: "session-1" },
			task: { title: "Task" },
			plan: { revision: 2 },
		});
	});

	it("does not read canonical Task, Run, Queue, or Questionnaire tables", () => {
		for (const { file, source } of activeMissionPilotSources()) {
			if (file.endsWith("mission-pilot-thought-projection.ts")) continue;
			expect(source, `${file} imports a canonical domain table`).not.toMatch(
				/from\s+["'][^"']*db\/(?:schema(?:-task[^"']*)?|design-questionnaire-schema)["']/,
			);
		}
	});

	it("keeps Task Operator and Queue role-neutral", () => {
		for (const directory of [
			"api/modules/taskOperator",
			"api/modules/queue",
			"shared/modules/taskOperator",
		]) {
			for (const file of files(path.join(root, directory))) {
				const source = fs.readFileSync(file, "utf8");
				expect(
					source,
					`${path.relative(root, file)} contains Mission Pilot-specific state`,
				).not.toMatch(
					/missionPilotAction|missionPilotAdmission|missionPilotAgent|MissionPilotAgent/,
				);
			}
		}
	});

	it("exposes only the seven generic Mission Pilot tools", async () => {
		const { missionPilotToolDefinitions } = await import(
			"@nightworkers/mission-pilot/testing"
		);
		expect(missionPilotToolDefinitions().map((tool) => tool.name)).toEqual([
			"read_task_operator_view",
			"read_task_resource",
			"list_available_task_actions",
			"read_task_action_contract",
			"execute_task_action",
			"agent.wait_for_event",
			"agent.finish",
		]);
	}, 15_000);
});
