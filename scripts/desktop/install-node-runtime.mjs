import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDesktopSidecarTarget } from "./platform-targets.mjs";

export const PINNED_NODE_VERSION = process.env.NIGHTWORKERS_NODE_RUNTIME_VERSION || "20.19.5";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const target = getDesktopSidecarTarget();
const archiveName = archiveNameFor(process.platform, process.arch, PINNED_NODE_VERSION);
const baseUrl = `https://nodejs.org/dist/v${PINNED_NODE_VERSION}`;
const cacheRoot = process.env.NIGHTWORKERS_NODE_RUNTIME_CACHE
	? path.resolve(process.env.NIGHTWORKERS_NODE_RUNTIME_CACHE)
	: path.join(os.tmpdir(), "nightworkers-node-runtime", `${PINNED_NODE_VERSION}-${target.targetKey.replace(":", "-")}`);
const archivePath = path.join(cacheRoot, archiveName);
const extractedRoot = path.join(cacheRoot, "runtime");
const nodePath = path.join(extractedRoot, target.nodeExecutable);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}

export async function main() {
	fs.mkdirSync(cacheRoot, { recursive: true });
	if (!fs.existsSync(nodePath)) {
		const [archive, checksums] = await Promise.all([
			download(`${baseUrl}/${archiveName}`),
			download(`${baseUrl}/SHASUMS256.txt`),
		]);
		const expected = checksums
			.toString("utf8")
			.split("\n")
			.map((line) => line.trim().split(/\s+/))
			.find((parts) => parts[1] === archiveName)?.[0];
		if (!expected) throw new Error(`Node checksum is missing for ${archiveName}`);
		const actual = crypto.createHash("sha256").update(archive).digest("hex");
		if (actual !== expected) {
			throw new Error(`Node runtime checksum mismatch: expected=${expected} actual=${actual}`);
		}
		fs.writeFileSync(archivePath, archive);
		fs.rmSync(extractedRoot, { recursive: true, force: true });
		fs.mkdirSync(extractedRoot, { recursive: true });
		extract(archivePath, extractedRoot, archiveName.endsWith(".zip"));
		const extractedDirectory = path.join(extractedRoot, archiveName.replace(/\.(tar\.gz|zip)$/, ""));
		if (fs.existsSync(extractedDirectory)) {
			for (const entry of fs.readdirSync(extractedDirectory)) {
				fs.renameSync(path.join(extractedDirectory, entry), path.join(extractedRoot, entry));
			}
			fs.rmSync(extractedDirectory, { recursive: true, force: true });
		}
	}
	if (!fs.existsSync(nodePath)) throw new Error(`Extracted Node runtime is missing: ${nodePath}`);
	if (process.platform !== "win32") fs.chmodSync(nodePath, 0o755);
	const noticeSource = path.join(extractedRoot, "LICENSE");
	if (!fs.existsSync(noticeSource)) throw new Error(`Node runtime license is missing: ${noticeSource}`);
	const githubEnv = process.env.GITHUB_ENV;
	if (githubEnv) {
		fs.appendFileSync(githubEnv, `NIGHTWORKERS_NODE_RUNTIME_PATH=${nodePath}${os.EOL}`);
		fs.appendFileSync(githubEnv, `NIGHTWORKERS_NODE_RUNTIME_VERSION=${PINNED_NODE_VERSION}${os.EOL}`);
	}
	console.log(`Pinned Node runtime ready: ${nodePath}`);
	return { nodePath, version: PINNED_NODE_VERSION, target: target.targetKey };
}

function archiveNameFor(platform, arch, version) {
	const suffix = platform === "win32" ? "win-x64.zip" : `${platform === "darwin" ? "darwin" : "linux"}-${arch === "arm64" ? "arm64" : "x64"}.tar.gz`;
	return `node-v${version}-${suffix}`;
}

async function download(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Node runtime download failed (${response.status}): ${url}`);
	return Buffer.from(await response.arrayBuffer());
}

function extract(archivePath, destination, zip) {
	if (zip) {
		try {
			execFileSync("tar", ["-xf", archivePath, "-C", destination], { stdio: "inherit" });
			return;
		} catch {
			execFileSync("unzip", ["-q", archivePath, "-d", destination], { stdio: "inherit" });
			return;
		}
	}
	execFileSync("tar", ["-xzf", archivePath, "-C", destination], { stdio: "inherit" });
}
