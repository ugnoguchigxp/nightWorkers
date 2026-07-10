import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectReleaseMetadata } from "./release-metadata.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function executeRelease(options = {}) {
	const run = options.run ?? ((command, args) => spawnSync(command, args, { cwd: options.root ?? repoRoot, stdio: "inherit" }));
	const verify = run("bun", ["run", "verify:release"]);
	if (verify.status !== 0) throw new Error("verify:release failed; tag was not created");
	if (!options.execute) return { tagged: false };
	const tagged = run("git", ["tag", "-a", options.tag, "-m", `NightWorkers ${options.tag}`]);
	if (tagged.status !== 0) throw new Error(`Failed to create Git tag ${options.tag}`);
	return { tagged: true };
}

export async function main(argv = process.argv.slice(2)) {
	const metadata = await collectReleaseMetadata();
	const execute = argv.includes("--execute");
	const tagIndex = argv.indexOf("--tag");
	const tag = tagIndex >= 0 ? argv[tagIndex + 1] : metadata.expectedTag;
	if (tag !== metadata.expectedTag) throw new Error(`Expected tag ${metadata.expectedTag}, received ${tag}`);
	const result = executeRelease({ execute, tag });
	console.log(
		result.tagged
			? `[release] created ${tag}; push it only after reviewing the generated artifact manifest`
			: `[release] dry run passed for ${tag}; add --execute to create the annotated tag`,
	);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
