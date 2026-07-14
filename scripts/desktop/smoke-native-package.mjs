import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const platform = process.argv[2];
if (!platform || !["linux", "windows"].includes(platform)) {
	throw new Error("Usage: node scripts/desktop/smoke-native-package.mjs <linux|windows>");
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bundleRoot = path.join(root, "src-tauri/target/release/bundle");
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightworkers-native-package-"));
let app;
try {
	const executable = installAndResolveExecutable(platform);
	app = spawn(executable, [], {
		cwd: path.dirname(executable),
		env: { ...process.env, NIGHTWORKERS_RUNTIME_DIR: runtimeRoot },
		stdio: "ignore",
	});
	const port = await waitForReady(app);
	await expectStatus(`http://127.0.0.1:${port}/api/health/ready`);
	await expectStatus(`http://127.0.0.1:${port}/api/overview`);
	console.log(`[desktop] ${platform} native package smoke passed at http://127.0.0.1:${port}`);
} finally {
	if (app && app.exitCode === null) app.kill("SIGTERM");
	if (app) await new Promise((resolve) => app.once("exit", resolve));
	if (platform === "windows") uninstallWindowsPackage();
	fs.rmSync(runtimeRoot, { recursive: true, force: true });
}

function installAndResolveExecutable(kind) {
	if (kind === "linux") {
		const appImage = findFile(bundleRoot, (file) => file.endsWith(".AppImage"));
		if (!appImage) throw new Error("Linux AppImage artifact was not found");
		fs.chmodSync(appImage, 0o755);
		return appImage;
	}
	const installer = findFile(bundleRoot, (file) => file.endsWith(".exe"));
	if (!installer) throw new Error("Windows NSIS installer was not found");
	const result = spawnSync(installer, ["/S"], { stdio: "inherit", windowsHide: true });
	if (result.status !== 0) throw new Error(`Windows installer failed with ${result.status}`);
	const installRoot = path.join(process.env.LOCALAPPDATA || "", "NightWorkers");
	const executable = findFile(installRoot, (file) => file.endsWith(".exe") && !file.toLowerCase().includes("uninstall"));
	if (!executable) throw new Error(`Installed Windows executable was not found under ${installRoot}`);
	return executable;
}

function uninstallWindowsPackage() {
	const installRoot = path.join(process.env.LOCALAPPDATA || "", "NightWorkers");
	const uninstaller = findFile(installRoot, (file) => file.toLowerCase().includes("uninstall") && file.endsWith(".exe"));
	if (uninstaller) spawnSync(uninstaller, ["/S"], { stdio: "inherit", windowsHide: true });
}

function findFile(target, predicate) {
	if (!target || !fs.existsSync(target)) return null;
	const stat = fs.statSync(target);
	if (stat.isFile()) return predicate(target) ? target : null;
	for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
		const found = findFile(path.join(target, entry.name), predicate);
		if (found) return found;
	}
	return null;
}

async function waitForReady(child) {
	const logPath = path.join(runtimeRoot, "logs", "desktop.log");
	const started = Date.now();
	while (Date.now() - started < 45_000) {
		if (child.exitCode !== null) throw new Error(`Packaged app exited with ${child.exitCode}`);
		const content = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
		const match = content.match(/sidecar ready: http:\/\/127\.0\.0\.1:(\d+)/);
		if (match) return Number(match[1]);
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out waiting for native package readiness; log=${readTail(logPath)}`);
}

function expectStatus(url) {
	return new Promise((resolve, reject) => {
		const request = http.get(url, (response) => {
			response.resume();
			if (response.statusCode === 200) resolve();
			else reject(new Error(`${url} returned ${response.statusCode}`));
		});
		request.setTimeout(5_000, () => request.destroy(new Error(`${url} timed out`)));
		request.on("error", reject);
	});
}

function readTail(filePath) {
	if (!fs.existsSync(filePath)) return "<missing>";
	return fs.readFileSync(filePath, "utf8").split("\n").slice(-30).join("\\n");
}
