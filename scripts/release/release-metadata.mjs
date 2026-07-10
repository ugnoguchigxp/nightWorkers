import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const releaseHeadings = ["Added", "Changed", "Fixed", "Removed"];
const noteHeadings = [
	"Migration",
	"Rollback",
	"Known Limitations",
	"Desktop Support Matrix",
];

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionBody(markdown, heading) {
	const escaped = escapeRegExp(heading);
	const match = markdown.match(
		new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"),
	);
	return match?.[1]?.trim() ?? null;
}

function hasSubheading(body, heading) {
	const escaped = escapeRegExp(heading);
	const match = body.match(
		new RegExp(`^### ${escaped}\\s*$([\\s\\S]*?)(?=^### |(?![\\s\\S]))`, "m"),
	);
	return Boolean(match?.[1]?.trim());
}

export async function collectReleaseMetadata(options = {}) {
	const root = options.root ?? repoRoot;
	const packageJson = await readJson(path.join(root, "package.json"));
	const tauriConfig = await readJson(path.join(root, "src-tauri/tauri.conf.json"));
	const version = packageJson.version;
	const expectedTag = `v${version}`;
	const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
	const releaseNotesPath = path.join(root, "spec/release-notes", `${version}.md`);
	const releaseNotes = await readFile(releaseNotesPath, "utf8");

	return {
		root,
		version,
		expectedTag,
		packageJson,
		tauriConfig,
		changelog,
		releaseNotes,
		releaseNotesPath,
	};
}

export async function verifyReleaseMetadata(options = {}) {
	const metadata = await collectReleaseMetadata(options);
	const errors = [];

	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version)) {
		errors.push(`package.json version is not SemVer: ${metadata.version}`);
	}
	if (metadata.tauriConfig.version !== metadata.version) {
		errors.push(
			`src-tauri/tauri.conf.json version ${metadata.tauriConfig.version} does not match package.json ${metadata.version}`,
		);
	}

	const releaseSectionMatch = metadata.changelog.match(
		new RegExp(
			`^## \\[${escapeRegExp(metadata.version)}\\] - (\\d{4}-\\d{2}-\\d{2})\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`,
			"m",
		),
	);
	if (!releaseSectionMatch) {
		errors.push(`CHANGELOG.md is missing a dated [${metadata.version}] section`);
	} else {
		for (const heading of releaseHeadings) {
			if (!hasSubheading(releaseSectionMatch[2], heading)) {
				errors.push(`CHANGELOG.md [${metadata.version}] is missing ### ${heading}`);
			}
		}
	}

	for (const heading of noteHeadings) {
		const body = sectionBody(metadata.releaseNotes, heading);
		if (!body) errors.push(`${path.relative(metadata.root, metadata.releaseNotesPath)} is missing ## ${heading}`);
	}

	if (options.tag && options.tag !== metadata.expectedTag) {
		errors.push(`Git tag ${options.tag} does not match ${metadata.expectedTag}`);
	}

	if (options.manifestPath) {
		const manifestPath = path.resolve(metadata.root, options.manifestPath);
		const manifest = await readJson(manifestPath);
		if (manifest.schemaVersion !== "nightworkers.release-artifacts/v1") {
			errors.push(`unsupported artifact manifest schema: ${manifest.schemaVersion}`);
		}
		if (manifest.version !== metadata.version) {
			errors.push(`artifact manifest version ${manifest.version} does not match ${metadata.version}`);
		}
		if (manifest.tag !== metadata.expectedTag) {
			errors.push(`artifact manifest tag ${manifest.tag} does not match ${metadata.expectedTag}`);
		}
		if (manifest.verification?.status !== "passed") {
			errors.push("artifact manifest must record a passed verify:release result");
		}
		if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
			errors.push("artifact manifest must contain at least one artifact");
		} else {
			for (const artifact of manifest.artifacts) {
				const filename = String(artifact.filename ?? "");
				if (path.basename(filename) !== filename) {
					errors.push(`artifact filename must not contain a path: ${filename}`);
					continue;
				}
				if (!filename.includes(metadata.version)) {
					errors.push(`artifact filename must include ${metadata.version}: ${artifact.filename}`);
				}
				if (!/^[a-f0-9]{64}$/.test(String(artifact.sha256 ?? ""))) {
					errors.push(`artifact sha256 is invalid: ${filename}`);
				}
				for (const field of ["signing", "notarization"]) {
					if (!["verified", "not_requested"].includes(artifact[field])) {
						errors.push(`artifact ${field} status is not releasable: ${artifact[field]}`);
					}
				}
				const artifactPath = path.join(path.dirname(manifestPath), filename);
				try {
					const bytes = await readFile(artifactPath);
					if (artifact.size !== bytes.byteLength) {
						errors.push(`artifact size does not match file: ${filename}`);
					}
					if (artifact.sha256 !== sha256(bytes)) {
						errors.push(`artifact sha256 does not match file: ${filename}`);
					}
				} catch {
					errors.push(`artifact file is missing beside manifest: ${filename}`);
				}
			}
		}
	}

	return { ...metadata, errors };
}

export async function createArtifactManifest(options) {
	const metadata = await collectReleaseMetadata({ root: options.root });
	const artifactPath = path.resolve(metadata.root, options.artifactPath);
	const filename = path.basename(artifactPath);
	if (!filename.includes(metadata.version)) {
		throw new Error(`Artifact filename must include ${metadata.version}: ${filename}`);
	}
	const bytes = await readFile(artifactPath);
	const outputPath = path.resolve(
		metadata.root,
		options.outputPath ?? `release-artifacts-${metadata.version}.json`,
	);
	if (outputPath === artifactPath) {
		throw new Error("Artifact manifest output must not overwrite the artifact");
	}
	if (path.dirname(outputPath) !== path.dirname(artifactPath)) {
		throw new Error("Artifact manifest must be written beside the artifact");
	}
	const manifest = {
		schemaVersion: "nightworkers.release-artifacts/v1",
		version: metadata.version,
		tag: metadata.expectedTag,
		generatedAt: new Date().toISOString(),
		verification: {
			command: "bun run verify:release",
			status: options.verificationStatus ?? "not_recorded",
		},
		artifacts: [
			{
				filename,
				sha256: sha256(bytes),
				size: bytes.byteLength,
				signing: options.signing ?? "not_requested",
				notarization: options.notarization ?? "not_requested",
			},
		],
	};
	await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	return { manifest, outputPath };
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

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const result = await verifyReleaseMetadata({
		tag: args.tag ?? process.env.RELEASE_TAG,
		manifestPath: args.manifest,
	});
	if (result.errors.length > 0) {
		for (const error of result.errors) console.error(`[release] ${error}`);
		process.exit(1);
	}
	console.log(`[release] metadata ok: ${result.expectedTag}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
