import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reportPath = path.resolve(process.env.NIGHTWORKERS_BUNDLE_REPORT || path.join(root, "artifacts/bundle-budget.json"));
const stagedRoot = path.join(root, "scripts/desktop/staged");
const bundleRoot = path.join(root, "src-tauri/target/release/bundle");
const budgets = {
	stagedBytes: 600 * 1024 * 1024,
	appBytes: 650 * 1024 * 1024,
	compressedArtifactBytes: 400 * 1024 * 1024,
};

const report = {
	schemaVersion: "nightworkers.bundle-budget/v1",
	createdAt: new Date().toISOString(),
	budgets,
	components: {
		stagedSidecar: sizeIfPresent(stagedRoot),
		frontend: sizeIfPresent(path.join(stagedRoot, "dist")),
		backend: sizeIfPresent(path.join(stagedRoot, "dist-api-desktop")),
		nodeRuntime: sizeIfPresent(path.join(stagedRoot, "node")),
		nativeModules: sizeIfPresent(path.join(stagedRoot, "node_modules")),
	},
	artifacts: listBundleArtifacts(bundleRoot).filter((file) => /\.(app|dmg|msi|exe|deb|rpm|AppImage|zip|tar\.gz)$/i.test(file)).map((file) => ({
		path: path.relative(root, file),
		bytes: sizeIfPresent(file),
	})),
};
report.totalStagedBytes = report.components.stagedSidecar;
report.appBytes = report.artifacts.find((artifact) => artifact.path.endsWith(".app"))?.bytes ?? 0;
report.compressedArtifactBytes = report.artifacts
	.filter((artifact) => !artifact.path.endsWith(".app"))
	.reduce((total, artifact) => total + artifact.bytes, 0);
report.passed = report.totalStagedBytes <= budgets.stagedBytes && report.appBytes <= budgets.appBytes && report.compressedArtifactBytes <= budgets.compressedArtifactBytes;

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[desktop] bundle budget report: ${reportPath}`);
for (const [name, actual, budget] of [
	["staged", report.totalStagedBytes, budgets.stagedBytes],
	["app", report.appBytes, budgets.appBytes],
	["compressed-artifacts", report.compressedArtifactBytes, budgets.compressedArtifactBytes],
]) console.log(`[desktop] ${name}: ${formatBytes(actual)} / ${formatBytes(budget)}`);
if (!report.passed) throw new Error(`Desktop bundle budget exceeded; see ${reportPath}`);

function sizeIfPresent(target) {
	if (!fs.existsSync(target)) return 0;
	const stat = fs.statSync(target);
	if (stat.isFile()) return stat.size;
	return fs.readdirSync(target, { withFileTypes: true }).reduce((total, entry) => total + sizeIfPresent(path.join(target, entry.name)), 0);
}

function listBundleArtifacts(target) {
	if (!fs.existsSync(target)) return [];
	const stat = fs.statSync(target);
	if (stat.isFile()) return [target];
	return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
		const entryPath = path.join(target, entry.name);
		if (entry.isDirectory() && entry.name.endsWith(".app")) return [entryPath];
		return listBundleArtifacts(entryPath);
	});
}

function formatBytes(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
