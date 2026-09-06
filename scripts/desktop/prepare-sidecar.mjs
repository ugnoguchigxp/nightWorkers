import fs from "node:fs";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDesktopSidecarTarget } from "./platform-targets.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const stagedRoot = path.join(repoRoot, "scripts/desktop/staged");
const require = createRequire(import.meta.url);
const copiedPackages = [];
const sidecarTarget = getDesktopSidecarTarget();

function copyRequired(source, destination) {
	if (!fs.existsSync(source)) {
		throw new Error(`Required desktop sidecar source missing: ${source}`);
	}
	fs.rmSync(destination, { recursive: true, force: true });
	fs.cpSync(source, destination, { recursive: true, dereference: false });
}

function copyPackage(packageName) {
	const packageJson = resolvePackageJson(packageName);
	const source = path.dirname(packageJson);
	const destination = path.join(
		stagedRoot,
		"node_modules",
		...packageName.split("/"),
	);
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	fs.rmSync(destination, { recursive: true, force: true });
	fs.cpSync(source, destination, { recursive: true, dereference: true });
	copiedPackages.push(packageName);
}

function requireResolve(specifier) {
	return require.resolve(specifier, {
		paths: [
			path.join(repoRoot, "node_modules"),
			path.join(repoRoot, "node_modules/.pnpm/node_modules"),
		],
	});
}

function resolvePackageJson(packageName) {
	try {
		return requireResolve(`${packageName}/package.json`);
	} catch (error) {
		if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
			throw error;
		}
	}

	const resolvedEntry = fileURLToPath(import.meta.resolve(packageName));
	let current = path.dirname(resolvedEntry);
	while (current !== path.dirname(current)) {
		const candidate = path.join(current, "package.json");
		if (fs.existsSync(candidate)) return candidate;
		current = path.dirname(current);
	}
	throw new Error(`Unable to resolve package root for ${packageName}`);
}

fs.rmSync(stagedRoot, { recursive: true, force: true });
fs.mkdirSync(stagedRoot, { recursive: true });

copyRequired(
	path.join(repoRoot, "dist-api-desktop"),
	path.join(stagedRoot, "dist-api-desktop"),
);
copyRequired(path.join(repoRoot, "dist"), path.join(stagedRoot, "dist"));

fs.copyFileSync(
	path.join(repoRoot, "package.json"),
	path.join(stagedRoot, "package.json"),
);
copyPackage(sidecarTarget.libsqlPackage);
copyPackage("better-sqlite3");
const betterSqliteBinding = path.join(
	path.dirname(resolvePackageJson("better-sqlite3")),
	"build/Release/better_sqlite3.node",
);
copyRequired(
	betterSqliteBinding,
	path.join(stagedRoot, "build/Release/better_sqlite3.node"),
);
copyPackage("@openai/codex-sdk");
copyPackage("@openai/codex");
copyPackage(sidecarTarget.codexPackage);

const nodeDestinationDir = path.join(stagedRoot, "node/bin");
fs.mkdirSync(nodeDestinationDir, { recursive: true });
const nodeSource =
	process.env.NIGHTWORKERS_NODE_RUNTIME_PATH || process.execPath;
if (
	!process.env.NIGHTWORKERS_NODE_RUNTIME_PATH &&
	process.env.NIGHTWORKERS_RELEASE === "1"
) {
	throw new Error(
		"NIGHTWORKERS_NODE_RUNTIME_PATH is required for release sidecar staging",
	);
}
const runtimeInfo = JSON.parse(
	execFileSync(
		nodeSource,
		[
			"-p",
			"JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})",
		],
		{ encoding: "utf8", timeout: 10_000 },
	),
);
if (
	runtimeInfo.platform !== process.platform ||
	runtimeInfo.arch !== process.arch
) {
	throw new Error(
		`Node runtime target mismatch: ${runtimeInfo.platform}/${runtimeInfo.arch}`,
	);
}
if (
	process.env.NIGHTWORKERS_NODE_RUNTIME_VERSION &&
	runtimeInfo.version !== process.env.NIGHTWORKERS_NODE_RUNTIME_VERSION
) {
	throw new Error(
		`Node runtime version mismatch: expected=${process.env.NIGHTWORKERS_NODE_RUNTIME_VERSION} actual=${runtimeInfo.version}`,
	);
}
const nodeDestination = path.join(
	nodeDestinationDir,
	sidecarTarget.nodeExecutable,
);
fs.copyFileSync(nodeSource, nodeDestination);
const runtimeLicense = process.env.NIGHTWORKERS_NODE_RUNTIME_PATH
	? path.join(
			path.dirname(process.env.NIGHTWORKERS_NODE_RUNTIME_PATH),
			process.platform === "win32" ? "." : "..",
			"LICENSE",
		)
	: null;
if (runtimeLicense && !fs.existsSync(runtimeLicense))
	throw new Error(`Node runtime license is missing: ${runtimeLicense}`);
if (runtimeLicense) {
	fs.copyFileSync(
		runtimeLicense,
		path.join(nodeDestinationDir, "..", "LICENSE"),
	);
}
if (process.platform !== "win32") {
	fs.chmodSync(nodeDestination, 0o755);
}

const metadata = {
	createdAt: new Date().toISOString(),
	node: process.version,
	platform: process.platform,
	arch: process.arch,
	target: sidecarTarget.targetKey,
	nodeExecutable: sidecarTarget.nodeExecutable,
	entry: "dist-api-desktop/index.js",
	copiedPackages,
	runtime: {
		source: process.env.NIGHTWORKERS_NODE_RUNTIME_PATH
			? "pinned-runtime"
			: "development-host-runtime",
		version: runtimeInfo.version,
		target: `${process.platform}-${process.arch}`,
		sha256: crypto
			.createHash("sha256")
			.update(fs.readFileSync(nodeDestination))
			.digest("hex"),
	},
};
fs.writeFileSync(
	path.join(stagedRoot, "manifest.json"),
	`${JSON.stringify(metadata, null, 2)}\n`,
);
fs.writeFileSync(path.join(stagedRoot, ".gitkeep"), "");

console.log(`Prepared desktop sidecar staging at ${stagedRoot}`);
