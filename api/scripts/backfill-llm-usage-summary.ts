import { ensureNightWorkersSchema } from "../db/bootstrap";
import { rebuildLlmUsageSummary } from "../services/llm-usage/summary";

type Args = {
	since: Date | null;
	repositoryId: string | null;
	dryRun: boolean;
	reset: boolean;
};

function parseArgs(argv: string[]): Args {
	const args: Args = {
		since: null,
		repositoryId: null,
		dryRun: false,
		reset: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--dry-run") {
			args.dryRun = true;
			continue;
		}
		if (arg === "--reset") {
			args.reset = true;
			continue;
		}
		if (arg === "--since") {
			args.since = parseDateArg("--since", argv[index + 1]);
			index += 1;
			continue;
		}
		if (arg.startsWith("--since=")) {
			args.since = parseDateArg("--since", arg.slice("--since=".length));
			continue;
		}
		if (arg === "--repository-id") {
			args.repositoryId = requireValue("--repository-id", argv[index + 1]);
			index += 1;
			continue;
		}
		if (arg.startsWith("--repository-id=")) {
			args.repositoryId = requireValue(
				"--repository-id",
				arg.slice("--repository-id=".length),
			);
			continue;
		}
		if (arg === "--help" || arg === "-h") printHelpAndExit();
		throw new Error(`Unknown argument: ${arg}`);
	}
	return args;
}

function parseDateArg(flag: string, value: string | undefined) {
	const raw = requireValue(flag, value);
	const date = new Date(raw);
	if (Number.isNaN(date.getTime()))
		throw new Error(`${flag} must be an ISO date`);
	return date;
}

function requireValue(flag: string, value: string | undefined) {
	if (!value?.trim()) throw new Error(`${flag} requires a value`);
	return value.trim();
}

function printHelpAndExit() {
	console.log(`
Backfill LLM usage summary tables.

Usage:
  bun api/scripts/backfill-llm-usage-summary.ts [--dry-run] [--reset] [--since <iso>] [--repository-id <id>]
`);
	process.exit(0);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	await ensureNightWorkersSchema();
	const result = await rebuildLlmUsageSummary(args);
	console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
