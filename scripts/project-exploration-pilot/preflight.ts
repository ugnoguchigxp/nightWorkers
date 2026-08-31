import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseStrictJson } from "./strict-json";

export const PROJECT_INTELLIGENCE_PILOT_PREFLIGHT_SCHEMA =
	"project-intelligence-value-pilot-preflight-v1";

export type PilotPreflightEvidence = {
	schemaVersion: typeof PROJECT_INTELLIGENCE_PILOT_PREFLIGHT_SCHEMA;
	protocolVersion: 1;
	status: "READY";
	pilotId: string;
	commits: { producer: string; consumer: string; target: string };
	artifacts: {
		registration: string;
		evaluatorQualification: string;
		canary: string;
	};
	controlFingerprints: {
		route: string;
		settings: string;
		promptContract: string;
		toolManifest: string;
		evaluatorSet: string;
	};
	gates: {
		cleanSources: boolean;
		dedicatedConsumerDatabase: boolean;
		dedicatedProducerDatabase: boolean;
		producerCatalogReady: boolean;
		producerProjectRegistrationExact: boolean;
		featureFlagRestoredToOff: boolean;
		mcpDisconnected: boolean;
		activePilotRunsDrained: boolean;
	};
};

export type LoadedPilotPreflightEvidence = {
	evidence: PilotPreflightEvidence;
	hash: string;
};

export function buildPilotPreflightEvidence(
	input: Omit<PilotPreflightEvidence, "schemaVersion" | "protocolVersion" | "status">,
): PilotPreflightEvidence {
	if (!Object.values(input.gates).every(Boolean)) {
		throw new Error("Cannot write READY preflight evidence with a failed gate.");
	}
	return {
		schemaVersion: PROJECT_INTELLIGENCE_PILOT_PREFLIGHT_SCHEMA,
		protocolVersion: 1,
		status: "READY",
		...input,
	};
}

export async function loadPilotPreflightEvidence(
	evidencePath: string,
): Promise<LoadedPilotPreflightEvidence> {
	const contents = await readFile(evidencePath, "utf8");
	let value: unknown;
	try {
		value = parseStrictJson(contents);
	} catch (error) {
		throw new Error(`Pilot preflight evidence is not valid JSON: ${evidencePath}`, {
			cause: error,
		});
	}
	return {
		evidence: parsePilotPreflightEvidence(value),
		hash: sha256(contents),
	};
}

export function parsePilotPreflightEvidence(value: unknown): PilotPreflightEvidence {
	const record = object(value, "pilot preflight evidence");
	assertKeys(
		record,
		[
			"schemaVersion",
			"protocolVersion",
			"status",
			"pilotId",
			"commits",
			"artifacts",
			"controlFingerprints",
			"gates",
		],
		"pilot preflight evidence",
	);
	if (record.schemaVersion !== PROJECT_INTELLIGENCE_PILOT_PREFLIGHT_SCHEMA) {
		throw new Error("Unsupported pilot preflight evidence schema.");
	}
	if (record.protocolVersion !== 1 || record.status !== "READY") {
		throw new Error("Pilot preflight evidence is not READY.");
	}
	const commits = object(record.commits, "preflight commits");
	assertKeys(commits, ["producer", "consumer", "target"], "preflight commits");
	const artifacts = object(record.artifacts, "preflight artifacts");
	assertKeys(
		artifacts,
		["registration", "evaluatorQualification", "canary"],
		"preflight artifacts",
	);
	const controlFingerprints = object(
		record.controlFingerprints,
		"preflight control fingerprints",
	);
	assertKeys(
		controlFingerprints,
		["route", "settings", "promptContract", "toolManifest", "evaluatorSet"],
		"preflight control fingerprints",
	);
	const gates = object(record.gates, "preflight gates");
	const gateNames = [
		"cleanSources",
		"dedicatedConsumerDatabase",
		"dedicatedProducerDatabase",
		"producerCatalogReady",
		"producerProjectRegistrationExact",
		"featureFlagRestoredToOff",
		"mcpDisconnected",
		"activePilotRunsDrained",
	];
	assertKeys(gates, gateNames, "preflight gates");
	const result: PilotPreflightEvidence = {
		schemaVersion: PROJECT_INTELLIGENCE_PILOT_PREFLIGHT_SCHEMA,
		protocolVersion: 1,
		status: "READY",
		pilotId: code(record.pilotId, "preflight pilotId"),
		commits: {
			producer: gitSha(commits.producer, "preflight producer commit"),
			consumer: gitSha(commits.consumer, "preflight consumer commit"),
			target: gitSha(commits.target, "preflight target commit"),
		},
		artifacts: {
			registration: fingerprint(artifacts.registration, "registration hash"),
			evaluatorQualification: fingerprint(
				artifacts.evaluatorQualification,
				"qualification hash",
			),
			canary: fingerprint(artifacts.canary, "canary hash"),
		},
		controlFingerprints: {
			route: fingerprint(controlFingerprints.route, "route fingerprint"),
			settings: fingerprint(controlFingerprints.settings, "settings fingerprint"),
			promptContract: fingerprint(
				controlFingerprints.promptContract,
				"prompt contract fingerprint",
			),
			toolManifest: fingerprint(
				controlFingerprints.toolManifest,
				"tool manifest fingerprint",
			),
			evaluatorSet: fingerprint(
				controlFingerprints.evaluatorSet,
				"evaluator set fingerprint",
			),
		},
		gates: Object.fromEntries(
			gateNames.map((name) => [name, boolean(gates[name], `preflight ${name}`)]),
		) as PilotPreflightEvidence["gates"],
	};
	if (!Object.values(result.gates).every(Boolean)) {
		throw new Error("Pilot preflight evidence cannot mark a failed gate READY.");
	}
	return result;
}

export function assertPilotPreflightMatchesRuntime(input: {
	evidence: PilotPreflightEvidence;
	pilotId: string;
	commits: PilotPreflightEvidence["commits"];
	artifacts: PilotPreflightEvidence["artifacts"];
	controlFingerprints: PilotPreflightEvidence["controlFingerprints"];
}): void {
	if (input.evidence.pilotId !== input.pilotId) {
		throw new Error("Pilot preflight evidence belongs to a different pilot ID.");
	}
	for (const [group, expected, actual] of [
		["commit", input.commits, input.evidence.commits],
		["artifact", input.artifacts, input.evidence.artifacts],
		["control fingerprint", input.controlFingerprints, input.evidence.controlFingerprints],
	] as const) {
		for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
			if (expected[key] !== actual[key]) {
				throw new Error(`Pilot preflight ${group} ${String(key)} does not match.`);
			}
		}
	}
	if (!Object.values(input.evidence.gates).every(Boolean)) {
		throw new Error("Pilot preflight evidence has an unmet gate.");
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

function sha256(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
