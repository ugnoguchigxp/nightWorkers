import { readFile } from "node:fs/promises";
import type { ExplorationReductionMeasurement } from "../../api/modules/ontology/exploration/project-exploration-measurement";
import {
	assertPilotCanaryMatchesRuntime,
	loadPilotCanaryEvidence,
} from "./canary";
import type { IndependentEvaluation } from "./evaluator";
import type { PilotOptions } from "./options";
import {
	assertPilotPreflightMatchesRuntime,
	loadPilotPreflightEvidence,
} from "./preflight";
import { pilotPromptDigest, type PilotAttemptClassification } from "./report";
import {
	assertRegistrationMatchesRuntime,
	counterbalancedOrder,
	loadPilotRegistration,
	type LoadedPilotRegistration,
} from "./registration";
import { parseStrictJson } from "./strict-json";
import { PILOT_TASKS } from "./tasks";

export type PilotPair = {
	pairId: string;
	attemptNumber: number;
	executionOrder: ["baseline", "catalog"] | ["catalog", "baseline"];
	promptDigest: string;
	baseline: PilotPairArm;
	catalog: PilotPairArm;
	classification: PilotAttemptClassification;
	classificationReasonCodes: string[];
	controls: {
		sameBaseRef: boolean;
		sameTaskPrompt: boolean;
		sameRoute: boolean;
		independentWorktrees: boolean;
	};
};

type PilotPairArm = {
	taskId: string;
	runId: string;
	status: string;
	baseRef: string | null;
	worktreePath: string | null;
	taskPromptFingerprint: string;
	measurement: ExplorationReductionMeasurement;
	evaluation: IndependentEvaluation | null;
	route: Record<string, string | null>;
	systemPromptFingerprint: string;
};

type ResumeCheckpoint = {
	pairs: PilotPair[];
	interruptions: Array<{
		pairId: string;
		state: "unclassified";
		code: "pilot_pair_interrupted_before_classification";
	}>;
	controls: null | Record<string, string | null>;
};

export function assertRegistrationFingerprints(
	registration: LoadedPilotRegistration,
	actual: Record<string, string>,
) {
	const expected = registration.registration.fingerprints;
	const mappings: Array<[keyof typeof expected, string]> = [
		["route", actual.routeFingerprint],
		["settings", actual.settingsFingerprint],
		["promptContract", actual.promptContractFingerprint],
		["toolManifest", actual.toolManifestFingerprint],
		["evaluatorSet", actual.evaluatorSetFingerprint],
	];
	for (const [name, value] of mappings) {
		if (expected[name] !== value) {
			throw new Error(`Sealed ${name} fingerprint does not match the formal run.`);
		}
	}
}

export async function loadFormalRegistration(
	options: PilotOptions,
	commits: { producerHead: string; consumerHead: string; targetHead: string },
): Promise<LoadedPilotRegistration | null> {
	if (!options.formal) return null;
	if (!options.registration) {
		throw new Error("Formal pilot requires a registration path.");
	}
	const loaded = await loadPilotRegistration(options.registration);
	assertRegistrationMatchesRuntime({
		registration: loaded.registration,
		pilotId: options.pilotId,
		producerCommit: commits.producerHead,
		consumerCommit: commits.consumerHead,
		targetCommit: commits.targetHead,
	});
	if (
		options.fromPair !== 1 ||
		options.pairCount !== loaded.registration.schedule.pairs.length ||
		options.cooldownSeconds !== loaded.registration.schedule.cooldownSeconds
	) {
		throw new Error(
			"Formal pilot must use the sealed full schedule and registered cooldown.",
		);
	}
	return loaded;
}

export async function loadFormalEvaluatorQualification(
	options: PilotOptions,
	targetHead: string,
) {
	if (!options.formal) return null;
	if (!options.evaluatorQualification) {
		throw new Error("Formal pilot requires an evaluator qualification artifact.");
	}
	const { assertEvaluatorQualificationMatchesRuntime, loadEvaluatorQualificationArtifact } =
		await import("./qualification");
	const loaded = await loadEvaluatorQualificationArtifact(
		options.evaluatorQualification,
	);
	assertEvaluatorQualificationMatchesRuntime({
		artifact: loaded.artifact,
		targetCommit: targetHead,
	});
	return loaded;
}

export async function loadFormalCanaryEvidence(
	options: PilotOptions,
	input: {
		registration: LoadedPilotRegistration | null;
		commits: { producer: string; consumer: string; target: string };
		controlFingerprints: {
			route: string;
			settings: string;
			toolManifest: string;
		};
	},
) {
	if (!options.formal) return null;
	if (!options.canaryEvidence || !input.registration) {
		throw new Error("Formal pilot requires sealed canary evidence.");
	}
	const loaded = await loadPilotCanaryEvidence(options.canaryEvidence);
	assertPilotCanaryMatchesRuntime({
		evidence: loaded.evidence,
		commits: input.commits,
		controlFingerprints: input.controlFingerprints,
		registeredPromptContractFingerprint:
				input.registration.registration.fingerprints.promptContract,
	});
	return loaded;
}

export async function loadFormalPreflightEvidence(
	options: PilotOptions,
	input: {
		registration: LoadedPilotRegistration | null;
		evaluatorQualification: Awaited<
			ReturnType<typeof loadFormalEvaluatorQualification>
		>;
		canaryEvidence: Awaited<ReturnType<typeof loadFormalCanaryEvidence>>;
		commits: { producer: string; consumer: string; target: string };
		controlFingerprints: {
			route: string;
			settings: string;
				promptContract: string;
			toolManifest: string;
			evaluatorSet: string;
		};
	},
) {
	if (!options.formal || options.preflightOnly) return null;
	if (
		!options.preflightEvidence ||
		!input.registration ||
		!input.evaluatorQualification ||
		!input.canaryEvidence
	) {
		throw new Error("Formal pilot requires READY preflight evidence.");
	}
	const loaded = await loadPilotPreflightEvidence(options.preflightEvidence);
	assertPilotPreflightMatchesRuntime({
		evidence: loaded.evidence,
		pilotId: options.pilotId,
		commits: input.commits,
		artifacts: {
			registration: input.registration.hash,
			evaluatorQualification: input.evaluatorQualification.hash,
			canary: input.canaryEvidence.hash,
		},
		controlFingerprints: input.controlFingerprints,
	});
	return loaded;
}

export async function loadResumeCheckpoint(
	options: PilotOptions,
): Promise<ResumeCheckpoint> {
	if (!options.resume) {
		return { pairs: [], interruptions: [], controls: null };
	}
	const raw = await readFile(options.resume, "utf8");
	let parsed: unknown;
	try {
		parsed = parseStrictJson(raw);
	} catch (error) {
		throw new Error("Pilot resume checkpoint is not valid JSON.", { cause: error });
	}
	const checkpoint = recordValue(parsed);
	if (checkpoint?.pilotId !== options.pilotId) {
		throw new Error("Pilot resume checkpoint belongs to a different pilot ID.");
	}
	if (!Array.isArray(checkpoint.pairs)) {
		throw new Error("Pilot resume checkpoint does not contain complete pair boundaries.");
	}
	const pairs = checkpoint.pairs.filter((value): value is PilotPair => {
		const pair = recordValue(value);
		return (
			Boolean(pair) &&
			typeof pair?.pairId === "string" &&
			typeof pair?.attemptNumber === "number" &&
			recordValue(pair?.baseline) !== null &&
			recordValue(pair?.catalog) !== null
		);
	});
	if (pairs.length !== checkpoint.pairs.length) {
		throw new Error("Pilot resume checkpoint contains a partial or malformed pair.");
	}
	const rawInterruptions = checkpoint.interruptions;
	if (rawInterruptions !== undefined && !Array.isArray(rawInterruptions)) {
		throw new Error("Pilot resume checkpoint contains malformed interruptions.");
	}
	const interruptions = (rawInterruptions ?? []).map((value) => {
		const interruption = recordValue(value);
		if (
			!interruption ||
			typeof interruption.pairId !== "string" ||
			interruption.state !== "unclassified" ||
			interruption.code !== "pilot_pair_interrupted_before_classification"
		) {
			throw new Error("Pilot resume checkpoint contains malformed interruption evidence.");
		}
		return {
			pairId: interruption.pairId,
			state: "unclassified" as const,
			code: "pilot_pair_interrupted_before_classification" as const,
		};
	});
	return { pairs, interruptions, controls: parseResumeCheckpointControls(checkpoint.controls) };
}

function parseResumeCheckpointControls(value: unknown) {
	if (value === undefined) return null;
	const controls = recordValue(value);
	if (!controls) {
		throw new Error("Pilot resume checkpoint contains malformed controls.");
	}
	const required = [
		"producerCommit",
		"consumerCommit",
		"targetCommit",
		"routeFingerprint",
		"settingsFingerprint",
		"toolManifestFingerprint",
		"preRegistrationHash",
		"preflightCanaryHash",
		"preflightEvidenceHash",
		"promptContractFingerprint",
	];
	if (
		Object.keys(controls).length !== required.length ||
		required.some((key) => !(key in controls))
	) {
		throw new Error("Pilot resume checkpoint controls have an invalid field set.");
	}
	for (const key of ["producerCommit", "consumerCommit", "targetCommit"]) {
		if (
			typeof controls[key] !== "string" ||
			!/^[a-f0-9]{40}$/.test(controls[key])
		) {
			throw new Error(`Pilot resume checkpoint has invalid ${key}.`);
		}
	}
	for (const key of [
		"routeFingerprint",
		"settingsFingerprint",
		"toolManifestFingerprint",
	]) {
		if (
			typeof controls[key] !== "string" ||
			!/^sha256:[a-f0-9]{64}$/.test(controls[key])
		) {
			throw new Error(`Pilot resume checkpoint has invalid ${key}.`);
		}
	}
	for (const key of [
		"preRegistrationHash",
		"preflightCanaryHash",
		"preflightEvidenceHash",
		"promptContractFingerprint",
	]) {
		if (
			controls[key] !== null &&
			(typeof controls[key] !== "string" ||
				!/^sha256:[a-f0-9]{64}$/.test(controls[key]))
		) {
			throw new Error(`Pilot resume checkpoint has invalid ${key}.`);
		}
	}
	return controls as Record<string, string | null>;
}

export function assertResumeCheckpointMatchesRuntime(input: {
	checkpoint: ResumeCheckpoint;
	controls: Record<string, string | null>;
	formal: boolean;
}) {
	if (!input.checkpoint.controls) {
		if (input.formal && input.checkpoint.pairs.length > 0) {
			throw new Error("Formal pilot cannot resume a checkpoint without sealed controls.");
		}
		return;
	}
	for (const [name, expected] of Object.entries(input.controls)) {
		if (input.checkpoint.controls[name] !== expected) {
			throw new Error(`Pilot resume checkpoint ${name} does not match this run.`);
		}
	}
	if (!input.formal) return;
	for (const pair of input.checkpoint.pairs) {
		const task = PILOT_TASKS.find((candidate) => candidate.id === pair.pairId);
		if (
			!task ||
			!Number.isInteger(pair.attemptNumber) ||
			pair.attemptNumber < 1 ||
			pair.promptDigest !== pilotPromptDigest(task) ||
			JSON.stringify(pair.executionOrder) !==
				JSON.stringify(counterbalancedOrder(Number(task.id.slice(1))))
		) {
			throw new Error("Formal pilot resume checkpoint does not match the sealed protocol.");
		}
	}
}

export function classifyPair(input: {
	baseline: Pick<PilotPairArm, "status" | "measurement" | "evaluation">;
	catalog: Pick<PilotPairArm, "status" | "measurement" | "evaluation">;
}): PilotAttemptClassification {
	if (
		input.catalog.measurement.fallbackReason === "PROJECT_EXPLORATION_STALE" ||
		input.catalog.measurement.fallbackReason === "PROJECT_EXPLORATION_UNSAFE_PATH" ||
		input.catalog.measurement.fallbackReason === "workspace_mismatch"
	) {
		return "safety_failure";
	}
	if (
		input.catalog.measurement.catalogFailureCount > 0 ||
		input.catalog.measurement.warnings.includes("catalog_result_invalid")
	) {
		return "catalog_reliability_failure";
	}
	if (
		input.catalog.measurement.catalogCallCount !== 1 ||
		input.catalog.measurement.catalogCalledBeforeBroadExploration !== true ||
		!input.baseline.evaluation ||
		!input.catalog.evaluation ||
		input.baseline.evaluation.evaluatorMutatedWorktree ||
		input.catalog.evaluation.evaluatorMutatedWorktree
	) {
		return "protocol_failure";
	}
	if (
		input.baseline.status !== "completed" ||
		input.catalog.status !== "completed" ||
		!input.baseline.evaluation.passed ||
		!input.catalog.evaluation.passed ||
		!input.baseline.evaluation.verificationPassed ||
		!input.catalog.evaluation.verificationPassed
	) {
		return "task_outcome_failure";
	}
	return "valid";
}

export function classifyPairReasonCodes(input: Parameters<typeof classifyPair>[0]) {
	const classification = classifyPair(input);
	if (classification === "valid") return [];
	if (classification === "safety_failure") return ["unsafe_catalog_binding"];
	if (classification === "catalog_reliability_failure") {
		return ["catalog_contract_or_transport_failure"];
	}
	if (classification === "task_outcome_failure") {
		return ["independent_evaluation_or_run_failure"];
	}
	return ["missing_required_protocol_evidence"];
}
