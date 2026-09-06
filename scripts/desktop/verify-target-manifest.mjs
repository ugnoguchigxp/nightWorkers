import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desktopSidecarTargets } from "./platform-targets.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
export function verifyTargetManifest(
	stagedRoot,
	expectedTarget,
	{
		release = process.env.NIGHTWORKERS_RELEASE === "1",
		expectedVersion = process.env.NIGHTWORKERS_NODE_RUNTIME_VERSION,
	} = {},
) {
	const manifestPath = path.join(stagedRoot, "manifest.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	expectedTarget ||= manifest.target;
	if (!expectedTarget || !desktopSidecarTargets[expectedTarget]) {
		throw new Error(
			`Expected a supported target argument, received: ${expectedTarget || "<empty>"}`,
		);
	}
	const target = desktopSidecarTargets[expectedTarget];
	const missingPackages = [target.libsqlPackage, target.codexPackage].filter(
		(packageName) => !manifest.copiedPackages?.includes(packageName),
	);
	if (manifest.target !== expectedTarget) {
		throw new Error(
			`Desktop target mismatch: expected=${expectedTarget} actual=${manifest.target}`,
		);
	}
	if (manifest.nodeExecutable !== target.nodeExecutable) {
		throw new Error(
			`Desktop executable mismatch: expected=${target.nodeExecutable} actual=${manifest.nodeExecutable}`,
		);
	}
	if (missingPackages.length > 0) {
		throw new Error(
			`Desktop manifest is missing native packages: ${missingPackages.join(", ")}`,
		);
	}
	if (release && manifest.runtime?.source !== "pinned-runtime") {
		throw new Error("Release sidecar must use a pinned Node runtime");
	}
	if (expectedVersion && manifest.runtime?.version !== expectedVersion) {
		throw new Error(
			`Desktop runtime version mismatch: expected=${expectedVersion} actual=${manifest.runtime?.version || "<missing>"}`,
		);
	}
	if (
		!manifest.runtime?.sha256 ||
		!/^[a-f0-9]{64}$/.test(manifest.runtime.sha256)
	) {
		throw new Error("Desktop manifest is missing the Node runtime SHA-256");
	}
	const [platform, arch] = expectedTarget.split(":");
	if (
		manifest.platform !== platform ||
		manifest.arch !== arch ||
		manifest.runtime.target !== `${platform}-${arch}`
	) {
		throw new Error("Desktop manifest platform/architecture mismatch");
	}
	const nodePath = path.join(stagedRoot, "node/bin", target.nodeExecutable);
	const actualHash = crypto
		.createHash("sha256")
		.update(fs.readFileSync(nodePath))
		.digest("hex");
	if (actualHash !== manifest.runtime.sha256)
		throw new Error("Staged Node runtime SHA-256 mismatch");
	if (manifest.entry !== "dist-api-desktop/index.js")
		throw new Error("Desktop manifest entry mismatch");
	const required = [
		manifest.entry,
		"dist/index.html",
		"build/Release/better_sqlite3.node",
		...[target.libsqlPackage, target.codexPackage].map(
			(name) => `node_modules/${name}/package.json`,
		),
		...(manifest.runtime.source === "pinned-runtime" ? ["node/LICENSE"] : []),
	];
	for (const relative of required) {
		if (
			!fs
				.statSync(path.join(stagedRoot, relative), { throwIfNoEntry: false })
				?.isFile()
		) {
			throw new Error(`Staged desktop file is missing: ${relative}`);
		}
	}
	return manifest;
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const manifest = verifyTargetManifest(
		path.join(repoRoot, "scripts/desktop/staged"),
		process.argv[2],
	);
	console.log(`Desktop target manifest verified: ${manifest.target}`);
}
