import { createHash } from "node:crypto";
import type { ExplorationReductionMeasurement } from "../../api/modules/ontology/exploration/project-exploration-measurement";
import type { PilotTask } from "./tasks";

type PilotPairForReport = {
	baseline: { measurement: ExplorationReductionMeasurement };
	catalog: { measurement: ExplorationReductionMeasurement };
	controls: {
		sameBaseRef: boolean;
		samePrompt: boolean;
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
			promptDigest: pilotPromptDigest(task),
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

export function pilotPromptDigest(task: PilotTask) {
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

function explorationCalls(measurement: ExplorationReductionMeasurement) {
	return (
		measurement.listDirCallsBeforeMutation +
		measurement.searchCallsBeforeMutation +
		measurement.readFileCallsBeforeMutation +
		(measurement.mode === "catalog" ? measurement.catalogCallCount : 0)
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
