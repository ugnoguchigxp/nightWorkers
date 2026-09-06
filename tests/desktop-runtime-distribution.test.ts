import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installNodeRuntime } from "../scripts/desktop/install-node-runtime.mjs";
import { desktopSidecarTargets } from "../scripts/desktop/platform-targets.mjs";
import { stopSmokeProcess } from "../scripts/desktop/stop-smoke-process.mjs";
import { verifyTargetManifest } from "../scripts/desktop/verify-target-manifest.mjs";

const temporaryRoots: string[] = [];
function temporaryRoot() {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "nightworkers-distribution-"),
	);
	temporaryRoots.push(root);
	return root;
}
function writeFile(root: string, file: string, content = "fixture") {
	const destination = path.join(root, file);
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	fs.writeFileSync(destination, content);
}
afterEach(() => {
	for (const root of temporaryRoots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

describe("desktop runtime distribution", () => {
	it.each([
		"darwin",
		"linux",
	])("extracts the official %s archive layout and repairs an incomplete cache", async (platform) => {
		const root = temporaryRoot();
		const archiveRoot = `node-v20.19.5-${platform}-arm64`;
		writeFile(root, `${archiveRoot}/bin/node`, "node fixture");
		writeFile(root, `${archiveRoot}/LICENSE`);
		const archivePath = path.join(root, `${archiveRoot}.tar.gz`);
		execFileSync("tar", ["-czf", archivePath, "-C", root, archiveRoot]);
		const archive = fs.readFileSync(archivePath);
		const checksum = crypto.createHash("sha256").update(archive).digest("hex");
		const cacheRoot = path.join(root, "cache");
		let downloads = 0;
		const options = {
			platform,
			arch: "arm64",
			version: "20.19.5",
			cacheRoot,
			fetchArchive: async (url: string) => {
				downloads++;
				return url.endsWith("SHASUMS256.txt")
					? Buffer.from(`${checksum}  ${archiveRoot}.tar.gz\n`)
					: archive;
			},
		};
		const installed = await installNodeRuntime(options);
		expect(installed.nodePath).toBe(path.join(cacheRoot, "runtime/bin/node"));
		expect(fs.readFileSync(installed.nodePath, "utf8")).toBe("node fixture");
		await installNodeRuntime(options);
		expect(downloads).toBe(2);
		fs.unlinkSync(path.join(cacheRoot, "runtime/LICENSE"));
		await installNodeRuntime(options);
		expect(downloads).toBe(4);
		expect(fs.existsSync(path.join(cacheRoot, "runtime/LICENSE"))).toBe(true);
	});

	it("resolves the Windows root executable without using the Unix bin layout", async () => {
		const cacheRoot = temporaryRoot();
		writeFile(cacheRoot, "runtime/node.exe");
		writeFile(cacheRoot, "runtime/LICENSE");
		const installed = await installNodeRuntime({
			platform: "win32",
			arch: "x64",
			cacheRoot,
			fetchArchive: async () => {
				throw new Error("Complete cache must not download");
			},
		});
		expect(installed.nodePath).toBe(path.join(cacheRoot, "runtime/node.exe"));
	});

	it("rejects an archive before extraction when its checksum differs", async () => {
		const cacheRoot = temporaryRoot();
		await expect(
			installNodeRuntime({
				platform: "linux",
				arch: "x64",
				version: "20.19.5",
				cacheRoot,
				fetchArchive: async (url: string) =>
					Buffer.from(
						url.endsWith("SHASUMS256.txt")
							? `${"0".repeat(64)}  node-v20.19.5-linux-x64.tar.gz`
							: "corrupted archive",
					),
			}),
		).rejects.toThrow("checksum mismatch");
		expect(fs.existsSync(path.join(cacheRoot, "runtime"))).toBe(false);
	});

	it.each(
		Object.entries(desktopSidecarTargets),
	)("verifies staged files and binary integrity for %s", (targetKey, target) => {
		const root = temporaryRoot();
		const [platform, arch] = targetKey.split(":");
		const nodePath = `node/bin/${target.nodeExecutable}`;
		const files = [
			nodePath,
			"node/LICENSE",
			"dist-api-desktop/index.js",
			"dist/index.html",
			"build/Release/better_sqlite3.node",
			...[target.libsqlPackage, target.codexPackage].map(
				(name) => `node_modules/${name}/package.json`,
			),
		];
		for (const file of files) writeFile(root, file);
		const manifest = {
			target: targetKey,
			platform,
			arch,
			nodeExecutable: target.nodeExecutable,
			entry: "dist-api-desktop/index.js",
			copiedPackages: [target.libsqlPackage, target.codexPackage],
			runtime: {
				source: "pinned-runtime",
				target: `${platform}-${arch}`,
				version: "20.19.5",
				sha256: crypto.createHash("sha256").update("fixture").digest("hex"),
			},
		};
		writeFile(root, "manifest.json", JSON.stringify(manifest));
		expect(
			verifyTargetManifest(root, targetKey, {
				release: true,
				expectedVersion: "20.19.5",
			}),
		).toEqual(manifest);
		writeFile(root, nodePath, "tampered");
		expect(() => verifyTargetManifest(root, targetKey)).toThrow(
			"SHA-256 mismatch",
		);
		writeFile(root, nodePath);
		fs.unlinkSync(path.join(root, "node/LICENSE"));
		expect(() => verifyTargetManifest(root, targetKey)).toThrow("node/LICENSE");
	});

	it("bounds shutdown even when a sidecar ignores SIGTERM, including repeated cleanup", async () => {
		const child = spawn(
			process.execPath,
			[
				"-e",
				'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)',
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		try {
			await once(child.stdout, "data");
			await stopSmokeProcess(child, { graceMs: 50, killMs: 2_000 });
			expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
			await stopSmokeProcess(child, { graceMs: 50, killMs: 50 });
		} finally {
			child.kill("SIGKILL");
		}
	});
});
