import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	evaluatorProfileFingerprint,
	evaluatorProfileFor,
} from "./evaluator";
import { parseStrictJson } from "./strict-json";
import { PILOT_PREFLIGHT_CANARY_TASK } from "./tasks";

export const PROJECT_INTELLIGENCE_PILOT_CANARY_SCHEMA =
	"project-intelligence-value-pilot-canary-v1";

export type PilotCanaryEvidence = {
	schemaVersion: typeof PROJECT_INTELLIGENCE_PILOT_CANARY_SCHEMA;
	protocolVersion: 1;
	status: "READY" | "BLOCKED";
	commits: { producer: string; consumer: string; target: string };
	controlFingerprints: {
		route: string;
		settings: string;
		promptContract: string;
		toolManifest: string;
		evaluatorProfile: string;
	};
	pairedControls: {
		sameBaseRef: boolean;
		sameTaskPrompt: boolean;
		sameRoute: boolean;
		independentWorktrees: boolean;
	};
	baseline: {
		status: string;
		evaluatorPassed: boolean;
		verificationPassed: boolean;
	};
	catalog: {
		status: string;
		evaluatorPassed: boolean;
		verificationPassed: boolean;
		catalogCallCount: number;
		catalogCalledBeforeBroadExploration: boolean;
		catalogFailureCount: number;
	};
};

export type LoadedPilotCanaryEvidence = {
	evidence: PilotCanaryEvidence;
	hash: string;
};

type CanaryPair = {
	baseline: {
		status: string;
		evaluation: { passed: boolean; verificationPassed: boolean } | null;
	};
	catalog: {
		status: string;
		evaluation: { passed: boolean; verificationPassed: boolean } | null;
		measurement: {
			catalogCallCount: number;
			catalogCalledBeforeBroadExploration: boolean | null;
			catalogFailureCount: number;
		};
	};
	classification: string;
	controls: PilotCanaryEvidence["pairedControls"];
};

export function buildPilotCanaryEvidence(input: {
	pair: CanaryPair;
	commits: PilotCanaryEvidence["commits"];
	controlFingerprints: Omit<
		PilotCanaryEvidence["controlFingerprints"],
		"promptContract" | "evaluatorProfile"
	> & { promptContract: string };
}): PilotCanaryEvidence {
	const profileFingerprint = evaluatorProfileFingerprint(
		evaluatorProfileFor(PILOT_PREFLIGHT_CANARY_TASK),
	);
	const baseline = {
		status: input.pair.baseline.status,
		evaluatorPassed: input.pair.baseline.evaluation?.passed === true,
		verificationPassed:
			input.pair.baseline.evaluation?.verificationPassed === true,
	};
	const catalog = {
		status: input.pair.catalog.status,
		evaluatorPassed: input.pair.catalog.evaluation?.passed === true,
		verificationPassed: input.pair.catalog.evaluation?.verificationPassed === true,
		catalogCallCount: input.pair.catalog.measurement.catalogCallCount,
		catalogCalledBeforeBroadExploration:
			input.pair.catalog.measurement.catalogCalledBeforeBroadExploration === true,
		catalogFailureCount: input.pair.catalog.measurement.catalogFailureCount,
	};
	const status =
		input.pair.classification === "valid" &&
		input.pair.controls.sameBaseRef &&
		input.pair.controls.sameTaskPrompt &&
		input.pair.controls.sameRoute &&
		input.pair.controls.independentWorktrees &&
		baseline.status === "completed" &&
		baseline.evaluatorPassed &&
		baseline.verificationPassed &&
		catalog.status === "completed" &&
		catalog.evaluatorPassed &&
		catalog.verificationPassed &&
		catalog.catalogCallCount === 1 &&
		catalog.catalogCalledBeforeBroadExploration &&
		catalog.catalogFailureCount === 0
			? "READY"
			: "BLOCKED";
	return {
		schemaVersion: PROJECT_INTELLIGENCE_PILOT_CANARY_SCHEMA,
		protocolVersion: 1,
		status,
		commits: input.commits,
		controlFingerprints: {
			...input.controlFingerprints,
			evaluatorProfile: profileFingerprint,
		},
		pairedControls: input.pair.controls,
		baseline,
		catalog,
	};
}

export async function loadPilotCanaryEvidence(
	evidencePath: string,
): Promise<LoadedPilotCanaryEvidence> {
	const contents = await readFile(evidencePath, "utf8");
	let value: unknown;
	try {
		value = parseStrictJson(contents);
	} catch (error) {
		throw new Error(`Pilot canary evidence is not valid JSON: ${evidencePath}`, {
			cause: error,
		});
	}
	return {
		evidence: parsePilotCanaryEvidence(value),
		hash: sha256(contents),
	};
}

export function parsePilotCanaryEvidence(value: unknown): PilotCanaryEvidence {
	const record = object(value, "pilot canary evidence");
	assertKeys(
		record,
		[
			"schemaVersion",
			"protocolVersion",
			"status",
			"commits",
			"controlFingerprints",
			"pairedControls",
			"baseline",
			"catalog",
		],
		"pilot canary evidence",
	);
	if (record.schemaVersion !== PROJECT_INTELLIGENCE_PILOT_CANARY_SCHEMA) {
		throw new Error("Unsupported pilot canary evidence schema.");
	}
	if (record.protocolVersion !== 1) {
		throw new Error("Unsupported pilot canary evidence protocol.");
	}
	if (record.status !== "READY" && record.status !== "BLOCKED") {
		throw new Error("Pilot canary evidence status must be READY or BLOCKED.");
	}
	const commits = object(record.commits, "canary commits");
	assertKeys(commits, ["producer", "consumer", "target"], "canary commits");
	const controlFingerprints = object(
		record.controlFingerprints,
		"canary control fingerprints",
	);
	assertKeys(
		controlFingerprints,
		["route", "settings", "promptContract", "toolManifest", "evaluatorProfile"],
		"canary control fingerprints",
	);
	const pairedControls = object(record.pairedControls, "canary paired controls");
	assertKeys(
		pairedControls,
		[
			"sameBaseRef",
			"sameTaskPrompt",
			"sameRoute",
			"independentWorktrees",
		],
		"canary paired controls",
	);
	const baseline = object(record.baseline, "canary baseline");
	assertKeys(
		baseline,
		["status", "evaluatorPassed", "verificationPassed"],
		"canary baseline",
	);
	const catalog = object(record.catalog, "canary catalog");
	assertKeys(
		catalog,
		[
			"status",
			"evaluatorPassed",
			"verificationPassed",
			"catalogCallCount",
			"catalogCalledBeforeBroadExploration",
			"catalogFailureCount",
		],
		"canary catalog",
	);
	return {
		schemaVersion: PROJECT_INTELLIGENCE_PILOT_CANARY_SCHEMA,
		protocolVersion: 1,
		status: record.status,
		commits: {
			producer: gitSha(commits.producer, "canary producer commit"),
			consumer: gitSha(commits.consumer, "canary consumer commit"),
			target: gitSha(commits.target, "canary target commit"),
		},
		controlFingerprints: {
			route: fingerprint(controlFingerprints.route, "canary route fingerprint"),
			settings: fingerprint(
				controlFingerprints.settings,
				"canary settings fingerprint",
			),
			promptContract: fingerprint(
				controlFingerprints.promptContract,
				"canary prompt contract fingerprint",
			),
			toolManifest: fingerprint(
				controlFingerprints.toolManifest,
				"canary tool manifest fingerprint",
			),
			evaluatorProfile: fingerprint(
				controlFingerprints.evaluatorProfile,
				"canary evaluator profile fingerprint",
			),
		},
		pairedControls: {
			sameBaseRef: boolean(pairedControls.sameBaseRef, "sameBaseRef"),
			sameTaskPrompt: boolean(
				pairedControls.sameTaskPrompt,
				"sameTaskPrompt",
			),
			sameRoute: boolean(pairedControls.sameRoute, "sameRoute"),
			independentWorktrees: boolean(
				pairedControls.independentWorktrees,
				"independentWorktrees",
			),
		},
		baseline: {
			status: code(baseline.status, "canary baseline status"),
			evaluatorPassed: boolean(
				baseline.evaluatorPassed,
				"canary baseline evaluatorPassed",
			),
			verificationPassed: boolean(
				baseline.verificationPassed,
				"canary baseline verificationPassed",
			),
		},
		catalog: {
			status: code(catalog.status, "canary catalog status"),
			evaluatorPassed: boolean(
				catalog.evaluatorPassed,
				"canary catalog evaluatorPassed",
			),
			verificationPassed: boolean(
				catalog.verificationPassed,
				"canary catalog verificationPassed",
			),
			catalogCallCount: nonNegativeInteger(
				catalog.catalogCallCount,
				"canary catalogCallCount",
			),
			catalogCalledBeforeBroadExploration: boolean(
				catalog.catalogCalledBeforeBroadExploration,
				"canary catalogCalledBeforeBroadExploration",
			),
			catalogFailureCount: nonNegativeInteger(
				catalog.catalogFailureCount,
				"canary catalogFailureCount",
			),
		},
	};
}

export function assertPilotCanaryMatchesRuntime(input: {
	evidence: PilotCanaryEvidence;
	commits: PilotCanaryEvidence["commits"];
	controlFingerprints: Omit<
		PilotCanaryEvidence["controlFingerprints"],
		"promptContract" | "evaluatorProfile"
	>;
	registeredPromptContractFingerprint: string;
}): void {
	const expectedEvaluatorProfile = evaluatorProfileFingerprint(
		evaluatorProfileFor(PILOT_PREFLIGHT_CANARY_TASK),
	);
	if (input.evidence.status !== "READY") {
		throw new Error("Formal pilot requires READY canary evidence.");
	}
	for (const [name, expected, actual] of [
		["producer", input.commits.producer, input.evidence.commits.producer],
		["consumer", input.commits.consumer, input.evidence.commits.consumer],
		["target", input.commits.target, input.evidence.commits.target],
		["route", input.controlFingerprints.route, input.evidence.controlFingerprints.route],
		[
			"settings",
			input.controlFingerprints.settings,
			input.evidence.controlFingerprints.settings,
		],
		[
			"tool manifest",
			input.controlFingerprints.toolManifest,
			input.evidence.controlFingerprints.toolManifest,
		],
		[
			"registered prompt contract",
			input.registeredPromptContractFingerprint,
			input.evidence.controlFingerprints.promptContract,
		],
		[
			"evaluator profile",
			expectedEvaluatorProfile,
			input.evidence.controlFingerprints.evaluatorProfile,
		],
	] as const) {
		if (expected !== actual) {
			throw new Error(`Pilot canary ${name} does not match the formal run.`);
		}
	}
	const { baseline, catalog, pairedControls } = input.evidence;
	if (
		baseline.status !== "completed" ||
		!baseline.evaluatorPassed ||
		!baseline.verificationPassed ||
		catalog.status !== "completed" ||
		!catalog.evaluatorPassed ||
		!catalog.verificationPassed ||
		catalog.catalogCallCount !== 1 ||
		!catalog.catalogCalledBeforeBroadExploration ||
		catalog.catalogFailureCount !== 0 ||
		!Object.values(pairedControls).every(Boolean)
	) {
		throw new Error("Pilot canary evidence does not satisfy the READY gate.");
	}
}

function assertKeys(value: Record<string, unknown>, allowed: string[], name: string) {
	const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
	const missing = allowed.filter((key) => !(key in value));
	if (unexpected.length > 0 || missing.length > 0) {
		throw new Error(`${name} has an invalid field set.`);
	}
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function boolean(value: unknown, name: string) {
	if (typeof value !== "boolean") throw new Error(`${name} must be boolean.`);
	return value;
}

function code(value: unknown, name: string) {
	if (typeof value !== "string" || !/^[a-zA-Z0-9_.-]+$/.test(value)) {
		throw new Error(`${name} must be a safe code string.`);
	}
	return value;
}

function gitSha(value: unknown, name: string) {
	if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
		throw new Error(`${name} must be a Git SHA.`);
	}
	return value;
}

function fingerprint(value: unknown, name: string) {
	if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
		throw new Error(`${name} must be a sha256 fingerprint.`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, name: string) {
	if (!Number.isInteger(value) || (value as number) < 0) {
		throw new Error(`${name} must be a non-negative integer.`);
	}
	return value as number;
}

function sha256(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
