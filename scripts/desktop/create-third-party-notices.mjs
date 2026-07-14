import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stagedRoot = path.join(root, "scripts/desktop/staged");
const manifest = JSON.parse(fs.readFileSync(path.join(stagedRoot, "manifest.json"), "utf8"));
const entries = [];
for (const packageName of manifest.copiedPackages ?? []) {
	const packageJsonPath = path.join(stagedRoot, "node_modules", ...packageName.split("/"), "package.json");
	if (!fs.existsSync(packageJsonPath)) throw new Error(`Bundled package metadata is missing: ${packageName}`);
	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
	entries.push(`${packageName}@${packageJson.version ?? "unknown"}\nLicense: ${licenseValue(packageJson)}\n`);
}
const nodeLicense = path.join(stagedRoot, "node", "LICENSE");
if (!fs.existsSync(nodeLicense)) {
	if (process.env.NIGHTWORKERS_RELEASE === "1") {
		throw new Error("Bundled Node runtime license is missing");
	}
	entries.push(
		`Node.js ${manifest.runtime?.version ?? manifest.node}\nLicense: Node.js license must be bundled by the pinned-runtime release staging step\n`,
	);
} else {
	entries.push(`Node.js ${manifest.runtime?.version ?? manifest.node}\nLicense: see node/LICENSE\n`);
}
const output = [
	"NightWorkers third-party notices",
	"",
	`Generated: ${new Date().toISOString()}`,
	"",
	...entries,
].join("\n");
fs.writeFileSync(path.join(stagedRoot, "THIRD_PARTY_NOTICES.txt"), `${output}\n`);
console.log(`[desktop] third-party notices: ${path.join(stagedRoot, "THIRD_PARTY_NOTICES.txt")}`);

function licenseValue(packageJson) {
	if (typeof packageJson.license === "string") return packageJson.license;
	if (packageJson.license?.type) return packageJson.license.type;
	if (Array.isArray(packageJson.licenses)) return packageJson.licenses.map((license) => license.type ?? license).join(", ");
	return "SEE PACKAGE LICENSE FILE";
}
