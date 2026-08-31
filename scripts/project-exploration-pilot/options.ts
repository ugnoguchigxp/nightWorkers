import path from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_PILOT_ID =
	"project-intelligence-foundation-2026-08-09-isolated-v2";
const DEFAULT_PAIR_TIMEOUT_SECONDS = 600;

export type PilotOptions = {
	pilotId: string;
	repositoryId: string;
	repositoryRoot: string;
	producerRoot: string;
	fromPair: number;
	pairCount: number;
	timeoutSeconds: number;
	thinkingDepth: "low" | "medium" | "high" | "very_high";
	cooldownSeconds: number;
	allowDirtyConsumer: boolean;
	allowLiveApi: boolean;
	dedicatedDatabase: boolean;
	formal: boolean;
	registration: string | null;
	evaluatorQualification: string | null;
	preflightCanary: boolean;
	canaryEvidence: string | null;
	preflightOnly: boolean;
	preflightEvidence: string | null;
	producerDatabase: string;
	resume: string | null;
	output: string | null;
};

export function parsePilotOptions(
	args: string[] = process.argv.slice(2),
	cwd = process.cwd(),
): PilotOptions {
	const parsed = parseArgs({
		args: args.filter((arg) => arg !== "--"),
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
			formal: { type: "boolean" },
			registration: { type: "string" },
			"evaluator-qualification": { type: "string" },
			"preflight-canary": { type: "boolean" },
			"canary-evidence": { type: "string" },
			preflight: { type: "boolean" },
			"preflight-evidence": { type: "string" },
			"producer-database": { type: "string" },
			resume: { type: "string" },
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
	if (!isThinkingDepth(thinkingDepth)) {
		throw new Error(`Unsupported thinking depth: ${thinkingDepth}`);
	}
	const cooldownSeconds = nonnegativeInteger(
		parsed.values["cooldown-seconds"] ?? "30",
	);
	const formal = parsed.values.formal ?? false;
	const registration = parsed.values.registration
		? requiredPathOption("--registration", parsed.values.registration, cwd)
		: null;
	const evaluatorQualification = parsed.values["evaluator-qualification"]
		? requiredPathOption(
				"--evaluator-qualification",
				parsed.values["evaluator-qualification"],
				cwd,
			)
		: null;
	const preflightCanary = parsed.values["preflight-canary"] ?? false;
	const canaryEvidence = parsed.values["canary-evidence"]
		? requiredPathOption(
				"--canary-evidence",
				parsed.values["canary-evidence"],
				cwd,
			)
		: null;
	const preflightOnly = parsed.values.preflight ?? false;
	const preflightEvidence = parsed.values["preflight-evidence"]
		? requiredPathOption(
				"--preflight-evidence",
				parsed.values["preflight-evidence"],
				cwd,
			)
		: null;
	const output = parsed.values.output
		? path.resolve(cwd, parsed.values.output)
		: null;
	if (formal && !registration) {
		throw new Error("--formal requires --registration.");
	}
	if (formal && !evaluatorQualification) {
		throw new Error("--formal requires --evaluator-qualification.");
	}
	if (formal && !canaryEvidence) {
		throw new Error("--formal requires --canary-evidence.");
	}
	if (formal && !preflightOnly && !preflightEvidence) {
		throw new Error("--formal requires --preflight-evidence after preflight succeeds.");
	}
	if (preflightOnly && !formal) {
		throw new Error("--preflight requires --formal controls.");
	}
	if (preflightOnly && preflightEvidence) {
		throw new Error("--preflight produces evidence; do not pass --preflight-evidence.");
	}
	if (formal && preflightCanary) {
		throw new Error("--formal cannot be combined with --preflight-canary.");
	}
	if (preflightCanary && canaryEvidence) {
		throw new Error("--preflight-canary produces evidence; do not pass --canary-evidence.");
	}
	if (preflightCanary && (fromPair !== 1 || pairCount !== 1)) {
		throw new Error("--preflight-canary requires --from-pair 1 and --pair-count 1.");
	}
	if (preflightCanary && !output) {
		throw new Error("--preflight-canary requires --output for its evidence artifact.");
	}
	if (formal && (parsed.values["allow-dirty-consumer"] || parsed.values["allow-live-api"])) {
		throw new Error("Formal pilot rejects dirty-consumer and live-api overrides.");
	}
	if (formal && !parsed.values["dedicated-database"]) {
		throw new Error("Formal pilot requires --dedicated-database.");
	}
	if (formal && !output) {
		throw new Error("Formal pilot requires --output for atomic checkpoints.");
	}
	return {
		pilotId: parsed.values["pilot-id"]?.trim() || DEFAULT_PILOT_ID,
		repositoryId: parsed.values["repository-id"] ?? "",
		repositoryRoot: requiredPathOption(
			"--repository-root",
			parsed.values["repository-root"],
			cwd,
		),
		producerRoot: requiredPathOption(
			"--producer-root",
			parsed.values["producer-root"],
			cwd,
		),
		fromPair,
		pairCount,
		timeoutSeconds,
		thinkingDepth,
		cooldownSeconds,
		allowDirtyConsumer: parsed.values["allow-dirty-consumer"] ?? false,
		allowLiveApi: parsed.values["allow-live-api"] ?? false,
		dedicatedDatabase: parsed.values["dedicated-database"] ?? false,
		formal,
		registration,
		evaluatorQualification,
		preflightCanary,
		canaryEvidence,
		preflightOnly,
		preflightEvidence,
		producerDatabase: requiredPathOption(
			"--producer-database",
			parsed.values["producer-database"],
			cwd,
		),
		resume: parsed.values.resume
			? requiredPathOption("--resume", parsed.values.resume, cwd)
			: null,
		output,
	};
}

function requiredPathOption(
	name: string,
	value: string | undefined,
	cwd: string,
) {
	if (!value?.trim()) throw new Error(`${name} is required`);
	return path.resolve(cwd, value);
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

function isThinkingDepth(
	value: string,
): value is PilotOptions["thinkingDepth"] {
	return ["low", "medium", "high", "very_high"].includes(value);
}
