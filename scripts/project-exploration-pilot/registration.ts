import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	evaluatorSetFingerprint,
	INDEPENDENT_EVALUATOR_PROFILES,
} from "./evaluator";
import { parseStrictJson } from "./strict-json";
import { modelPilotTask, PILOT_TASKS, type PilotTask } from "./tasks";

export const VALUE_PILOT_REGISTRATION_SCHEMA =
	"project-intelligence-value-pilot-registration-v1";
export const VALUE_PILOT_PROTOCOL_VERSION = 1;

export type PilotArm = "baseline" | "catalog";

export type PilotRegistration = {
	schemaVersion: typeof VALUE_PILOT_REGISTRATION_SCHEMA;
	protocolVersion: typeof VALUE_PILOT_PROTOCOL_VERSION;
	status: "SEALED";
	pilotId: string;
	commits: {
		producer: string;
		consumer: string;
		target: string;
	};
	fingerprints: {
		taskSet: string;
		evaluatorSet: string;
		route: string;
		settings: string;
		systemPrompt: string;
		toolManifest: string;
	};
	schedule: {
		cooldownSeconds: number;
		maxAttemptsPerTask: 2;
		maxPairAttempts: 14;
		pairs: Array<{ taskId: string; order: [PilotArm, PilotArm] }>;
	};
	retention: { rawEvidenceDeleteAfter: string };
	approvals: {
		nightworkersRolloutOwner: string;
		vulnWorkbenchEvidenceReviewer: string;
	};
};

export type LoadedPilotRegistration = {
	registration: PilotRegistration;
	hash: string;
};

export async function loadPilotRegistration(
	registrationPath: string,
): Promise<LoadedPilotRegistration> {
	const contents = await readFile(registrationPath, "utf8");
	let value: unknown;
	try {
		value = parseStrictJson(contents);
	} catch (error) {
		throw new Error(`Pilot registration is not valid JSON: ${registrationPath}`, {
			cause: error,
		});
	}
	return { registration: parsePilotRegistration(value), hash: sha256(contents) };
}

export function parsePilotRegistration(value: unknown): PilotRegistration {
	const record = object(value, "registration");
	assertExactKeys(
		record,
		[
			"schemaVersion",
			"protocolVersion",
			"status",
			"pilotId",
			"commits",
			"fingerprints",
			"schedule",
			"retention",
			"approvals",
		],
		"registration",
	);
	const schemaVersion = text(record.schemaVersion, "schemaVersion");
	if (schemaVersion !== VALUE_PILOT_REGISTRATION_SCHEMA) {
		throw new Error(`Unsupported pilot registration schema: ${schemaVersion}`);
	}
	const protocolVersion = integer(record.protocolVersion, "protocolVersion");
	if (protocolVersion !== VALUE_PILOT_PROTOCOL_VERSION) {
		throw new Error(`Unsupported pilot protocol version: ${protocolVersion}`);
	}
	if (text(record.status, "status") !== "SEALED") {
		throw new Error("Formal pilot registration must be SEALED.");
	}
	const registration: PilotRegistration = {
		schemaVersion,
		protocolVersion,
		status: "SEALED",
		pilotId: text(record.pilotId, "pilotId"),
		commits: commits(object(record.commits, "commits")),
		fingerprints: fingerprints(object(record.fingerprints, "fingerprints")),
		schedule: schedule(object(record.schedule, "schedule")),
		retention: retention(object(record.retention, "retention")),
		approvals: {
			...approvals(object(record.approvals, "approvals")),
		},
	};
	assertRegistrationMatchesFixedProtocol(registration);
	return registration;
}

export function assertRegistrationMatchesRuntime(input: {
	registration: PilotRegistration;
	pilotId: string;
	producerCommit: string;
	consumerCommit: string;
	targetCommit: string;
}) {
	const { registration } = input;
	if (registration.pilotId !== input.pilotId) {
		throw new Error("Pilot ID does not match the sealed registration.");
	}
	for (const [name, actual, expected] of [
		["producer", input.producerCommit, registration.commits.producer],
		["consumer", input.consumerCommit, registration.commits.consumer],
		["target", input.targetCommit, registration.commits.target],
	] as const) {
		if (actual !== expected) {
			throw new Error(`Sealed ${name} commit mismatch: expected ${expected}, received ${actual}.`);
		}
	}
}

export function counterbalancedOrder(pairPosition: number): [PilotArm, PilotArm] {
	return pairPosition % 2 === 1
		? ["baseline", "catalog"]
		: ["catalog", "baseline"];
}

export function taskSetFingerprint(tasks: readonly PilotTask[] = PILOT_TASKS) {
	return sha256(
		JSON.stringify(
			tasks.map((task) => ({ id: task.id, ...modelPilotTask(task) })),
		),
	);
}

export function protocolFingerprintSummary(tasks: readonly PilotTask[] = PILOT_TASKS) {
	return {
		taskSet: taskSetFingerprint(tasks),
		evaluatorSet: evaluatorSetFingerprint(tasks),
		evaluatorProfileCount: INDEPENDENT_EVALUATOR_PROFILES.length,
	};
}

function assertRegistrationMatchesFixedProtocol(registration: PilotRegistration) {
	const expectedTaskIds = PILOT_TASKS.map((task) => task.id);
	const receivedTaskIds = registration.schedule.pairs.map((pair) => pair.taskId);
	if (
		receivedTaskIds.length !== expectedTaskIds.length ||
		receivedTaskIds.some((taskId, index) => taskId !== expectedTaskIds[index])
	) {
		throw new Error("Registration must contain the fixed ten-task schedule in canonical order.");
	}
	for (const [index, pair] of registration.schedule.pairs.entries()) {
		const expected = counterbalancedOrder(index + 1);
		if (pair.order[0] !== expected[0] || pair.order[1] !== expected[1]) {
			throw new Error(`Registration pair ${pair.taskId} has a non-counterbalanced arm order.`);
		}
	}
	if (registration.schedule.cooldownSeconds < 0) {
		throw new Error("Registration cooldownSeconds must be non-negative.");
	}
	if (registration.fingerprints.taskSet !== taskSetFingerprint()) {
		throw new Error("Registration task-set fingerprint does not match the fixed task set.");
	}
	if (registration.fingerprints.evaluatorSet !== evaluatorSetFingerprint(PILOT_TASKS)) {
		throw new Error("Registration evaluator-set fingerprint does not match controller profiles.");
	}
}

function commits(value: Record<string, unknown>): PilotRegistration["commits"] {
	assertExactKeys(value, ["producer", "consumer", "target"], "commits");
	return {
		producer: commit(value.producer, "commits.producer"),
		consumer: commit(value.consumer, "commits.consumer"),
		target: commit(value.target, "commits.target"),
	};
}

function fingerprints(value: Record<string, unknown>): PilotRegistration["fingerprints"] {
	assertExactKeys(
		value,
		["taskSet", "evaluatorSet", "route", "settings", "systemPrompt", "toolManifest"],
		"fingerprints",
	);
	return {
		taskSet: hash(value.taskSet, "fingerprints.taskSet"),
		evaluatorSet: hash(value.evaluatorSet, "fingerprints.evaluatorSet"),
		route: hash(value.route, "fingerprints.route"),
		settings: hash(value.settings, "fingerprints.settings"),
		systemPrompt: hash(value.systemPrompt, "fingerprints.systemPrompt"),
		toolManifest: hash(value.toolManifest, "fingerprints.toolManifest"),
	};
}

function schedule(value: Record<string, unknown>): PilotRegistration["schedule"] {
	assertExactKeys(
		value,
		["cooldownSeconds", "maxAttemptsPerTask", "maxPairAttempts", "pairs"],
		"schedule",
	);
	const pairs = value.pairs;
	if (!Array.isArray(pairs)) throw new Error("schedule.pairs must be an array.");
	return {
		cooldownSeconds: integer(value.cooldownSeconds, "schedule.cooldownSeconds"),
		maxAttemptsPerTask: literalInteger(
			value.maxAttemptsPerTask,
			"schedule.maxAttemptsPerTask",
			2,
		),
		maxPairAttempts: literalInteger(
			value.maxPairAttempts,
			"schedule.maxPairAttempts",
			14,
		),
		pairs: pairs.map((value, index) => {
			const pair = object(value, `schedule.pairs[${index}]`);
			assertExactKeys(pair, ["taskId", "order"], `schedule.pairs[${index}]`);
			if (!Array.isArray(pair.order) || pair.order.length !== 2) {
				throw new Error(`schedule.pairs[${index}].order must contain two arms.`);
			}
			const order = pair.order.map((arm) => text(arm, "schedule arm")) as string[];
			if (!isArm(order[0]) || !isArm(order[1]) || order[0] === order[1]) {
				throw new Error(`schedule.pairs[${index}].order is invalid.`);
			}
			return { taskId: text(pair.taskId, `schedule.pairs[${index}].taskId`), order: [order[0], order[1]] };
		}),
	};
}

function retention(value: Record<string, unknown>): PilotRegistration["retention"] {
	assertExactKeys(value, ["rawEvidenceDeleteAfter"], "retention");
	const rawEvidenceDeleteAfter = text(
		value.rawEvidenceDeleteAfter,
		"retention.rawEvidenceDeleteAfter",
	);
	if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(rawEvidenceDeleteAfter)) {
		throw new Error("retention.rawEvidenceDeleteAfter must be an ISO calendar date.");
	}
	const parsed = new Date(`${rawEvidenceDeleteAfter}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== rawEvidenceDeleteAfter) {
		throw new Error("retention.rawEvidenceDeleteAfter must be a real calendar date.");
	}
	return { rawEvidenceDeleteAfter };
}

function approvals(value: Record<string, unknown>): PilotRegistration["approvals"] {
	assertExactKeys(
		value,
		["nightworkersRolloutOwner", "vulnWorkbenchEvidenceReviewer"],
		"approvals",
	);
	return {
		nightworkersRolloutOwner: namedApproval(
			value.nightworkersRolloutOwner,
			"approvals.nightworkersRolloutOwner",
		),
		vulnWorkbenchEvidenceReviewer: namedApproval(
			value.vulnWorkbenchEvidenceReviewer,
			"approvals.vulnWorkbenchEvidenceReviewer",
		),
	};
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${name} must be a non-empty string.`);
	}
	return value;
}

function integer(value: unknown, name: string): number {
	if (!Number.isInteger(value) || (value as number) < 0) {
		throw new Error(`${name} must be a non-negative integer.`);
	}
	return value as number;
}

function literalInteger(value: unknown, name: string, expected: number) {
	const actual = integer(value, name);
	if (actual !== expected) throw new Error(`${name} must equal ${expected}.`);
	return expected;
}

function hash(value: unknown, name: string) {
	const result = text(value, name);
	if (!/^sha256:[a-f0-9]{64}$/.test(result)) {
		throw new Error(`${name} must be a sha256 fingerprint.`);
	}
	if (result === `sha256:${"0".repeat(64)}`) {
		throw new Error(`${name} must not use the zero placeholder fingerprint.`);
	}
	return result;
}

function namedApproval(value: unknown, name: string) {
	const result = text(value, name);
	if (/^(?:UNASSIGNED|UNSET(?:_.+)?)$/i.test(result)) {
		throw new Error(`${name} must name an assigned approver.`);
	}
	return result;
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], name: string) {
	const unexpected = Object.keys(value).filter((key) => !expected.includes(key));
	const missing = expected.filter((key) => !(key in value));
	if (unexpected.length > 0 || missing.length > 0) {
		throw new Error(`${name} has an invalid field set.`);
	}
}

function commit(value: unknown, name: string) {
	const result = text(value, name);
	if (!/^[a-f0-9]{40}$/.test(result)) {
		throw new Error(`${name} must be a full Git SHA.`);
	}
	return result;
}

function isArm(value: string | undefined): value is PilotArm {
	return value === "baseline" || value === "catalog";
}

function sha256(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
