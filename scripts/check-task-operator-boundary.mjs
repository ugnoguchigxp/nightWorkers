import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

function walk(directory) {
	if (!fs.existsSync(directory)) return [];
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const target = path.join(directory, entry.name);
		return entry.isDirectory()
			? walk(target)
			: /\.(?:ts|tsx|js|mjs)$/.test(entry.name)
				? [target]
				: [];
	});
}
function source(relative) {
	return fs.readFileSync(path.join(root, relative), "utf8");
}
function forbid(relative, patterns) {
	const value = source(relative);
	for (const [pattern, reason] of patterns) {
		if (pattern.test(value)) errors.push(`${relative}: ${reason}`);
	}
}

for (const file of walk(path.join(root, "api/modules/codingAgent"))) {
	const relative = path.relative(root, file);
	const value = fs.readFileSync(file, "utf8");
	if (/mission_pilot|Mission Pilot|missionPilot/i.test(value))
		errors.push(`${relative}: Coding Agent must not reference Mission Pilot`);
}

for (const file of walk(
	path.join(root, "packages/mission-pilot/src/backend/runtime"),
)) {
	const relative = path.relative(root, file);
	if (relative.includes(`${path.sep}routes${path.sep}`) && relative.includes("fixture"))
		continue;
	const value = fs.readFileSync(file, "utf8");
	if (/from\s+["'][^"']*(?:modules\/)?codingAgent(?:\/|["'])/.test(value))
		errors.push(`${relative}: Mission Pilot must not import Coding Agent`);
	if (
		/from\s+["'][^"']*agentsShare\/(?:contracts|ports)\/coding-agent-run/.test(
			value,
		)
	)
		errors.push(
			`${relative}: Mission Pilot must not import a Coding Agent role contract`,
		);
	if (/coding_agent\.requested/.test(value))
		errors.push(
			`${relative}: Mission Pilot must not parse Coding Agent event payloads`,
		);
	if (
		/from\s+["'][^"']*db\/(?:schema(?:-task[^"']*)?|design-questionnaire-schema)["']/.test(
			value,
		) &&
		!relative.endsWith("mission-pilot-thought-projection.ts")
	)
		errors.push(
			`${relative}: Mission Pilot must read Task, Run, Queue, Questionnaire, and Artifact facts through Task Operator`,
		);
}

for (const file of [
	...walk(path.join(root, "api")),
	...walk(path.join(root, "shared")),
]) {
	const relative = path.relative(root, file);
	const value = fs.readFileSync(file, "utf8");
	if (/CodingAgentInvocationSource|codingAgentInvocationSource/.test(value))
		errors.push(`${relative}: requester provenance must not select Coding Agent behavior`);
}

forbid("packages/mission-pilot/src/backend/runtime/agent/mission-pilot-task-read.adapter.ts", [
	[/db\/(?:schema|client)/, "Task read adapter must use Task Operator public queries"],
]);
forbid("packages/mission-pilot/src/backend/runtime/agent/mission-pilot-task-action.adapter.ts", [
	[/db\/schema(?:-task-execution)?/, "Task action adapter must not read domain tables"],
]);
forbid("packages/mission-pilot/src/backend/runtime/agent/mission-pilot-action-command-executor.ts", [
	[/start-task-run|startTaskRun\(/, "Mission Pilot must use StartCodingAgentRun through Task Operator"],
]);
forbid("api/workers/task-run-worker.ts", [
	[/missionPilot|MissionPilot/, "Coding Agent worker must start without Mission Pilot"],
]);
forbid("api/server.ts", [
	[/resumeMissionPilotPlanPipelines|initializeMissionPilotTaskRunCloseout/, "legacy runtime must not activate in production"],
]);

for (const file of walk(path.join(root, "api/modules/taskOperator"))) {
	const relative = path.relative(root, file);
	const value = fs.readFileSync(file, "utf8");
	if (/from\s+["'][^"']*(?:db\/|\.repository|repository\.)/.test(value))
		errors.push(`${relative}: Task Operator must compose domain public APIs only`);
	if (
		/missionPilotAction|missionPilotAdmission|missionPilotAgent|MissionPilotAgent/.test(
			value,
		)
	)
		errors.push(`${relative}: Task Operator must remain role-neutral`);
}
for (const file of walk(path.join(root, "api/modules/queue"))) {
	const relative = path.relative(root, file);
	const value = fs.readFileSync(file, "utf8");
	if (
		/missionPilotAction|missionPilotAdmission|missionPilotAgent|MissionPilotAgent/.test(
			value,
		)
	)
		errors.push(`${relative}: Queue must remain role-neutral`);
}
for (const file of walk(path.join(root, "shared/modules/taskOperator"))) {
	const relative = path.relative(root, file);
	if (fs.readFileSync(file, "utf8").includes("z.unknown("))
		errors.push(`${relative}: Task Operator schema must be strict and concrete`);
}

if (errors.length > 0) {
	console.error("[architecture] Task Operator boundary check failed");
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}
console.log("[architecture] Task Operator, Mission Pilot, and Coding Agent boundaries are isolated");
