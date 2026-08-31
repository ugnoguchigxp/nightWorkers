import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRepository } from "../api/modules/nightworkers/nightworkers.basic.service";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import {
	getProjectExplorationCatalogSettings,
	saveProjectExplorationCatalogSettings,
} from "../api/modules/ontology/exploration/project-exploration-settings.service";
import { mcpClientManager } from "../api/services/mcp/mcp-client-manager";
import { resolveStructuredLlmRoleRoute } from "../api/services/structured-llm/role-routing";
import { readStructuredLlmProviderSettings } from "../api/services/structured-llm/settings";
import {
	DATABASE_ACCESS_SCOPES,
	assertIsolatedRuntimeEnvironment,
	resolveLocalDatabasePath,
} from "../shared/runtime-database-access.mjs";
import {
	parsePilotOptions,
	type PilotOptions,
} from "./project-exploration-pilot/options";
import { buildPilotReport } from "./project-exploration-pilot/report";
import { counterbalancedOrder } from "./project-exploration-pilot/registration";
import { evaluatorSetFingerprint } from "./project-exploration-pilot/evaluator";
import { buildPilotCanaryEvidence } from "./project-exploration-pilot/canary";
import { buildPilotPreflightEvidence } from "./project-exploration-pilot/preflight";
import {
	activePilotRunCountFor,
	assertPairEvidenceIntegrity,
	consumedPairAttemptCount,
	interruptionCode,
	pilotRunInventory,
	runPair,
} from "./project-exploration-pilot/runtime-execution";
import {
	initializeProducerPilotDatabase,
	preparePilotMcpServer,
	acquirePilotRuntimeLease,
	catalogPinEvidence,
	gitOutput,
	listCompetingNightWorkersProcesses,
	progress,
	sleep,
	writeAtomicJson,
	writeRawCheckpoint,
} from "./project-exploration-pilot/runtime-infrastructure";
import {
	nativeApiToolManifestFingerprint,
	sha256Fingerprint,
} from "./project-exploration-pilot/protocol-fingerprints";
import {
	assertRegistrationFingerprints,
	assertResumeCheckpointMatchesRuntime,
	loadFormalCanaryEvidence,
	loadFormalEvaluatorQualification,
	loadFormalPreflightEvidence,
	loadFormalRegistration,
	loadResumeCheckpoint,
	type PilotPair,
} from "./project-exploration-pilot/runtime-support";
import {
	PILOT_TASKS,
	PILOT_PREFLIGHT_CANARY_TASK,
	pilotPromptContractFingerprint,
	type PilotTask,
} from "./project-exploration-pilot/tasks";

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
	const selectedTasks: readonly PilotTask[] = options.preflightCanary
		? [PILOT_PREFLIGHT_CANARY_TASK]
		: PILOT_TASKS.slice(
				options.fromPair - 1,
				options.fromPair - 1 + options.pairCount,
			);
	if (!options.preflightCanary && selectedTasks.length !== options.pairCount) {
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
	const producerHead = await gitOutput(options.producerRoot, ["rev-parse", "HEAD"]);
	const producerStatus = await gitOutput(options.producerRoot, [
		"status",
		"--porcelain=v1",
	]);
	const consumerStatus = await gitOutput(process.cwd(), [
		"status",
		"--porcelain=v1",
	]);
	if (consumerStatus.length > 0 && !options.allowDirtyConsumer) {
		throw new Error(
			"NightWorkers must be clean before the paired pilot. Commit or isolate the implementation changes, or use --allow-dirty-consumer only for non-gating diagnostics.",
		);
	}
	if (options.formal && (consumerStatus.length > 0 || producerStatus.length > 0)) {
		throw new Error(
			"Formal pilot requires clean NightWorkers and vulnWorkbench worktrees.",
		);
	}
	const registration = await loadFormalRegistration(options, {
		producerHead,
		consumerHead,
		targetHead,
	});
	const evaluatorQualification = await loadFormalEvaluatorQualification(
		options,
		targetHead,
	);
	const resumedCheckpoint = await loadResumeCheckpoint(options);
	const resumedPairs = resumedCheckpoint.pairs;
	const interruptions = [...resumedCheckpoint.interruptions];
	const tasksToRun = selectedTasks.filter(
		(task) =>
			!resumedPairs.some(
				(pair) =>
					pair.pairId === task.id &&
					["valid", "task_outcome_failure"].includes(pair.classification),
			),
	);
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
	const settingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
	if (!settingsPath) {
		throw new Error("Pilot requires an isolated NIGHTWORKERS_LLM_SETTINGS_PATH.");
	}
	const settingsFingerprint = sha256Fingerprint(await readFile(settingsPath, "utf8"));
	const routeFingerprint = sha256Fingerprint(JSON.stringify(routeOverride));
	const toolManifestFingerprint = nativeApiToolManifestFingerprint();
	const promptContractFingerprint = pilotPromptContractFingerprint();
	const sealedControlFingerprints = {
		routeFingerprint,
		settingsFingerprint,
		promptContractFingerprint,
		toolManifestFingerprint,
		evaluatorSetFingerprint: evaluatorSetFingerprint(PILOT_TASKS),
	};
	if (registration) {
		assertRegistrationFingerprints(registration, sealedControlFingerprints);
	}
	const canaryEvidence = await loadFormalCanaryEvidence(options, {
		registration,
		commits: {
			producer: producerHead,
			consumer: consumerHead,
			target: targetHead,
		},
		controlFingerprints: {
			route: routeFingerprint,
			settings: settingsFingerprint,
			toolManifest: toolManifestFingerprint,
		},
	});
	const preflightEvidence = await loadFormalPreflightEvidence(options, {
		registration,
		evaluatorQualification,
		canaryEvidence,
		commits: {
			producer: producerHead,
			consumer: consumerHead,
			target: targetHead,
		},
		controlFingerprints: {
			route: routeFingerprint,
			settings: settingsFingerprint,
			promptContract: promptContractFingerprint,
			toolManifest: toolManifestFingerprint,
			evaluatorSet: evaluatorSetFingerprint(PILOT_TASKS),
		},
	});
	const checkpointControls = {
		producerCommit: producerHead,
		consumerCommit: consumerHead,
		targetCommit: targetHead,
		routeFingerprint,
		settingsFingerprint,
		toolManifestFingerprint,
		preRegistrationHash: registration?.hash ?? null,
		preflightCanaryHash: canaryEvidence?.hash ?? null,
		preflightEvidenceHash: preflightEvidence?.hash ?? null,
		promptContractFingerprint: registration
			? promptContractFingerprint
			: null,
	};
	assertResumeCheckpointMatchesRuntime({
		checkpoint: resumedCheckpoint,
		controls: checkpointControls,
		formal: options.formal,
	});
	await initializeProducerPilotDatabase({
		producerRoot: options.producerRoot,
		producerDatabase: options.producerDatabase,
		formal: options.formal,
	});
	const producerPreparation = await preparePilotMcpServer({
		producerRoot: options.producerRoot,
		repositoryRoot: options.repositoryRoot,
		producerDatabase: options.producerDatabase,
		formal: options.formal,
		preparationTimeoutSeconds: options.timeoutSeconds,
		targetHead,
	});
	const mcpServer = producerPreparation.mcpServer;

	const pairs: PilotPair[] = [...resumedPairs];
	let featureFlagRestoredToOff = false;
	let mcpDisconnected = false;
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
		if (!options.preflightOnly) {
			for (const [taskIndex, task] of tasksToRun.entries()) {
			const consumedPairAttempts = await consumedPairAttemptCount(
				options.pilotId,
			);
			if (
				registration &&
				consumedPairAttempts >=
					registration.registration.schedule.maxPairAttempts
			) {
				throw new Error("Pilot reached its pre-registered global attempt stop-loss.");
			}
			progress({ event: "pair.started", pairId: task.id, title: task.title });
			let pair: PilotPair;
			try {
				pair = await runPair({
					task,
					pilotId: options.pilotId,
					repositoryId: options.repositoryId,
					mcpServerId: mcpServer.id,
					timeoutSeconds: options.timeoutSeconds,
					routeOverride,
					cooldownSeconds: options.cooldownSeconds,
					executionOrder: counterbalancedOrder(
						options.fromPair + selectedTasks.indexOf(task),
					),
					maxAttemptsPerTask:
						registration?.registration.schedule.maxAttemptsPerTask ?? 2,
				});
			} catch (error) {
				interruptions.push({
					pairId: task.id,
					state: "unclassified",
					code: interruptionCode(error),
				});
				if (options.output) {
					await writeRawCheckpoint(options.output, {
						pilotId: options.pilotId,
						completedPairIds: pairs.map((entry) => entry.pairId),
						pairs,
						runInventory: await pilotRunInventory(options.pilotId),
						interruptions,
						controls: checkpointControls,
					});
				}
				throw error;
			}
			await assertPairEvidenceIntegrity(pair);
			pairs.push(pair);
			if (options.output) {
				await writeRawCheckpoint(options.output, {
					pilotId: options.pilotId,
					completedPairIds: pairs.map((entry) => entry.pairId),
					pairs,
					runInventory: await pilotRunInventory(options.pilotId),
					interruptions,
					controls: checkpointControls,
				});
			}
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
				taskIndex < tasksToRun.length - 1
			) {
				progress({
					event: "pilot.cooldown",
					seconds: options.cooldownSeconds,
					reason: "provider_capacity_recovery_between_pairs",
				});
				await sleep(options.cooldownSeconds * 1_000);
			}
			}
		}
	} finally {
		try {
			await saveProjectExplorationCatalogSettings(options.repositoryId, {
				enabled: false,
				mcpServerId: mcpServer.id,
			});
			const restored = await getProjectExplorationCatalogSettings(
				options.repositoryId,
			);
			featureFlagRestoredToOff = restored.enabled === false;
			if (!featureFlagRestoredToOff) {
				throw new Error("Pilot feature flag did not restore to OFF.");
			}
		} finally {
			await mcpClientManager.disconnect(mcpServer.id);
			mcpDisconnected = true;
		}
	}
	const activePilotRunCount = await activePilotRunCountFor(options.pilotId);
	if (!featureFlagRestoredToOff || !mcpDisconnected || activePilotRunCount !== 0) {
		throw new Error("Pilot cleanup verification failed.");
	}
	if (options.preflightOnly) {
		const evidence = buildPilotPreflightEvidence({
			pilotId: options.pilotId,
			commits: {
				producer: producerHead,
				consumer: consumerHead,
				target: targetHead,
			},
			artifacts: {
				registration: registration?.hash ?? "",
				evaluatorQualification: evaluatorQualification?.hash ?? "",
				canary: canaryEvidence?.hash ?? "",
			},
			controlFingerprints: {
				route: routeFingerprint,
				settings: settingsFingerprint,
				promptContract: promptContractFingerprint,
				toolManifest: toolManifestFingerprint,
				evaluatorSet: evaluatorSetFingerprint(PILOT_TASKS),
			},
			gates: {
				cleanSources:
					consumerStatus.length === 0 &&
					producerStatus.length === 0 &&
					targetStatus.length === 0,
				dedicatedConsumerDatabase: options.dedicatedDatabase,
				dedicatedProducerDatabase: true,
				producerCatalogReady: producerPreparation.catalogReady,
				producerProjectRegistrationExact:
					producerPreparation.exactProjectRegistration,
				featureFlagRestoredToOff,
				mcpDisconnected,
				activePilotRunsDrained: activePilotRunCount === 0,
			},
		});
		await writeAtomicJson(options.output as string, evidence);
		process.stdout.write(
			`${JSON.stringify({ status: evidence.status, output: options.output })}\n`,
		);
		return;
	}

	const controlFingerprints = {
		routeFingerprint,
		settingsFingerprint,
		promptContractFingerprint,
		toolManifestFingerprint,
		evaluatorSetFingerprint: evaluatorSetFingerprint(selectedTasks),
	};
	if (registration) assertRegistrationFingerprints(registration, controlFingerprints);
	if (options.preflightCanary) {
		const pair = pairs[0];
		if (!pair) throw new Error("Pilot canary did not produce one complete pair.");
		const evidence = buildPilotCanaryEvidence({
			pair,
			commits: {
				producer: producerHead,
				consumer: consumerHead,
				target: targetHead,
			},
			controlFingerprints: {
				route: routeFingerprint,
				settings: settingsFingerprint,
				promptContract: controlFingerprints.promptContractFingerprint,
				toolManifest: toolManifestFingerprint,
			},
		});
		await writeAtomicJson(options.output as string, evidence);
		process.stdout.write(
			`${JSON.stringify({
				status: evidence.status,
				output: options.output,
			})}\n`,
		);
		return;
	}
	const report = buildPilotReport({
		pilotId: options.pilotId,
		selectedTasks,
		pairs,
		repositoryId: options.repositoryId,
		repositoryRoot: options.repositoryRoot,
		targetHead,
		consumerHead,
		producerHead,
		consumerDirty: consumerStatus.length > 0,
		producerDirty: producerStatus.length > 0,
		consumerDiffHash,
		mcpServerId: mcpServer.id,
		dedicatedDatabase: options.dedicatedDatabase,
		dedicatedProducerDatabase: true,
		databasePath: resolveLocalDatabasePath(process.env.DATABASE_URL),
		producerDatabasePath: options.producerDatabase,
		preRegistrationHash: registration?.hash ?? null,
		preflightCanaryHash: canaryEvidence?.hash ?? null,
		preflightEvidenceHash: preflightEvidence?.hash ?? null,
		featureFlagRestoredToOff,
		mcpDisconnected,
		activePilotRunCount,
		controlFingerprints,
	});
	if (options.output) {
		await writeAtomicJson(options.output, report);
		progress({ event: "pilot.report_written", output: options.output });
	}
	process.stdout.write(
		`${JSON.stringify({
			pilotId: report.pilotId,
			decision: report.decision,
			validPairCount: report.aggregate.validPairCount,
			output: options.output,
		})}\n`,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : error);
	process.exitCode = 1;
});
