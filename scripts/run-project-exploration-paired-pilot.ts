import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, unlinkSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
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
	type ExplorationReductionMeasurement,
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

const DEFAULT_PILOT_ID =
	"project-intelligence-foundation-2026-08-09-isolated-v2";
const DEFAULT_PAIR_TIMEOUT_SECONDS = 600;
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

type PilotTask = {
	id: string;
	category: string;
	title: string;
	description: string;
	objective: string;
	acceptanceCriteria: string;
};

const PILOT_TASKS: PilotTask[] = [
	{
		id: "p01",
		category: "frontend-routing",
		title: "Harden local login redirects",
		description:
			"Harden login redirect parsing so only safe same-origin absolute-path redirects are accepted. Reject redirects containing backslashes, ASCII control characters, encoded protocol-relative prefixes, or an authority component, while preserving valid local query strings and fragments. Add focused regression tests. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Prevent browser redirect ambiguity without changing valid local redirect behavior.",
		acceptanceCriteria:
			"Unsafe redirect variants are rejected; valid local paths with query/hash remain accepted; focused tests and typecheck pass.",
	},
	{
		id: "p02",
		category: "backend-configuration",
		title: "Normalize configured CORS origins",
		description:
			"Normalize configured CORS origins by trimming whitespace, ignoring blank entries, and removing duplicates while preserving first-seen order. Ensure the application URL origin appears exactly once. Add focused tests for blanks, duplicates, and ordering. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Make CORS origin configuration deterministic and resistant to harmless formatting differences.",
		acceptanceCriteria:
			"Normalized origins are unique and ordered; blank entries are ignored; the application origin is present once; focused tests and typecheck pass.",
	},
	{
		id: "p03",
		category: "shared-auth-contract",
		title: "Canonicalize login email input",
		description:
			"Canonicalize login email input at the shared validation boundary by trimming and lowercasing the address before backend and frontend consumers use it. Preserve validation errors for malformed addresses and add focused contract tests. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Give all authentication consumers one canonical email representation.",
		acceptanceCriteria:
			"Valid mixed-case padded email input parses to lowercase without padding; malformed email remains rejected; focused tests and typecheck pass.",
	},
	{
		id: "p04",
		category: "database-runtime",
		title: "Reject blank SQLite database paths",
		description:
			"Harden SQLite database path initialization so empty or whitespace-only database paths are rejected before directory creation or database opening. Keep memory databases and normal relative file paths working. Add focused regression tests. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Fail early for ambiguous database path configuration.",
		acceptanceCriteria:
			"Blank paths throw a clear error; memory and normal file paths retain current behavior; focused tests and typecheck pass.",
	},
	{
		id: "p05",
		category: "security-policy",
		title: "Make CSP serialization deterministic",
		description:
			"Harden Content Security Policy serialization by omitting directives with no values and deduplicating repeated values while preserving their first-seen order. Preserve current directive ordering and kebab-case conversion. Add focused tests. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Produce stable CSP headers without empty or repeated policy tokens.",
		acceptanceCriteria:
			"Empty directives are absent, duplicate values occur once, existing policy serialization remains stable, and focused tests/typecheck pass.",
	},
	{
		id: "p06",
		category: "shared-auth-contract",
		title: "Reject blank authenticated display names",
		description:
			"Strengthen the shared authenticated-user response contract so display names containing only whitespace are rejected while meaningful names with surrounding whitespace remain valid without changing their returned value. Add focused schema tests. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Prevent semantically empty display names at the shared API boundary.",
		acceptanceCriteria:
			"Whitespace-only display names fail validation; meaningful padded names retain their original value; focused tests and typecheck pass.",
	},
	{
		id: "p07",
		category: "frontend-search",
		title: "Require canonical showcase page sizes",
		description:
			"Tighten showcase table query parsing so page-size values are accepted only as supported numbers or canonical decimal strings. Reject padded, exponent, fractional, signed, and leading-zero string forms instead of coercing them. Keep current defaults and add focused tests. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Keep shareable showcase URLs canonical and predictable.",
		acceptanceCriteria:
			"Supported numeric and canonical string sizes parse; non-canonical coercible strings fall back; focused tests and typecheck pass.",
	},
	{
		id: "p08",
		category: "authentication-security",
		title: "Reject unknown JWT payload fields",
		description:
			"Make the JWT payload validation contract reject unknown top-level fields instead of silently stripping them. Preserve all valid access and refresh token behavior, and add focused unit coverage for valid payloads and unexpected claims. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Keep the accepted JWT claim surface explicit.",
		acceptanceCriteria:
			"Known payloads still parse; an unexpected top-level claim is rejected; token service tests and typecheck pass.",
	},
	{
		id: "p09",
		category: "authentication-runtime",
		title: "Accept padded auth token durations",
		description:
			"Allow harmless leading and trailing whitespace in configured authentication token duration strings before converting them to cookie max-age values. Keep invalid, zero, and negative durations omitted. Add focused tests for padded valid and invalid values. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Make cookie duration handling consistent with normalized environment input.",
		acceptanceCriteria:
			"Padded valid durations produce max-age; invalid/non-positive durations do not; existing cookie attributes remain unchanged; focused tests and typecheck pass.",
	},
	{
		id: "p10",
		category: "api-observability",
		title: "Mark health responses as non-cacheable",
		description:
			"Ensure the health endpoint explicitly sends a no-store cache policy so intermediaries cannot serve stale readiness information. Preserve its JSON response contract and add focused route and application-level tests for the header. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Prevent cached health responses without changing the endpoint body.",
		acceptanceCriteria:
			"Health responses include Cache-Control: no-store; the existing status/service body is unchanged; focused tests and typecheck pass.",
	},
];

async function main() {
	assertIsolatedRuntimeEnvironment(process.env, [
		DATABASE_ACCESS_SCOPES.isolatedEvaluation,
	]);
	await ensureNightWorkersSchema();
	const options = parseOptions();
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

async function runPilot(options: ReturnType<typeof parseOptions>) {
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

	const report = buildReport({
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

function parseOptions() {
	const parsed = parseArgs({
		args: process.argv.slice(2).filter((arg) => arg !== "--"),
		options: {
			"pilot-id": { type: "string" },
			"repository-id": { type: "string" },
			"repository-root": { type: "string" },
			"producer-root": { type: "string" },
			"from-pair": { type: "string" },
			"pair-count": { type: "string" },
			"timeout-seconds": { type: "string" },
			"thinking-depth": { type: "string" },
			"cooldown-seconds": { type: "string" },
			"allow-dirty-consumer": { type: "boolean" },
			"allow-live-api": { type: "boolean" },
			"dedicated-database": { type: "boolean" },
			output: { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});
	const fromPair = positiveInteger(parsed.values["from-pair"] ?? "1");
	const pairCount = positiveInteger(parsed.values["pair-count"] ?? "10");
	const timeoutSeconds = positiveInteger(
		parsed.values["timeout-seconds"] ?? String(DEFAULT_PAIR_TIMEOUT_SECONDS),
	);
	const thinkingDepth = parsed.values["thinking-depth"] ?? "low";
	if (!["low", "medium", "high", "very_high"].includes(thinkingDepth)) {
		throw new Error(`Unsupported thinking depth: ${thinkingDepth}`);
	}
	const cooldownSeconds = nonnegativeInteger(
		parsed.values["cooldown-seconds"] ?? "30",
	);
	return {
		pilotId: parsed.values["pilot-id"]?.trim() || DEFAULT_PILOT_ID,
		repositoryId: parsed.values["repository-id"] ?? "",
		repositoryRoot: requiredOption(
			"--repository-root",
			parsed.values["repository-root"],
		),
		producerRoot: requiredOption(
			"--producer-root",
			parsed.values["producer-root"],
		),
		fromPair,
		pairCount,
		timeoutSeconds,
		thinkingDepth: thinkingDepth as "low" | "medium" | "high" | "very_high",
		cooldownSeconds,
		allowDirtyConsumer: parsed.values["allow-dirty-consumer"] ?? false,
		allowLiveApi: parsed.values["allow-live-api"] ?? false,
		dedicatedDatabase: parsed.values["dedicated-database"] ?? false,
		output: parsed.values.output
			? path.resolve(parsed.values.output)
			: null,
	};
}

function requiredOption(name: string, value: string | undefined) {
	if (!value?.trim()) throw new Error(`${name} is required`);
	return path.resolve(value);
}

function positiveInteger(value: string) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`Expected a positive integer, received: ${value}`);
	}
	return parsed;
}

function nonnegativeInteger(value: string) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`Expected a non-negative integer, received: ${value}`);
	}
	return parsed;
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
		promptDigest: promptDigest(input.task),
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

function buildReport(input: {
	pilotId: string;
	selectedTasks: PilotTask[];
	pairs: Awaited<ReturnType<typeof runPair>>[];
	repositoryId: string;
	repositoryRoot: string;
	targetHead: string;
	consumerHead: string;
	consumerDirty: boolean;
	consumerDiffHash: string;
	mcpServerId: string;
	dedicatedDatabase: boolean;
	databasePath: string;
}) {
	const measurements = input.pairs.map((pair) => ({
		baseline: pair.baseline.measurement,
		catalog: pair.catalog.measurement,
	}));
	const baselineExploration = measurements.map(({ baseline }) =>
		explorationCalls(baseline),
	);
	const catalogExploration = measurements.map(({ catalog }) =>
		explorationCalls(catalog),
	);
	const baselineTokens = measurements.flatMap(({ baseline }) =>
		baseline.totalInputTokens === null ? [] : [baseline.totalInputTokens],
	);
	const catalogTokens = measurements.flatMap(({ catalog }) =>
		catalog.totalInputTokens === null ? [] : [catalog.totalInputTokens],
	);
	const baselineCompletionRate = rate(
		measurements.map(({ baseline }) => baseline.taskCompleted),
	);
	const catalogCompletionRate = rate(
		measurements.map(({ catalog }) => catalog.taskCompleted),
	);
	const baselineVerification = measurements.flatMap(({ baseline }) =>
		baseline.verificationPassed === null ? [] : [baseline.verificationPassed],
	);
	const catalogVerification = measurements.flatMap(({ catalog }) =>
		catalog.verificationPassed === null ? [] : [catalog.verificationPassed],
	);
	const unsafeIncidentCount = measurements.reduce(
		(total, { catalog }) =>
			total +
			(catalog.fallbackReason === "PROJECT_EXPLORATION_STALE" ||
			catalog.fallbackReason === "PROJECT_EXPLORATION_UNSAFE_PATH" ||
			catalog.fallbackReason === "workspace_mismatch"
				? 1
				: 0),
		0,
	);
	const catalogFailurePropagationCount = measurements.filter(
		({ catalog }) => catalog.catalogFailureCount > 0 && !catalog.taskCompleted,
	).length;
	const controlsSatisfied = input.pairs.every(
		(pair) =>
			pair.controls.sameBaseRef &&
			pair.controls.samePrompt &&
			pair.controls.sameRoute &&
			pair.controls.independentWorktrees,
	);
	const explorationReductionRate = reductionRate(
		median(baselineExploration),
		median(catalogExploration),
	);
	const tokenReductionRate = reductionRate(
		median(baselineTokens),
		median(catalogTokens),
	);
	const gates = {
		minimumTenPairs: input.pairs.length >= 10,
		pairedControls: controlsSatisfied,
		consumerSourceClean: !input.consumerDirty,
		databaseIsolation: input.dedicatedDatabase,
		explorationReduction:
			explorationReductionRate !== null && explorationReductionRate >= 0.2,
		inputTokenReduction:
			baselineTokens.length === input.pairs.length &&
			catalogTokens.length === input.pairs.length &&
			tokenReductionRate !== null &&
			tokenReductionRate >= 0.15,
		completionNonRegression:
			catalogCompletionRate >= baselineCompletionRate,
		verificationNonRegression:
			baselineVerification.length === input.pairs.length &&
			catalogVerification.length === input.pairs.length &&
			rate(catalogVerification) >= rate(baselineVerification),
		zeroUnsafeIncidents: unsafeIncidentCount === 0,
		noReplanIncrease:
			median(measurements.map(({ catalog }) => catalog.replanCount)) <=
			median(measurements.map(({ baseline }) => baseline.replanCount)),
		zeroCatalogFailurePropagation: catalogFailurePropagationCount === 0,
	};
	const evidenceComplete =
		gates.minimumTenPairs &&
		gates.pairedControls &&
		gates.consumerSourceClean &&
		gates.databaseIsolation &&
		baselineTokens.length === input.pairs.length &&
		catalogTokens.length === input.pairs.length &&
		baselineVerification.length === input.pairs.length &&
		catalogVerification.length === input.pairs.length;
	const decision = !evidenceComplete
		? "INSUFFICIENT_EVIDENCE"
		: Object.values(gates).every(Boolean)
			? "GO"
			: "NO-GO";

	return {
		schemaVersion: "project-intelligence-paired-pilot-v1",
		pilotId: input.pilotId,
		generatedAt: new Date().toISOString(),
		decision,
		controls: {
			repositoryId: input.repositoryId,
			repositoryRoot: input.repositoryRoot,
			targetHead: input.targetHead,
			consumerHead: input.consumerHead,
			consumerDirty: input.consumerDirty,
			consumerDiffHash: input.consumerDiffHash,
			mcpServerId: input.mcpServerId,
			dedicatedDatabase: input.dedicatedDatabase,
			databasePath: input.databasePath,
			featureFlagRestoredToOff: true,
		},
		taskSet: input.selectedTasks.map((task) => ({
			...task,
			promptDigest: promptDigest(task),
		})),
		pairs: input.pairs,
		aggregate: {
			pairCount: input.pairs.length,
			baseline: {
				medianExploratoryToolCalls: median(baselineExploration),
				medianInputTokens: median(baselineTokens),
				completionRate: baselineCompletionRate,
				verificationPassRate: rate(baselineVerification),
				verificationEvidenceCount: baselineVerification.length,
			},
			catalog: {
				medianExploratoryToolCalls: median(catalogExploration),
				medianInputTokens: median(catalogTokens),
				completionRate: catalogCompletionRate,
				verificationPassRate: rate(catalogVerification),
				verificationEvidenceCount: catalogVerification.length,
				catalogBeforeBroadExplorationRate: rate(
					measurements.map(
						({ catalog }) =>
							catalog.catalogCalledBeforeBroadExploration === true,
					),
				),
				catalogCallRate: rate(
					measurements.map(({ catalog }) => catalog.catalogCalled),
				),
			},
			reductions: {
				exploratoryToolCalls: explorationReductionRate,
				inputTokens: tokenReductionRate,
			},
			unsafeIncidentCount,
			catalogFailurePropagationCount,
			gates,
		},
	};
}

function explorationCalls(measurement: ExplorationReductionMeasurement) {
	return (
		measurement.listDirCallsBeforeMutation +
		measurement.searchCallsBeforeMutation +
		measurement.readFileCallsBeforeMutation +
		(measurement.mode === "catalog" ? measurement.catalogCallCount : 0)
	);
}

function promptDigest(task: PilotTask) {
	return createHash("sha256")
		.update(
			JSON.stringify({
				title: task.title,
				description: task.description,
				objective: task.objective,
				acceptanceCriteria: task.acceptanceCriteria,
			}),
		)
		.digest("hex");
}

function median(values: number[]) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[middle] ?? 0);
}

function reductionRate(baseline: number | null, catalog: number | null) {
	if (baseline === null || catalog === null || baseline === 0) return null;
	return (baseline - catalog) / baseline;
}

function rate(values: boolean[]) {
	if (values.length === 0) return 0;
	return values.filter(Boolean).length / values.length;
}

function acquirePilotRuntimeLease(
	options: ReturnType<typeof parseOptions>,
): () => void {
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
