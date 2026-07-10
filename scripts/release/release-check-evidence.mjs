import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fullShaPattern = /^[a-f0-9]{40}$/;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function commandVersion(root, command, args) {
	const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
	return result.status === 0
		? String(result.stdout || result.stderr || "").trim() || null
		: null;
}

async function collectToolVersions(root) {
	const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
	return {
		node: process.version,
		bun: commandVersion(root, "bun", ["--version"]),
		rustc: commandVersion(root, "rustc", ["--version"]),
		cargo: commandVersion(root, "cargo", ["--version"]),
		tauriCli: packageJson.devDependencies?.["@tauri-apps/cli"] ?? null,
	};
}

export async function createReleaseCheckEvidence(options) {
	const env = options.env ?? process.env;
	const commitSha = options.commitSha ?? env.GITHUB_SHA;
	const workflowRunId = options.workflowRunId ?? env.GITHUB_RUN_ID;
	const workflowRunAttempt = Number(
		options.workflowRunAttempt ?? env.GITHUB_RUN_ATTEMPT,
	);
	const root = options.root ?? repoRoot;
	if (!options.id?.trim()) throw new Error("Release check evidence requires an id");
	if (!fullShaPattern.test(String(commitSha ?? ""))) {
		throw new Error("Release check evidence requires a full GITHUB_SHA");
	}
	if (!workflowRunId || !Number.isInteger(workflowRunAttempt)) {
		throw new Error("Release check evidence requires workflow run id and attempt");
	}

	const evidence = {
		schemaVersion: "nightworkers.release-check/v1",
		id: options.id,
		jobId: options.jobId ?? env.GITHUB_JOB ?? options.id,
		commitSha,
		conclusion: "success",
		runnerOs: options.runnerOs ?? env.RUNNER_OS ?? process.platform,
		runnerArch: options.runnerArch ?? env.RUNNER_ARCH ?? process.arch,
		workflowRunId: String(workflowRunId),
		workflowRunAttempt,
		toolVersions: options.toolVersions ?? (await collectToolVersions(root)),
		createdAt: (options.now ?? new Date()).toISOString(),
	};
	const outputPath = path.resolve(options.outputPath);
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
	return { evidence, outputPath };
}

function parseArgs(argv) {
	const values = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("--")) continue;
		values[arg.slice(2)] = argv[index + 1];
		index += 1;
	}
	return values;
}

async function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	if (!args.id || !args.output) {
		throw new Error(
			"Usage: node scripts/release/release-check-evidence.mjs --id <check-id> --output <path>",
		);
	}
	const result = await createReleaseCheckEvidence({
		id: args.id,
		outputPath: args.output,
	});
	console.log(`[release] check evidence: ${result.outputPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
