import { describe, expect, it } from "vitest";
import type { ExplorationReductionMeasurement } from "../api/modules/ontology/exploration/project-exploration-measurement";
import {
	assertPilotCanaryMatchesRuntime,
	buildPilotCanaryEvidence,
	parsePilotCanaryEvidence,
} from "../scripts/project-exploration-pilot/canary";
import {
	evaluatorProfileFingerprint,
	evaluatorProfileFor,
	evaluatorSetFingerprint,
} from "../scripts/project-exploration-pilot/evaluator";
import { parsePilotOptions } from "../scripts/project-exploration-pilot/options";
import {
	assertPilotPreflightMatchesRuntime,
	buildPilotPreflightEvidence,
	parsePilotPreflightEvidence,
} from "../scripts/project-exploration-pilot/preflight";
import { nativeApiToolManifestFingerprint } from "../scripts/project-exploration-pilot/protocol-fingerprints";
import {
	assertEvaluatorQualificationMatchesRuntime,
	parseEvaluatorQualificationArtifact,
} from "../scripts/project-exploration-pilot/qualification";
import {
	counterbalancedOrder,
	parsePilotRegistration,
	protocolFingerprintSummary,
} from "../scripts/project-exploration-pilot/registration";
import {
	buildPilotReport,
	type PilotAttemptClassification,
	pilotPromptDigest,
} from "../scripts/project-exploration-pilot/report";
import { vulnWorkbenchSqliteUrl } from "../scripts/project-exploration-pilot/runtime-infrastructure";
import { parseStrictJson } from "../scripts/project-exploration-pilot/strict-json";
import {
	modelPilotTask,
	PILOT_PROMPT_CONTRACT_VERSION,
	PILOT_TASKS,
	type PilotTask,
	pilotPromptContractFingerprint,
	pilotTaskDescription,
} from "../scripts/project-exploration-pilot/tasks";

describe("project exploration paired pilot modules", () => {
	it("uses the SQLite URL dialect accepted by the isolated producer", () => {
		expect(vulnWorkbenchSqliteUrl("/workspace/producer-pilot.sqlite")).toBe(
			"file:/workspace/producer-pilot.sqlite",
		);
	});

	it("parses normalized CLI options without depending on process cwd", () => {
		const options = parsePilotOptions(
			[
				"--repository-root",
				"target",
				"--producer-root",
				"producer",
				"--producer-database",
				"producer-pilot.sqlite",
				"--from-pair",
				"2",
				"--pair-count",
				"3",
				"--thinking-depth",
				"high",
				"--cooldown-seconds",
				"0",
				"--dedicated-database",
				"--output",
				"reports/pilot.json",
			],
			"/workspace",
		);

		expect(options).toMatchObject({
			repositoryRoot: "/workspace/target",
			producerRoot: "/workspace/producer",
			producerDatabase: "/workspace/producer-pilot.sqlite",
			fromPair: 2,
			pairCount: 3,
			thinkingDepth: "high",
			cooldownSeconds: 0,
			dedicatedDatabase: true,
			output: "/workspace/reports/pilot.json",
		});
	});

	it("rejects missing paths and invalid bounded numeric options", () => {
		expect(() => parsePilotOptions([], "/workspace")).toThrow(
			"--repository-root is required",
		);
		expect(() =>
			parsePilotOptions(
				[
					"--repository-root",
					"target",
					"--producer-root",
					"producer",
					"--producer-database",
					"producer-pilot.sqlite",
					"--pair-count",
					"0",
				],
				"/workspace",
			),
		).toThrow("Expected a positive integer");
		expect(() =>
			parsePilotOptions(
				[
					"--repository-root",
					"target",
					"--producer-root",
					"producer",
					"--producer-database",
					"producer-pilot.sqlite",
					"--thinking-depth",
					"ultra",
				],
				"/workspace",
			),
		).toThrow("Unsupported thinking depth: ultra");
		expect(() =>
			parsePilotOptions(
				[
					"--repository-root",
					"target",
					"--producer-root",
					"producer",
					"--producer-database",
					"producer-pilot.sqlite",
					"--formal",
				],
				"/workspace",
			),
		).toThrow("--formal requires --registration");
		expect(() =>
			parsePilotOptions(
				[
					"--repository-root",
					"target",
					"--producer-root",
					"producer",
					"--producer-database",
					"producer-pilot.sqlite",
					"--formal",
					"--registration",
					"registration.json",
					"--dedicated-database",
					"--output",
					"raw.json",
				],
				"/workspace",
			),
		).toThrow("--formal requires --evaluator-qualification");
		expect(() =>
			parsePilotOptions(
				[
					"--repository-root",
					"target",
					"--producer-root",
					"producer",
					"--producer-database",
					"producer-pilot.sqlite",
					"--formal",
					"--registration",
					"registration.json",
					"--evaluator-qualification",
					"qualification.json",
					"--dedicated-database",
					"--output",
					"raw.json",
				],
				"/workspace",
			),
		).toThrow("--formal requires --canary-evidence");
		expect(() =>
			parsePilotOptions(
				[
					"--repository-root",
					"target",
					"--producer-root",
					"producer",
					"--producer-database",
					"producer-pilot.sqlite",
					"--formal",
					"--registration",
					"registration.json",
					"--evaluator-qualification",
					"qualification.json",
					"--canary-evidence",
					"canary.json",
					"--dedicated-database",
					"--output",
					"raw.json",
				],
				"/workspace",
			),
		).toThrow("--formal requires --preflight-evidence");
	});

	it("keeps the fixed ten-task catalog and prompt contracts deterministic", () => {
		expect(PILOT_TASKS).toHaveLength(10);
		expect(new Set(PILOT_TASKS.map((task) => task.id)).size).toBe(10);
		expect(pilotPromptDigest(PILOT_TASKS[0])).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(pilotPromptDigest(PILOT_TASKS[0])).toBe(
			pilotPromptDigest({ ...PILOT_TASKS[0] }),
		);
		expect(PILOT_PROMPT_CONTRACT_VERSION).toBe(1);
		expect(pilotPromptContractFingerprint()).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(pilotPromptContractFingerprint()).toBe(
			pilotPromptContractFingerprint(),
		);
		expect(nativeApiToolManifestFingerprint()).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(nativeApiToolManifestFingerprint()).toBe(
			nativeApiToolManifestFingerprint(),
		);
	});

	it("keeps evaluator profiles out of the task payload and seals the counterbalanced schedule", () => {
		expect(JSON.stringify(modelPilotTask(PILOT_TASKS[0]))).not.toContain(
			"evaluatorProfileId",
		);
		expect(pilotTaskDescription(PILOT_TASKS[0], "baseline")).not.toContain(
			"Pilot-only protocol",
		);
		expect(pilotTaskDescription(PILOT_TASKS[0], "catalog")).toContain(
			"exactly once",
		);
		expect(counterbalancedOrder(1)).toEqual(["baseline", "catalog"]);
		expect(counterbalancedOrder(2)).toEqual(["catalog", "baseline"]);
		const fingerprints = protocolFingerprintSummary();
		expect(
			parsePilotRegistration({
				schemaVersion: "project-intelligence-value-pilot-registration-v2",
				protocolVersion: 1,
				status: "SEALED",
				pilotId: "value-pilot-v1",
				commits: {
					producer: "a".repeat(40),
					consumer: "b".repeat(40),
					target: "c".repeat(40),
				},
				fingerprints: {
					taskSet: fingerprints.taskSet,
					evaluatorSet: fingerprints.evaluatorSet,
					route: `sha256:${"d".repeat(64)}`,
					settings: `sha256:${"e".repeat(64)}`,
					promptContract: `sha256:${"f".repeat(64)}`,
					toolManifest: `sha256:${"1".repeat(64)}`,
				},
				schedule: {
					cooldownSeconds: 30,
					maxAttemptsPerTask: 2,
					maxPairAttempts: 14,
					pairs: PILOT_TASKS.map((task, index) => ({
						taskId: task.id,
						order: counterbalancedOrder(index + 1),
					})),
				},
				retention: { rawEvidencePolicy: "LOCAL_OWNER_RETAINED" },
				approvals: { pilotOwner: "owner" },
			}),
		).toMatchObject({ pilotId: "value-pilot-v1", status: "SEALED" });
	});

	it("rejects placeholder approvals, placeholder fingerprints, and extra sealed fields", () => {
		const registration = sealedRegistration();
		registration.approvals.pilotOwner = "UNASSIGNED";
		expect(() => parsePilotRegistration(registration)).toThrow(
			"assigned approver",
		);

		registration.approvals.pilotOwner = "pilot-owner";
		registration.fingerprints.route = `sha256:${"0".repeat(64)}`;
		expect(() => parsePilotRegistration(registration)).toThrow(
			"zero placeholder",
		);

		registration.fingerprints.route = `sha256:${"d".repeat(64)}`;
		Object.assign(registration, { unreviewedOverride: true });
		expect(() => parsePilotRegistration(registration)).toThrow(
			"invalid field set",
		);
	});

	it("requires a complete, matching evaluator qualification before a formal pilot", () => {
		const targetCommit = "c".repeat(40);
		const artifact = parseEvaluatorQualificationArtifact({
			schemaVersion:
				"project-intelligence-value-pilot-evaluator-qualification-v1",
			status: "READY",
			targetCommit,
			evaluatorSetFingerprint: evaluatorSetFingerprint(PILOT_TASKS),
			qualifications: PILOT_TASKS.map((task) => {
				const profile = evaluatorProfileFor(task);
				const fingerprint = evaluatorProfileFingerprint(profile);
				return {
					taskId: task.id,
					profileId: task.evaluatorProfileId,
					profileFingerprint: fingerprint,
					baseCommit: targetCommit,
					positiveCommit: "d".repeat(40),
					baseClean: true,
					positiveClean: true,
					baseFails: true,
					positivePasses: true,
					base: qualifiedEvaluation(
						task.evaluatorProfileId,
						fingerprint,
						false,
					),
					positive: qualifiedEvaluation(
						task.evaluatorProfileId,
						fingerprint,
						true,
					),
				};
			}),
		});

		expect(() =>
			assertEvaluatorQualificationMatchesRuntime({ artifact, targetCommit }),
		).not.toThrow();
		expect(() =>
			assertEvaluatorQualificationMatchesRuntime({
				artifact: {
					...artifact,
					qualifications: artifact.qualifications.map((entry, index) =>
						index === 0
							? {
									...entry,
									base: { ...entry.base, passed: true },
								}
							: entry,
					),
				},
				targetCommit,
			}),
		).toThrow("evidence does not match");
	});

	it("rejects duplicate JSON control fields before a pilot artifact is parsed", () => {
		expect(() =>
			parseStrictJson('{"status":"DRAFT","status":"SEALED"}'),
		).toThrow("Duplicate JSON key: status");
	});

	it("seals a successful paired canary and rejects a canary with a repeated catalog call", () => {
		const commits = {
			producer: "a".repeat(40),
			consumer: "b".repeat(40),
			target: "c".repeat(40),
		};
		const controls = {
			route: `sha256:${"d".repeat(64)}`,
			settings: `sha256:${"e".repeat(64)}`,
			promptContract: `sha256:${"f".repeat(64)}`,
			toolManifest: `sha256:${"0".repeat(64)}`,
		};
		const evidence = buildPilotCanaryEvidence({
			commits,
			controlFingerprints: controls,
			pair: canaryPair(),
		});

		expect(evidence.status).toBe("READY");
		expect(() =>
			assertPilotCanaryMatchesRuntime({
				evidence: parsePilotCanaryEvidence(evidence),
				commits,
				controlFingerprints: controls,
				registeredPromptContractFingerprint: controls.promptContract,
			}),
		).not.toThrow();
		expect(
			buildPilotCanaryEvidence({
				commits,
				controlFingerprints: controls,
				pair: canaryPair({ catalogCallCount: 2 }),
			}).status,
		).toBe("BLOCKED");
	});

	it("binds READY preflight evidence to every mutable pilot input", () => {
		const commits = {
			producer: "a".repeat(40),
			consumer: "b".repeat(40),
			target: "c".repeat(40),
		};
		const artifacts = {
			registration: `sha256:${"d".repeat(64)}`,
			evaluatorQualification: `sha256:${"e".repeat(64)}`,
			canary: `sha256:${"f".repeat(64)}`,
		};
		const controlFingerprints = {
			route: `sha256:${"0".repeat(64)}`,
			settings: `sha256:${"1".repeat(64)}`,
			promptContract: `sha256:${"2".repeat(64)}`,
			toolManifest: `sha256:${"3".repeat(64)}`,
			evaluatorSet: `sha256:${"4".repeat(64)}`,
		};
		const evidence = buildPilotPreflightEvidence({
			pilotId: "value-pilot-v1",
			commits,
			artifacts,
			controlFingerprints,
			gates: {
				cleanSources: true,
				dedicatedConsumerDatabase: true,
				dedicatedProducerDatabase: true,
				producerCatalogReady: true,
				producerProjectRegistrationExact: true,
				featureFlagRestoredToOff: true,
				mcpDisconnected: true,
				activePilotRunsDrained: true,
			},
		});

		expect(() =>
			assertPilotPreflightMatchesRuntime({
				evidence: parsePilotPreflightEvidence(evidence),
				pilotId: "value-pilot-v1",
				commits,
				artifacts,
				controlFingerprints,
			}),
		).not.toThrow();
		expect(() =>
			assertPilotPreflightMatchesRuntime({
				evidence,
				pilotId: "value-pilot-v1",
				commits,
				artifacts: { ...artifacts, canary: `sha256:${"5".repeat(64)}` },
				controlFingerprints,
			}),
		).toThrow("artifact canary does not match");
	});

	it("returns GO only for complete paired evidence that passes every gate", () => {
		const task = PILOT_TASKS[0];
		const pairs = Array.from({ length: 10 }, (_value, index) =>
			pair(task, index, {
				baseline: measurement("baseline", {
					listDirCallsBeforeMutation: 10,
					totalInputTokens: 1_000,
				}),
				catalog: measurement("catalog", {
					listDirCallsBeforeMutation: 5,
					catalogCallCount: 1,
					catalogCalled: true,
					catalogCalledBeforeBroadExploration: true,
					totalInputTokens: 700,
					preMutationInputTokens: 700,
					preMutationNonCachedInputTokens: 700,
				}),
			}),
		);

		const report = buildPilotReport(reportInput(task, pairs));

		expect(report.decision).toBe("GO");
		expect(report.aggregate.gates).toEqual(
			expect.objectContaining({
				minimumTenPairs: true,
				explorationReduction: true,
				preMutationNonCachedInputTokenReduction: true,
			}),
		);
	});

	it("separates insufficient evidence from a measured NO-GO", () => {
		const task = PILOT_TASKS[0];
		const incomplete = buildPilotReport(reportInput(task, [pair(task, 0)]));
		expect(incomplete.decision).toBe("INSUFFICIENT_EVIDENCE");

		const measuredPairs = Array.from({ length: 10 }, (_value, index) =>
			pair(task, index),
		);
		const noGo = buildPilotReport(reportInput(task, measuredPairs));
		expect(noGo.decision).toBe("NO-GO");
		expect(noGo.aggregate.gates.explorationReduction).toBe(false);
	});

	it("keeps task outcome failures in the paired comparison instead of excluding them", () => {
		const task = PILOT_TASKS[0];
		const pairs = Array.from({ length: 10 }, (_value, index) =>
			pair(task, index, {
				baseline: measurement("baseline", {
					listDirCallsBeforeMutation: 10,
				}),
				catalog: measurement("catalog", {
					listDirCallsBeforeMutation: 5,
					preMutationInputTokens: 700,
					preMutationNonCachedInputTokens: 700,
				}),
			}),
		);
		const first = pairs[0];
		if (!first) throw new Error("Test fixture is unexpectedly empty.");
		pairs[0] = {
			...first,
			classification: "task_outcome_failure",
			catalog: {
				...first.catalog,
				evaluation: { ...evaluation(task.evaluatorProfileId), passed: false },
			},
		};

		const report = buildPilotReport(reportInput(task, pairs));

		expect(report.aggregate.validPairCount).toBe(10);
		expect(report.aggregate.qualityGuards.completionRegressionCount).toBe(1);
		expect(report.decision).toBe("NO-GO");
	});

	it("withholds a decision when terminal cleanup controls are not proven", () => {
		const task = PILOT_TASKS[0];
		const pairs = Array.from({ length: 10 }, (_value, index) =>
			pair(task, index, {
				baseline: measurement("baseline", {
					listDirCallsBeforeMutation: 10,
				}),
				catalog: measurement("catalog", {
					listDirCallsBeforeMutation: 5,
					preMutationInputTokens: 700,
					preMutationNonCachedInputTokens: 700,
				}),
			}),
		);

		const report = buildPilotReport({
			...reportInput(task, pairs),
			mcpDisconnected: false,
		});

		expect(report.decision).toBe("INSUFFICIENT_EVIDENCE");
		expect(report.aggregate.gates.mcpDisconnected).toBe(false);
	});
});

function measurement(
	mode: "baseline" | "catalog",
	overrides: Partial<ExplorationReductionMeasurement> = {},
): ExplorationReductionMeasurement {
	return {
		runId: `${mode}-run`,
		taskId: `${mode}-task`,
		repositoryId: "repository-1",
		mode,
		generationId: null,
		preparationDurationMs: null,
		preparationReused: null,
		preparationPollCount: null,
		fallbackReason: null,
		catalogAvailable: mode === "catalog",
		catalogCalled: mode === "catalog",
		catalogCallCount: mode === "catalog" ? 1 : 0,
		catalogFailureCount: 0,
		catalogResponseBytes: 0,
		catalogFileCount: 0,
		catalogTestCount: 0,
		catalogVerificationCount: 0,
		broadExplorationCallsBeforeCatalog: 0,
		catalogCalledBeforeBroadExploration: mode === "catalog" ? true : null,
		listDirCallsBeforeMutation: 10,
		searchCallsBeforeMutation: 0,
		readFileCallsBeforeMutation: 0,
		uniqueFilesReadBeforeMutation: 0,
		totalInputTokens: 1_000,
		totalCachedInputTokens: 0,
		preMutationInputTokens: 1_000,
		preMutationCachedInputTokens: 0,
		preMutationNonCachedInputTokens: 1_000,
		usageMode: "measured",
		timeToFirstMutationMs: 1,
		taskCompleted: true,
		verificationPassed: true,
		replanCount: 0,
		warnings: [],
		...overrides,
	};
}

function pair(
	task: PilotTask,
	index: number,
	overrides: {
		baseline?: ExplorationReductionMeasurement;
		catalog?: ExplorationReductionMeasurement;
	} = {},
) {
	return {
		pairId: `${task.id}-${index}`,
		classification: undefined as PilotAttemptClassification | undefined,
		baseline: {
			measurement: overrides.baseline ?? measurement("baseline"),
			evaluation: evaluation(task.evaluatorProfileId),
		},
		catalog: {
			measurement: overrides.catalog ?? measurement("catalog"),
			evaluation: evaluation(task.evaluatorProfileId),
		},
		controls: {
			sameBaseRef: true,
			sameTaskPrompt: true,
			sameRoute: true,
			independentWorktrees: true,
		},
	};
}

function reportInput(task: PilotTask, pairs: ReturnType<typeof pair>[]) {
	return {
		pilotId: "pilot-1",
		selectedTasks: [task],
		pairs,
		repositoryId: "repository-1",
		repositoryRoot: "/workspace/target",
		targetHead: "target-head",
		consumerHead: "consumer-head",
		consumerDirty: false,
		consumerDiffHash: "diff-hash",
		mcpServerId: "mcp-1",
		dedicatedDatabase: true,
		dedicatedProducerDatabase: true,
		databasePath: "/runtime/pilot.sqlite",
		producerDatabasePath: "/runtime/producer-pilot.sqlite",
		featureFlagRestoredToOff: true,
		mcpDisconnected: true,
		activePilotRunCount: 0,
	};
}

function evaluation(profileId: PilotTask["evaluatorProfileId"]) {
	return {
		profileId,
		profileFingerprint:
			"sha256:0000000000000000000000000000000000000000000000000000000000000000",
		passed: true,
		verificationPassed: true,
		commands: [],
		beforeDiffDigest:
			"sha256:1111111111111111111111111111111111111111111111111111111111111111",
		afterDiffDigest:
			"sha256:1111111111111111111111111111111111111111111111111111111111111111",
		evaluatorMutatedWorktree: false,
	};
}

function qualifiedEvaluation(
	profileId: PilotTask["evaluatorProfileId"],
	profileFingerprint: string,
	passed: boolean,
) {
	return {
		profileId,
		profileFingerprint,
		passed,
		verificationPassed: passed,
		commands: [],
		beforeDiffDigest:
			"sha256:1111111111111111111111111111111111111111111111111111111111111111",
		afterDiffDigest:
			"sha256:1111111111111111111111111111111111111111111111111111111111111111",
		evaluatorMutatedWorktree: false,
	};
}

function canaryPair(overrides: { catalogCallCount?: number } = {}) {
	return {
		classification: "valid",
		controls: {
			sameBaseRef: true,
			sameTaskPrompt: true,
			sameRoute: true,
			independentWorktrees: true,
		},
		baseline: {
			status: "completed",
			evaluation: { passed: true, verificationPassed: true },
		},
		catalog: {
			status: "completed",
			evaluation: { passed: true, verificationPassed: true },
			measurement: {
				catalogCallCount: overrides.catalogCallCount ?? 1,
				catalogCalledBeforeBroadExploration: true,
				catalogFailureCount: 0,
			},
		},
	};
}

function sealedRegistration() {
	const fingerprints = protocolFingerprintSummary();
	return {
		schemaVersion: "project-intelligence-value-pilot-registration-v2",
		protocolVersion: 1,
		status: "SEALED",
		pilotId: "value-pilot-v1",
		commits: {
			producer: "a".repeat(40),
			consumer: "b".repeat(40),
			target: "c".repeat(40),
		},
		fingerprints: {
			taskSet: fingerprints.taskSet,
			evaluatorSet: fingerprints.evaluatorSet,
			route: `sha256:${"d".repeat(64)}`,
			settings: `sha256:${"e".repeat(64)}`,
			promptContract: `sha256:${"f".repeat(64)}`,
			toolManifest: `sha256:${"1".repeat(64)}`,
		},
		schedule: {
			cooldownSeconds: 30,
			maxAttemptsPerTask: 2,
			maxPairAttempts: 14,
			pairs: PILOT_TASKS.map((task, index) => ({
				taskId: task.id,
				order: counterbalancedOrder(index + 1),
			})),
		},
		retention: { rawEvidencePolicy: "LOCAL_OWNER_RETAINED" },
		approvals: { pilotOwner: "pilot-owner" },
	};
}
