import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fullShaPattern = /^[a-f0-9]{40}$/;

export const requiredReleaseCheckIds = [
	"base",
	"audit",
	"e2e",
	"accessibility",
	"desktop-check",
	"desktop-macos",
	"desktop-linux",
	"desktop-windows",
	"package",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

function resolveHead(root) {
	const result = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	});
	return result.status === 0 ? result.stdout.trim() : null;
}

async function loadReleaseIdentity(root) {
	const packageJson = await readJson(path.join(root, "package.json"));
	return { version: packageJson.version, tag: `v${packageJson.version}` };
}

async function loadCheckEvidence(checksDirectory) {
	const entries = await fs.readdir(checksDirectory, { withFileTypes: true });
	const evidence = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
		evidence.push({
			...(await readJson(path.join(checksDirectory, entry.name))),
			evidenceArtifact: entry.name,
		});
	}
	return evidence;
}

export function validateReleaseAttestation(options) {
	const { attestation, artifactBytes, artifactFilename } = options;
	const requiredCheckIds = options.requiredCheckIds ?? requiredReleaseCheckIds;
	const errors = [];
	if (attestation.schemaVersion !== "nightworkers.release-attestation/v1") {
		errors.push(`unsupported release attestation schema: ${attestation.schemaVersion}`);
	}
	if (!fullShaPattern.test(String(attestation.source?.commitSha ?? ""))) {
		errors.push("release attestation source commitSha must be a full SHA");
	}
	if (!attestation.source?.workflowRunId) {
		errors.push("release attestation source workflowRunId is missing");
	}
	if (!Number.isInteger(attestation.source?.workflowRunAttempt)) {
		errors.push("release attestation source workflowRunAttempt is invalid");
	}
	if (!attestation.source?.repository || !attestation.source?.workflowName) {
		errors.push("release attestation source identity is incomplete");
	}
	if (options.version && attestation.version !== options.version) {
		errors.push(`release attestation version ${attestation.version} does not match ${options.version}`);
	}
	if (options.tag && attestation.tag !== options.tag) {
		errors.push(`release attestation tag ${attestation.tag} does not match ${options.tag}`);
	}

	const checks = Array.isArray(attestation.checks) ? attestation.checks : [];
	const checkIds = checks.map((check) => check.id);
	for (const id of requiredCheckIds) {
		if (!checkIds.includes(id)) errors.push(`release attestation is missing required check: ${id}`);
	}
	for (const id of new Set(checkIds)) {
		if (checkIds.filter((candidate) => candidate === id).length > 1) {
			errors.push(`release attestation check is duplicated: ${id}`);
		}
		if (!requiredCheckIds.includes(id)) {
			errors.push(`release attestation contains unknown check: ${id}`);
		}
	}
	for (const check of checks) {
		if (!check.jobId || !check.runnerOs || !check.runnerArch || !check.evidenceArtifact) {
			errors.push(`release attestation check provenance is incomplete: ${check.id}`);
		}
		if (check.conclusion !== "success") {
			errors.push(`release attestation check did not succeed: ${check.id}`);
		}
		if (check.commitSha !== attestation.source?.commitSha) {
			errors.push(`release attestation check SHA mismatch: ${check.id}`);
		}
		if (String(check.workflowRunId) !== String(attestation.source?.workflowRunId)) {
			errors.push(`release attestation workflow run mismatch: ${check.id}`);
		}
		if (check.workflowRunAttempt !== attestation.source?.workflowRunAttempt) {
			errors.push(`release attestation workflow run attempt mismatch: ${check.id}`);
		}
		if (check.id === "package") {
			for (const tool of ["node", "bun", "rustc", "cargo", "tauriCli"]) {
				if (!check.toolVersions?.[tool]) {
					errors.push(`release package tool version is missing: ${tool}`);
				}
			}
		}
	}

	if (attestation.artifact?.filename !== artifactFilename) {
		errors.push(
			`release attestation artifact filename mismatch: ${attestation.artifact?.filename}`,
		);
	}
	if (attestation.artifact?.size !== artifactBytes.byteLength) {
		errors.push("release attestation artifact size does not match file");
	}
	if (attestation.artifact?.sha256 !== sha256(artifactBytes)) {
		errors.push("release attestation artifact sha256 does not match file");
	}
	if (attestation.artifact?.target !== "darwin:arm64") {
		errors.push(`release attestation artifact target is not releasable: ${attestation.artifact?.target}`);
	}
	if (
		attestation.verification?.command !== "bun run verify:release" ||
		attestation.verification?.status !== "passed"
	) {
		errors.push("release attestation verification is not passed");
	}
	return errors;
}

export async function createReleaseAttestation(options) {
	const root = options.root ?? repoRoot;
	const identity = await loadReleaseIdentity(root);
	const artifactPath = path.resolve(root, options.artifactPath);
	const artifactBytes = await fs.readFile(artifactPath);
	const checksDirectory = path.resolve(root, options.checksDirectory);
	const checkEvidence = await loadCheckEvidence(checksDirectory);
	const sourceSha = options.sourceSha ?? options.env?.GITHUB_SHA ?? process.env.GITHUB_SHA ?? resolveHead(root);
	const workflowRunId = String(
		options.workflowRunId ?? options.env?.GITHUB_RUN_ID ?? process.env.GITHUB_RUN_ID ?? "",
	);
	const workflowRunAttempt = Number(
		options.workflowRunAttempt ??
			options.env?.GITHUB_RUN_ATTEMPT ??
			process.env.GITHUB_RUN_ATTEMPT,
	);
	if (!fullShaPattern.test(String(sourceSha ?? ""))) {
		throw new Error("Release attestation requires a full source SHA");
	}
	if (!workflowRunId || !Number.isInteger(workflowRunAttempt)) {
		throw new Error("Release attestation requires workflow run id and attempt");
	}
	for (const check of checkEvidence) {
		if (check.schemaVersion !== "nightworkers.release-check/v1") {
			throw new Error(`Unsupported release check evidence schema: ${check.schemaVersion}`);
		}
	}

	const attestation = {
		schemaVersion: "nightworkers.release-attestation/v1",
		version: identity.version,
		tag: identity.tag,
		source: {
			repository:
				options.repository ??
				options.env?.GITHUB_REPOSITORY ??
				process.env.GITHUB_REPOSITORY ??
				"local/nightworkers",
			commitSha: sourceSha,
			workflowName:
				options.workflowName ??
				options.env?.GITHUB_WORKFLOW ??
				process.env.GITHUB_WORKFLOW ??
				"local",
			workflowRunId,
			workflowRunAttempt,
		},
		checks: checkEvidence.map((check) => ({
			id: check.id,
			jobId: check.jobId,
			commitSha: check.commitSha,
			conclusion: check.conclusion,
			runnerOs: check.runnerOs,
			runnerArch: check.runnerArch,
			workflowRunId: check.workflowRunId,
			workflowRunAttempt: check.workflowRunAttempt,
			toolVersions: check.toolVersions,
			evidenceArtifact: check.evidenceArtifact,
		})),
		artifact: {
			filename: path.basename(artifactPath),
			sha256: sha256(artifactBytes),
			size: artifactBytes.byteLength,
			target: options.target ?? "darwin:arm64",
		},
		verification: {
			command: "bun run verify:release",
			status: "passed",
		},
		generatedAt: (options.now ?? new Date()).toISOString(),
	};
	const errors = validateReleaseAttestation({
		attestation,
		artifactBytes,
		artifactFilename: path.basename(artifactPath),
		requiredCheckIds: options.requiredCheckIds,
		version: identity.version,
		tag: identity.tag,
	});
	if (errors.length > 0) throw new Error(errors.join("\n"));

	const outputPath = path.resolve(
		root,
		options.outputPath ?? `release-attestation-${identity.version}.json`,
	);
	await fs.writeFile(outputPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
	return { attestation, outputPath };
}

export async function verifyReleaseAttestation(options) {
	const root = options.root ?? repoRoot;
	const identity = await loadReleaseIdentity(root);
	const attestationPath = path.resolve(root, options.attestationPath);
	const artifactPath = path.resolve(root, options.artifactPath);
	const [attestation, artifactBytes] = await Promise.all([
		readJson(attestationPath),
		fs.readFile(artifactPath),
	]);
	return {
		attestation,
		errors: validateReleaseAttestation({
			attestation,
			artifactBytes,
			artifactFilename: path.basename(artifactPath),
			requiredCheckIds: options.requiredCheckIds,
			version: identity.version,
			tag: identity.tag,
		}),
	};
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
	if (!args.artifact || !args.checks) {
		throw new Error(
			"Usage: node scripts/release/release-attestation.mjs --artifact <path> --checks <directory> [--output <path>]",
		);
	}
	const result = await createReleaseAttestation({
		artifactPath: args.artifact,
		checksDirectory: args.checks,
		outputPath: args.output,
		target: args.target,
	});
	console.log(`[release] attestation: ${result.outputPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
