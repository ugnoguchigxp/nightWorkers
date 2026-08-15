import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, unlinkSync } from "node:fs";
import path from "node:path";
import {
	createRepository,
	createTask,
	listTasks,
} from "../api/modules/nightworkers/nightworkers.basic.service";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import {
	measureProjectExplorationRun,
	summarizeProjectExplorationPair,
} from "../api/modules/ontology/exploration/project-exploration-measurement";
import { saveProjectExplorationCatalogSettings } from "../api/modules/ontology/exploration/project-exploration-settings.service";
import { startTaskRun } from "../api/modules/nightworkers/run-orchestration/start-task-run";
import { listTaskEventsForRun } from "../api/modules/nightworkers/nightworkers.runs-event.repository";
import { listLlmUsageRecordsForRun } from "../api/services/llm-usage/repository";
import { mcpClientManager } from "../api/services/mcp/mcp-client-manager";
import {
	createMcpServer,
	listMcpServers,
	updateMcpServer,
} from "../api/services/mcp/mcp-settings";
import { resolveStructuredLlmRoleRoute } from "../api/services/structured-llm/role-routing";
import { readStructuredLlmProviderSettings } from "../api/services/structured-llm/settings";
import { getRuntimePaths } from "../api/runtime/paths";
import {
	DATABASE_ACCESS_SCOPES,
	assertIsolatedRuntimeEnvironment,
	resolveLocalDatabasePath,
} from "../shared/runtime-database-access.mjs";
import {
	parsePilotOptions,
	type PilotOptions,
} from "./project-exploration-pilot/options";
import {
	buildPilotReport,
	pilotPromptDigest,
} from "./project-exploration-pilot/report";
import {
	PILOT_TASKS,
	type PilotTask,
} from "./project-exploration-pilot/tasks";

const POLL_INTERVAL_MS = 2_000;

const TERMINAL_RUN_STATUSES = new Set([
	"completed",
	"failed",
	"cancelled",
	"needs_review",
	"blocked",
	"timed_out",
	"needs_human",
]);

type PilotMode = "baseline" | "catalog";

async function main() {
	assertIsolatedRuntimeEnvironment(process.env, [
		DATABASE_ACCESS_SCOPES.isolatedEvaluation,
	]);
	await ensureNightWorkersSchema();
	const options = parsePilotOptions();
	if (!options.dedicatedDatabase) {
		throw new Error(
			"The paired pilot requires --dedicated-database and the isolated launcher.",
		);
	}
	const releaseRuntimeLease = acquirePilotRuntimeLease(options);
	try {
		await runPilot(options);
	} finally {
		releaseRuntimeLease();
	}
}

async function runPilot(options: PilotOptions) {
	let repository = await nightworkersRepo.getRepository(options.repositoryId);
	if (!repository && options.dedicatedDatabase) {
		repository = await createRepository({
			name: `Evaluation: ${path.basename(options.repositoryRoot)}`,
			localPath: options.repositoryRoot,
			allowed: true,
			queueEnabled: false,
		});
		options.repositoryId = repository.id;
	}
	if (!repository) {
		throw new Error(`Pilot repository not found: ${options.repositoryId}`);
	}
	if (repository.localPath !== options.repositoryRoot) {
		throw new Error(
			`Pilot repository path mismatch: expected ${options.repositoryRoot}, received ${repository.localPath}`,
		);
	}
	const selectedTasks = PILOT_TASKS.slice(
		options.fromPair - 1,
		options.fromPair - 1 + options.pairCount,
	);
	if (selectedTasks.length !== options.pairCount) {
		throw new Error("Requested pair range exceeds the fixed pilot task set.");
	}

	const targetHead = await gitOutput(options.repositoryRoot, ["rev-parse", "HEAD"]);
	const targetStatus = await gitOutput(options.repositoryRoot, [
		"status",
		"--porcelain=v1",
	]);
	if (targetStatus.length > 0) {
		throw new Error("Pilot target repository must be clean before starting.");
	}
	const consumerHead = await gitOutput(process.cwd(), ["rev-parse", "HEAD"]);
	const consumerStatus = await gitOutput(process.cwd(), [
		"status",
		"--porcelain=v1",
	]);
	if (consumerStatus.length > 0 && !options.allowDirtyConsumer) {
		throw new Error(
			"NightWorkers must be clean before the paired pilot. Commit or isolate the implementation changes, or use --allow-dirty-consumer only for non-gating diagnostics.",
		);
	}
	const competingProcesses = await listCompetingNightWorkersProcesses();
	if (
		competingProcesses.length > 0 &&
		!options.dedicatedDatabase &&
		!options.allowLiveApi
	) {
		throw new Error(
			`A competing NightWorkers API process is using the pilot database: ${competingProcesses.join(", ")}. Stop it or run the pilot through that process. --allow-live-api is diagnostic-only.`,
		);
	}
	const consumerDiffHash = createHash("sha256")
		.update(consumerStatus)
		.digest("hex");
	const configuredRoute = resolveStructuredLlmRoleRoute({
		role: "implementation",
		settings: readStructuredLlmProviderSettings(),
	});
	if (!configuredRoute || configuredRoute.providerId === "codex") {
		throw new Error(
			"The paired pilot requires a configured non-Codex implementation route.",
		);
	}
	const routeOverride = {
		providerEndpointId: configuredRoute.providerEndpointId,
		model: configuredRoute.model,
		thinkingDepth: options.thinkingDepth,
		requestTimeoutSeconds: configuredRoute.requestTimeoutSeconds ?? undefined,
	};
	const mcpServer = await ensurePilotMcpServer({
		producerRoot: options.producerRoot,
		repositoryRoot: options.repositoryRoot,
	});

	const pairs: Awaited<ReturnType<typeof runPair>>[] = [];
	try {
		const tools = await mcpClientManager.listToolsForServer(mcpServer);
		const requiredTools = [
			"vuln_prepare_project_intelligence",
			"vuln_get_project_intelligence_status",
			"vuln_get_project_exploration_catalog",
		];
		const missingTools = requiredTools.filter(
			(name) => !tools.some((tool) => tool.name === name),
		);
		if (missingTools.length > 0) {
			throw new Error(
				`Pilot MCP server is missing tools: ${missingTools.join(", ")}`,
			);
		}
		for (const [taskIndex, task] of selectedTasks.entries()) {
			progress({ event: "pair.started", pairId: task.id, title: task.title });
			const pair = await runPair({
				task,
				pilotId: options.pilotId,
				repositoryId: options.repositoryId,
				mcpServerId: mcpServer.id,
				timeoutSeconds: options.timeoutSeconds,
				routeOverride,
				cooldownSeconds: options.cooldownSeconds,
			});
			pairs.push(pair);
			progress({
				event: "pair.finished",
				pairId: task.id,
				baselineRunId: pair.baseline.runId,
				baselineStatus: pair.baseline.status,
				catalogRunId: pair.catalog.runId,
				catalogStatus: pair.catalog.status,
			});
			if (
				options.cooldownSeconds > 0 &&
				taskIndex < selectedTasks.length - 1
			) {
				progress({
					event: "pilot.cooldown",
					seconds: options.cooldownSeconds,
					reason: "provider_capacity_recovery_between_pairs",
				});
				await sleep(options.cooldownSeconds * 1_000);
			}
		}
	} finally {
		await saveProjectExplorationCatalogSettings(options.repositoryId, {
			enabled: false,
			mcpServerId: mcpServer.id,
		});
		await mcpClientManager.disconnect(mcpServer.id);
	}

	const report = buildPilotReport({
		pilotId: options.pilotId,
		selectedTasks,
		pairs,
		repositoryId: options.repositoryId,
		repositoryRoot: options.repositoryRoot,
		targetHead,
		consumerHead,
		consumerDirty: consumerStatus.length > 0,
		consumerDiffHash,
		mcpServerId: mcpServer.id,
		dedicatedDatabase: options.dedicatedDatabase,
		databasePath: resolveLocalDatabasePath(process.env.DATABASE_URL),
	});
	if (options.output) {
		await Bun.write(options.output, `${JSON.stringify(report, null, 2)}\n`);
		progress({ event: "pilot.report_written", output: options.output });
	}
	process.stdout.write(`${JSON.stringify(report)}\n`);
}

async function ensurePilotMcpServer(input: {
	producerRoot: string;
	repositoryRoot: string;
}) {
	const desired = {
		name: "vulnWorkbench Project Intelligence Pilot",
		enabled: true,
		transport: "stdio" as const,
		command: "bun",
		args: ["api/cli/static-intelligence-mcp-server.ts"],
		cwd: input.producerRoot,
		env: {
			STATIC_INTELLIGENCE_ALLOWED_PROJECT_ROOTS: input.repositoryRoot,
			STATIC_INTELLIGENCE_PROJECT_CREATION_POLICY:
				"create_within_allowed_roots",
		},
		toolPrefix: "vuln_pilot",
	};
	const existing = listMcpServers().find(
		(server) => server.toolPrefix === desired.toolPrefix,
	);
	if (!existing) return createMcpServer(desired);
	const updated = await updateMcpServer(existing.id, desired);
	if (!updated) throw new Error("Failed to update the pilot MCP server.");
	return updated;
}

async function runPair(input: {
	task: PilotTask;
	pilotId: string;
	repositoryId: string;
	mcpServerId: string;
	timeoutSeconds: number;
	routeOverride: {
		providerEndpointId: string;
		model: string;
		thinkingDepth: "low" | "medium" | "high" | "very_high";
		requestTimeoutSeconds?: number;
	};
	cooldownSeconds: number;
}) {
	const baseline = await prepareAndStartRun({ ...input, mode: "baseline" });
	const baselineTerminal = await waitForTerminalRun(
		baseline.runId,
		input.timeoutSeconds + 180,
	);
	const baselineMeasurement = await measureRun(baselineTerminal);
	progress({
		event: "pilot.cooldown",
		seconds: input.cooldownSeconds,
		reason: "provider_capacity_recovery_between_pair_members",
	});
	await sleep(input.cooldownSeconds * 1_000);
	const catalog = await prepareAndStartRun({ ...input, mode: "catalog" });
	await saveProjectExplorationCatalogSettings(input.repositoryId, {
		enabled: false,
		mcpServerId: input.mcpServerId,
	});
	const catalogTerminal = await waitForTerminalRun(
		catalog.runId,
		input.timeoutSeconds + 180,
	);
	const catalogMeasurement = await measureRun(catalogTerminal);
	return {
		pairId: input.task.id,
		category: input.task.category,
		title: input.task.title,
		promptDigest: pilotPromptDigest(input.task),
		baseline: {
			taskId: baseline.taskId,
			runId: baselineTerminal.id,
			status: baselineTerminal.status,
			baseRef: baselineTerminal.baseRef,
			worktreePath: baseline.worktreePath,
			measurement: baselineMeasurement,
			route: routeEvidence(baselineTerminal.contextSnapshot),
		},
		catalog: {
			taskId: catalog.taskId,
			runId: catalogTerminal.id,
			status: catalogTerminal.status,
			baseRef: catalogTerminal.baseRef,
			worktreePath: catalog.worktreePath,
			measurement: catalogMeasurement,
			route: routeEvidence(catalogTerminal.contextSnapshot),
			pin: catalogPinEvidence(catalogTerminal.contextSnapshot),
		},
		controls: {
			sameBaseRef:
				baselineTerminal.baseRef === catalogTerminal.baseRef,
			samePrompt: true,
			sameRoute:
				JSON.stringify(routeEvidence(baselineTerminal.contextSnapshot)) ===
				JSON.stringify(routeEvidence(catalogTerminal.contextSnapshot)),
			independentWorktrees:
				Boolean(baseline.worktreePath) &&
				Boolean(catalog.worktreePath) &&
				baseline.worktreePath !== catalog.worktreePath,
		},
		comparison: summarizeProjectExplorationPair({
			baseline: baselineMeasurement,
			catalog: catalogMeasurement,
		}),
	};
}

async function prepareAndStartRun(input: {
	task: PilotTask;
	pilotId: string;
	repositoryId: string;
	mcpServerId: string;
	timeoutSeconds: number;
	routeOverride: {
		providerEndpointId: string;
		model: string;
		thinkingDepth: "low" | "medium" | "high" | "very_high";
		requestTimeoutSeconds?: number;
	};
	mode: PilotMode;
}) {
	const createdBy = `${input.pilotId}:${input.task.id}:${input.mode}`;
	const existingTask = (await listTasks()).find(
		(task) => task.createdBy === createdBy,
	);
	const task =
		existingTask ??
		(await createTask({
			repositoryId: input.repositoryId,
			title: input.task.title,
			description: input.task.description,
			objective: input.task.objective,
			acceptanceCriteria: input.task.acceptanceCriteria,
			timeoutSeconds: input.timeoutSeconds,
			createdBy,
		}));
	const existingRuns = await nightworkersRepo.listTaskRunsForTask(task.id);
	const existingRun = existingRuns.sort(
		(left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
	)[0];
	if (existingRun) {
		return {
			taskId: task.id,
			runId: existingRun.id,
			worktreePath: task.worktreePath,
		};
	}

	await saveProjectExplorationCatalogSettings(input.repositoryId, {
		enabled: input.mode === "catalog",
		mcpServerId: input.mcpServerId,
	});
	const run = await startTaskRun(task.id, {
		executionMode: "implementation",
		executionModeSource: "explicit",
		routeOverride: input.routeOverride,
	});
	const refreshedTask = await nightworkersRepo.getTask(task.id);
	return {
		taskId: task.id,
		runId: run.id,
		worktreePath: refreshedTask?.worktreePath ?? null,
	};
}

async function waitForTerminalRun(runId: string, maxWaitSeconds: number) {
	const deadline = Date.now() + maxWaitSeconds * 1_000;
	let lastStatus = "";
	while (Date.now() < deadline) {
		const run = await nightworkersRepo.getTaskRun(runId);
		if (!run) throw new Error(`Pilot run disappeared: ${runId}`);
		if (run.status !== lastStatus) {
			lastStatus = run.status;
			progress({ event: "run.status", runId, status: run.status });
		}
		if (TERMINAL_RUN_STATUSES.has(run.status)) return run;
		await sleep(POLL_INTERVAL_MS);
	}
	const run = await nightworkersRepo.getTaskRun(runId);
	if (!run) throw new Error(`Pilot run disappeared: ${runId}`);
	progress({ event: "run.poll_timeout", runId, status: run.status });
	return run;
}

async function measureRun(
	run: NonNullable<Awaited<ReturnType<typeof nightworkersRepo.getTaskRun>>>,
) {
	const [events, usageRecords] = await Promise.all([
		listTaskEventsForRun(run.id),
		listLlmUsageRecordsForRun(run.id),
	]);
	return measureProjectExplorationRun({ run, events, usageRecords });
}

function routeEvidence(contextSnapshot: unknown) {
	const snapshot = recordValue(contextSnapshot);
	const routing = recordValue(snapshot?.effectiveLlmRouting);
	const active = recordValue(routing?.active);
	return {
		runtimeLane: stringValue(snapshot?.runtimeLane),
		providerId: stringValue(active?.providerId),
		providerEndpointId: stringValue(active?.providerEndpointId),
		model: stringValue(active?.model),
		thinkingDepth: stringValue(active?.thinkingDepth),
	};
}

function catalogPinEvidence(contextSnapshot: unknown) {
	const snapshot = recordValue(contextSnapshot);
	const pin = recordValue(snapshot?.projectExplorationCatalog);
	if (!pin) return null;
	const readiness = recordValue(pin.readiness);
	const freshness = recordValue(pin.freshness);
	const preparation = recordValue(pin.preparation);
	return {
		version: numberValue(pin.version),
		available: pin.available === true,
		reason: stringValue(pin.reason),
		preparedAt: stringValue(pin.preparedAt),
		preparationStatus: stringValue(pin.preparationStatus),
		freshness: freshness
			? {
					status: stringValue(freshness.status),
					sourceRevisionKind: stringValue(freshness.sourceRevisionKind),
					sourceRevisionValue: stringValue(freshness.sourceRevisionValue),
				}
			: null,
		readiness: readiness
			? {
					codeStructure: stringValue(readiness.codeStructure),
					usability: stringValue(readiness.usability),
					reasonCodes: Array.isArray(readiness.reasonCodes)
						? readiness.reasonCodes.filter(
								(value): value is string => typeof value === "string",
							)
						: [],
					coverage: recordValue(readiness.coverage),
				}
			: null,
		preparation: preparation
			? {
					reused: preparation.reused === true,
					durationMs: numberValue(preparation.durationMs),
					pollCount: numberValue(preparation.pollCount),
				}
			: null,
	};
}

function acquirePilotRuntimeLease(options: PilotOptions): () => void {
	if (!options.dedicatedDatabase) return () => {};
	const runtimePaths = getRuntimePaths();
	const databasePath = resolveLocalDatabasePath(process.env.DATABASE_URL);
	if (!existsSync(databasePath)) {
		throw new Error(
			`Dedicated pilot database does not exist: ${databasePath}`,
		);
	}
	const leasePath = path.join(
		runtimePaths.runtimeRoot,
		"project-intelligence-pilot.lock",
	);
	let descriptor: number;
	try {
		descriptor = openSync(leasePath, "wx", 0o600);
	} catch (error) {
		throw new Error(
			`Dedicated pilot database already has a runtime lease: ${leasePath}`,
			{ cause: error },
		);
	}
	return () => {
		closeSync(descriptor);
		unlinkSync(leasePath);
	};
}

async function gitOutput(cwd: string, args: string[]) {
	return commandOutput(cwd, ["git", ...args]);
}

async function listCompetingNightWorkersProcesses() {
	const output = await commandOutput(process.cwd(), [
		"ps",
		"-axo",
		"pid=,command=",
	]);
	return output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => {
			const [rawPid] = line.split(/\s+/, 1);
			if (Number(rawPid) === process.pid) return false;
			return (
				line.includes("bun api/index.ts") ||
				line.includes("bun run dev:api")
			);
		});
}

async function commandOutput(cwd: string, command: string[]) {
	const child = Bun.spawn(command, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
	}
	return stdout.trim();
}

function progress(payload: Record<string, unknown>) {
	process.stderr.write(`${JSON.stringify({ ...payload, at: new Date().toISOString() })}\n`);
}

function recordValue(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function stringValue(value: unknown) {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sleep(durationMs: number) {
	return new Promise((resolve) => setTimeout(resolve, durationMs));
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : error);
	process.exitCode = 1;
});
