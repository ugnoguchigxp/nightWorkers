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
		output: parsed.values.output
			? path.resolve(cwd, parsed.values.output)
			: null,
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
