import path from "node:path";
import { fileURLToPath } from "node:url";
import { createArtifactManifest, verifyReleaseMetadata } from "./release-metadata.mjs";

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

export async function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	if (!args.artifact || !args.attestation) {
		throw new Error(
			"Usage: bun run release:manifest -- --artifact <path> --attestation <path> [--output <path>]",
		);
	}
	const result = await createArtifactManifest({
		artifactPath: args.artifact,
		attestationPath: args.attestation,
		outputPath: args.output,
		signing: args.signing,
		notarization: args.notarization,
	});
	const verified = await verifyReleaseMetadata({
		manifestPath: path.relative(verifiedRoot(), result.outputPath),
	});
	if (verified.errors.length > 0) throw new Error(verified.errors.join("\n"));
	console.log(`[release] artifact manifest: ${result.outputPath}`);
}

function verifiedRoot() {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
