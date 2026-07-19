import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const forbiddenFiles = [
	"api/services/run-control/run-control-service.ts",
	"api/services/run-control/run-control-reducer.ts",
	"api/services/run-control/run-budget-controller.ts",
	"api/modules/codingAgent/runtime/native-api-runner/native-api-finalize.ts",
	"api/modules/codingAgent/runtime/native-api-runner/native-api-startup-controller.ts",
	"api/modules/codingAgent/runtime/native-api-runner/native-api-role-context-events.ts",
	"api/modules/codingAgent/runtime/native-api-runner/native-api-role-handoff.ts",
	"api/modules/codingAgent/runtime/native-api-runner/native-api-role-working-context.ts",
	"api/modules/codingAgent/runtime/codex-contract-warning-catalog.ts",
	"api/modules/codingAgent/runtime/codex-runtime-failure-report.ts",
	"api/modules/nightworkers/run-orchestration/coverage-autonomy.ts",
	"api/services/quality/coverage-autonomy-gate.ts",
	"api/services/worker-tools/reviewer-evaluation.ts",
];
const forbiddenToolNames = ["finalize_answer", "new_context", "reviewer_evaluation"];
const catalogFiles = [
	"api/modules/codingAgent/runtime/native-api-runner/native-api-tool-manifest.ts",
	"api/modules/codingAgent/runtime/native-api-runner/native-api-tool-registry.ts",
	"api/mcp/nightworkers-tool-manifest.ts",
];
const errors = [];

for (const file of forbiddenFiles) {
	if (fs.existsSync(path.join(root, file)))
		errors.push(`${file}: legacy semantic control must be deleted`);
}
for (const file of catalogFiles) {
	const source = fs.readFileSync(path.join(root, file), "utf8");
	for (const name of forbiddenToolNames) {
		if (source.includes(name)) errors.push(`${file}: forbidden runtime tool ${name}`);
	}
}
const routes = fs.readFileSync(
	path.join(root, "api/modules/nightworkers/nightworkers.routes.ts"),
	"utf8",
);
for (const route of ["createReviewSessionRoute", "startReviewRunRoute", "createRunReviewRoute"]) {
	if (routes.includes(route)) errors.push(`nightworkers.routes.ts: dedicated Review route ${route}`);
}

for (const file of [
	"src/modules/nightworkers/nightWorkersCommands.ts",
	"src/modules/nightworkers/hooks/useNightWorkersMutations.ts",
	"src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts",
]) {
	const source = fs.readFileSync(path.join(root, file), "utf8");
	for (const symbol of [
		"startTestModeRun",
		"submitRunReview",
		"startReviewSession",
		"startReviewRun",
	]) {
		if (source.includes(symbol)) {
			errors.push(`${file}: legacy Test / Review UI action ${symbol}`);
		}
	}
}

for (const [file, forbiddenText] of [
	[
		"api/modules/codingAgent/application/run-finalize-controller.ts",
		"terminalize(",
	],
	[
		"api/modules/codingAgent/runtime/native-api-runner/native-api-tool-registry.ts",
		"isNativeApiToolAllowedForMode",
	],
	[
		"api/modules/codingAgent/runtime/native-api-runner/native-api-tool-manifest.ts",
		"In planning mode",
	],
]) {
	const source = fs.readFileSync(path.join(root, file), "utf8");
	if (source.includes(forbiddenText)) {
		errors.push(`${file}: legacy semantic control ${forbiddenText}`);
	}
}

const agentRuntimeRoot = path.join(root, "api/modules/codingAgent/runtime");
const forbiddenProviderRetryControls = [
	"providerCapacityRetry",
	"readRuntimeFailureEvidence",
	"canRetryProviderCapacity",
	"emitProviderCapacityRetry",
];
for (const file of fs.readdirSync(agentRuntimeRoot, { recursive: true })) {
	if (typeof file !== "string" || !file.endsWith(".ts")) continue;
	const absolutePath = path.join(agentRuntimeRoot, file);
	const source = fs.readFileSync(absolutePath, "utf8");
	for (const symbol of forbiddenProviderRetryControls) {
		if (source.includes(symbol)) {
			errors.push(
				`${path.relative(root, absolutePath)}: forbidden provider retry control ${symbol}`,
			);
		}
	}
}

for (const file of [
	"api/modules/nightworkers/run-orchestration/start-task-run-types.ts",
	"api/modules/missionPilot/mission-pilot-runtime-continuation.service.ts",
]) {
	const source = fs.readFileSync(path.join(root, file), "utf8");
	if (source.includes("resumeTodosFromRunId")) {
		errors.push(`${file}: legacy cross-Run Todo migration option`);
	}
}

const todoRepository = fs.readFileSync(
	path.join(root, "api/modules/nightworkers/nightworkers.runs.repository.ts"),
	"utf8",
);
for (const writer of [
	"createTaskRunTodo",
	"replaceTaskRunTodosForRun",
	"updateTaskRunTodo",
	"startTaskRunTodoIfStillPendingAndNoEarlierOpen",
]) {
	if (todoRepository.includes(writer)) {
		errors.push(`nightworkers.runs.repository.ts: legacy Todo writer ${writer}`);
	}
}

for (const file of [
	"api/db/schema-task-execution.ts",
	"api/db/base-schema-bootstrap.ts",
]) {
	const source = fs.readFileSync(path.join(root, file), "utf8");
	if (source.includes("task_run_control_states")) {
		errors.push(`${file}: legacy semantic Run Control state table`);
	}
}

if (errors.length > 0) {
	console.error("[architecture] Coding Agent semantic-control check failed");
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}
console.log("[architecture] Coding Agent runtime has no legacy semantic-control registry entries");
