import { createHash } from "node:crypto";
import type { ExplorationReductionMeasurement } from "../../api/modules/ontology/exploration/project-exploration-measurement";
import type { IndependentEvaluation } from "./evaluator";
import { modelPilotTask, type PilotTask } from "./tasks";

export type PilotAttemptClassification =
	| "valid"
	| "safety_failure"
	| "catalog_reliability_failure"
	| "shared_infrastructure_failure"
	| "task_outcome_failure"
	| "protocol_failure";

type PilotArmForReport = {
	taskId?: string;
	runId?: string;
	status?: string;
	measurement: ExplorationReductionMeasurement;
	evaluation?: IndependentEvaluation | null;
};

type PilotPairForReport = {
	pairId?: string;
	attemptNumber?: number;
	executionOrder?: ["baseline", "catalog"] | ["catalog", "baseline"];
	baseline: PilotArmForReport;
	catalog: PilotArmForReport;
	classification?: PilotAttemptClassification;
	classificationReasonCodes?: string[];
	controls: {
		sameBaseRef: boolean;
		sameTaskPrompt: boolean;
		sameRoute: boolean;
		independentWorktrees: boolean;
	};
};

export function buildPilotReport(input: {
	pilotId: string;
	selectedTasks: readonly PilotTask[];
	pairs: PilotPairForReport[];
	repositoryId: string;
	repositoryRoot: string;
	targetHead: string;
	consumerHead: string;
	producerHead?: string;
	consumerDirty: boolean;
	producerDirty?: boolean;
	consumerDiffHash: string;
	mcpServerId: string;
	dedicatedDatabase: boolean;
	dedicatedProducerDatabase?: boolean;
	databasePath: string;
	producerDatabasePath?: string;
	preRegistrationHash?: string | null;
	preflightCanaryHash?: string | null;
	preflightEvidenceHash?: string | null;
	featureFlagRestoredToOff: boolean;
	mcpDisconnected: boolean;
	activePilotRunCount: number;
	controlFingerprints?: Record<string, string>;
	safetyIncidentCount?: number;
	stopReasonCodes?: string[];
}) {
	const comparablePairs = input.pairs.filter((pair) =>
		["valid", "task_outcome_failure"].includes(
			pair.classification ?? "valid",
		),
	);
	const measurements = comparablePairs.map((pair) => ({
		baseline: pair.baseline.measurement,
		catalog: pair.catalog.measurement,
	}));
	const baselineExploration = measurements.map(({ baseline }) =>
		explorationCalls(baseline),
	);
	const catalogExploration = measurements.map(({ catalog }) =>
		explorationCalls(catalog),
	);
	const baselineNonCachedTokens = measurements.flatMap(({ baseline }) =>
		baseline.preMutationNonCachedInputTokens === null
			? []
			: [baseline.preMutationNonCachedInputTokens],
	);
	const catalogNonCachedTokens = measurements.flatMap(({ catalog }) =>
		catalog.preMutationNonCachedInputTokens === null
			? []
			: [catalog.preMutationNonCachedInputTokens],
	);
	const baselineEvaluations = comparablePairs.map(
		(pair) => pair.baseline.evaluation,
	);
	const catalogEvaluations = comparablePairs.map(
		(pair) => pair.catalog.evaluation,
	);
	const baselineCompletion = completeBooleans(baselineEvaluations, (value) => value.passed);
	const catalogCompletion = completeBooleans(catalogEvaluations, (value) => value.passed);
	const baselineVerification = completeBooleans(
		baselineEvaluations,
		(value) => value.verificationPassed,
	);
	const catalogVerification = completeBooleans(
		catalogEvaluations,
		(value) => value.verificationPassed,
	);
	const unsafeIncidentCount =
		(input.safetyIncidentCount ?? 0) +
		measurements.reduce(
			(total, { catalog }) =>
				total +
				(catalog.fallbackReason === "PROJECT_EXPLORATION_STALE" ||
				catalog.fallbackReason === "PROJECT_EXPLORATION_UNSAFE_PATH" ||
				catalog.fallbackReason === "workspace_mismatch"
					? 1
					: 0),
			0,
		);
	const catalogReliabilityFailureCount = input.pairs.filter(
		(pair) =>
			pair.classification === "catalog_reliability_failure" ||
			pair.catalog.measurement.catalogFailureCount > 0 ||
			pair.catalog.measurement.warnings.includes("catalog_result_invalid"),
	).length;
	const catalogFailurePropagationCount = measurements.filter(
		({ catalog }) => catalog.catalogFailureCount > 0 && !catalog.taskCompleted,
	).length;
	const controlsSatisfied = comparablePairs.every(
		(pair) =>
			pair.controls.sameBaseRef &&
			pair.controls.sameTaskPrompt &&
			pair.controls.sameRoute &&
			pair.controls.independentWorktrees,
	);
	const explorationReductionRate = reductionRate(
		median(baselineExploration),
		median(catalogExploration),
	);
	const tokenReductionRate = reductionRate(
		median(baselineNonCachedTokens),
		median(catalogNonCachedTokens),
	);
	const catalogExactlyOne = comparablePairs.every(
		(pair) =>
			pair.catalog.measurement.catalogCallCount === 1 &&
			pair.catalog.measurement.catalogCalledBeforeBroadExploration === true,
	);
	const noEvaluatorMutation = [...baselineEvaluations, ...catalogEvaluations].every(
		(value) => value !== null && value !== undefined && !value.evaluatorMutatedWorktree,
	);
	const measuredUsage = measurements.every(
		({ baseline, catalog }) =>
			baseline.usageMode === "measured" && catalog.usageMode === "measured",
	);
	const completionRegressionCount = regressionCount(
		baselineCompletion,
		catalogCompletion,
	);
	const verificationRegressionCount = regressionCount(
		baselineVerification,
		catalogVerification,
	);
	const gates = {
		minimumTenPairs: comparablePairs.length === 10,
		attemptRetention: input.pairs.length >= comparablePairs.length,
		pairedControls: controlsSatisfied,
		consumerSourceClean: !input.consumerDirty,
		producerSourceClean: !input.producerDirty,
		databaseIsolation: input.dedicatedDatabase,
		producerDatabaseIsolation: input.dedicatedProducerDatabase === true,
		featureFlagRestoredToOff: input.featureFlagRestoredToOff,
		mcpDisconnected: input.mcpDisconnected,
		activePilotRunsDrained: input.activePilotRunCount === 0,
		catalogExactlyOnceBeforeExploration: catalogExactlyOne,
		zeroCatalogReliabilityFailures: catalogReliabilityFailureCount === 0,
		zeroUnsafeIncidents: unsafeIncidentCount === 0,
		zeroCatalogFailurePropagation: catalogFailurePropagationCount === 0,
		independentEvaluationComplete:
			baselineCompletion.length === comparablePairs.length &&
			catalogCompletion.length === comparablePairs.length &&
			noEvaluatorMutation,
		measuredUsageComplete:
			measuredUsage &&
			baselineNonCachedTokens.length === comparablePairs.length &&
			catalogNonCachedTokens.length === comparablePairs.length,
		explorationReduction:
			explorationReductionRate !== null && explorationReductionRate >= 0.2,
		preMutationNonCachedInputTokenReduction:
			tokenReductionRate !== null && tokenReductionRate >= 0.15,
		completionNonRegression:
			catalogCompletion.length === comparablePairs.length &&
			baselineCompletion.length === comparablePairs.length &&
			rate(catalogCompletion) >= rate(baselineCompletion) &&
			completionRegressionCount === 0,
		verificationNonRegression:
			catalogVerification.length === comparablePairs.length &&
			baselineVerification.length === comparablePairs.length &&
			rate(catalogVerification) >= rate(baselineVerification) &&
			verificationRegressionCount === 0,
		noReplanIncrease:
			median(measurements.map(({ catalog }) => catalog.replanCount)) <=
			median(measurements.map(({ baseline }) => baseline.replanCount)),
	};
	const safetyOrReliabilityFailure =
		unsafeIncidentCount > 0 || catalogReliabilityFailureCount > 0;
	const evidenceComplete =
		gates.minimumTenPairs &&
		gates.attemptRetention &&
		gates.pairedControls &&
		gates.consumerSourceClean &&
		gates.producerSourceClean &&
		gates.databaseIsolation &&
		gates.producerDatabaseIsolation &&
		gates.featureFlagRestoredToOff &&
		gates.mcpDisconnected &&
		gates.activePilotRunsDrained &&
		gates.catalogExactlyOnceBeforeExploration &&
		gates.zeroCatalogFailurePropagation &&
		gates.independentEvaluationComplete &&
		gates.measuredUsageComplete;
	const decision = safetyOrReliabilityFailure
		? "NO-GO"
		: !evidenceComplete
			? "INSUFFICIENT_EVIDENCE"
			: Object.values(gates).every(Boolean)
				? "GO"
				: "NO-GO";
	const decisionReasonCodes = [
		...(safetyOrReliabilityFailure
			? [
					...(unsafeIncidentCount > 0 ? ["safety_incident"] : []),
					...(catalogReliabilityFailureCount > 0
						? ["catalog_reliability_failure"]
						: []),
				]
			: !evidenceComplete
				? failedGateCodes(gates, [
						"minimumTenPairs",
						"attemptRetention",
						"pairedControls",
						"consumerSourceClean",
						"producerSourceClean",
						"databaseIsolation",
						"producerDatabaseIsolation",
						"featureFlagRestoredToOff",
						"mcpDisconnected",
						"activePilotRunsDrained",
						"catalogExactlyOnceBeforeExploration",
						"zeroCatalogFailurePropagation",
						"independentEvaluationComplete",
						"measuredUsageComplete",
					])
				: failedGateCodes(gates)),
		...(input.stopReasonCodes ?? []),
	].sort();

	return {
		schemaVersion: "project-intelligence-value-paired-pilot-v2",
		pilotId: input.pilotId,
		protocolVersion: 1,
		generatedAt: new Date().toISOString(),
		decision,
		decisionReasonCodes,
		preRegistrationHash: input.preRegistrationHash ?? null,
		preflightCanaryHash: input.preflightCanaryHash ?? null,
		preflightEvidenceHash: input.preflightEvidenceHash ?? null,
		controls: {
			repositoryId: input.repositoryId,
			repositoryRoot: input.repositoryRoot,
			targetCommit: input.targetHead,
			consumerCommit: input.consumerHead,
			producerCommit: input.producerHead ?? null,
			consumerDirty: input.consumerDirty,
			producerDirty: input.producerDirty ?? false,
			consumerDiffHash: input.consumerDiffHash,
			mcpServerId: input.mcpServerId,
			dedicatedDatabase: input.dedicatedDatabase,
			dedicatedProducerDatabase: input.dedicatedProducerDatabase === true,
			databasePath: input.databasePath,
			producerDatabasePath: input.producerDatabasePath ?? null,
			featureFlagRestoredToOff: input.featureFlagRestoredToOff,
			mcpDisconnected: input.mcpDisconnected,
			activePilotRunCount: input.activePilotRunCount,
			...input.controlFingerprints,
		},
		taskSet: input.selectedTasks.map((task) => ({
			id: task.id,
			...modelPilotTask(task),
			promptDigest: pilotPromptDigest(task),
			evaluatorProfileId: task.evaluatorProfileId,
		})),
		attempts: input.pairs,
		validPairs: comparablePairs.map((pair) => pair.pairId ?? null),
		aggregate: {
			attemptCount: input.pairs.length,
			validPairCount: comparablePairs.length,
			baseline: {
				medianExploratoryToolCalls: median(baselineExploration),
				medianPreMutationNonCachedInputTokens: median(baselineNonCachedTokens),
				completionRate: rate(baselineCompletion),
				verificationPassRate: rate(baselineVerification),
			},
			catalog: {
				medianExploratoryToolCalls: median(catalogExploration),
				medianPreMutationNonCachedInputTokens: median(catalogNonCachedTokens),
				completionRate: rate(catalogCompletion),
				verificationPassRate: rate(catalogVerification),
				catalogBeforeBroadExplorationRate: rate(
					measurements.map(
						({ catalog }) =>
							catalog.catalogCalledBeforeBroadExploration === true,
					),
				),
				catalogExactlyOneRate: rate(
					measurements.map(({ catalog }) => catalog.catalogCallCount === 1),
				),
			},
			reductions: {
				exploratoryToolCalls: explorationReductionRate,
				preMutationNonCachedInputTokens: tokenReductionRate,
			},
			qualityGuards: {
				completionRegressionCount,
				verificationRegressionCount,
				catalogFailurePropagationCount,
			},
			safety: { unsafeIncidentCount, catalogReliabilityFailureCount },
			gates,
		},
		stopReasonCodes: [...new Set(input.stopReasonCodes ?? [])].sort(),
	};
}

export function pilotPromptDigest(task: PilotTask) {
	return `sha256:${createHash("sha256")
		.update(JSON.stringify(modelPilotTask(task)))
		.digest("hex")}`;
}

function explorationCalls(measurement: ExplorationReductionMeasurement) {
	return (
		measurement.listDirCallsBeforeMutation +
		measurement.searchCallsBeforeMutation +
		measurement.readFileCallsBeforeMutation +
		(measurement.mode === "catalog" ? measurement.catalogCallCount : 0)
	);
}

function completeBooleans<T>(
	values: Array<T | null | undefined>,
	read: (value: T) => boolean,
): boolean[] {
	return values.flatMap((value) => (value === null || value === undefined ? [] : [read(value)]));
}

function regressionCount(baseline: boolean[], catalog: boolean[]) {
	if (baseline.length !== catalog.length) return Number.POSITIVE_INFINITY;
	return baseline.reduce(
		(count, passed, index) => count + (passed && catalog[index] === false ? 1 : 0),
		0,
	);
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

function failedGateCodes(
	gates: Record<string, boolean>,
	include: string[] = Object.keys(gates),
) {
	return include.filter((name) => !gates[name]).sort();
}
