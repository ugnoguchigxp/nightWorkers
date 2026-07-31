import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "@typescript/typescript6";

const root = process.cwd();
const errors = [];
const sourcePattern = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const packageRoot = "packages/mission-pilot";
const packageSourceRoot = `${packageRoot}/src`;
const publicExports = new Set([
	"@nightworkers/mission-pilot/backend",
	"@nightworkers/mission-pilot/contracts",
	"@nightworkers/mission-pilot/frontend",
	"@nightworkers/mission-pilot/testing",
	"@nightworkers/mission-pilot/frontend.css",
]);
const oldRoots = [
	"api/modules/missionPilot",
	"src/modules/missionPilot",
	"shared/modules/missionPilot",
];
const productionPackageImportAllowlist = [
	"api/composition/mission-pilot/",
	"src/composition/mission-pilot/",
	"api/app.ts",
	"api/server.ts",
];

function walk(relativeDirectory) {
	const directory = path.join(root, relativeDirectory);
	if (!fs.existsSync(directory)) return [];
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			return walk(path.relative(root, target).replaceAll(path.sep, "/"));
		}
		return sourcePattern.test(entry.name)
			? [path.relative(root, target).replaceAll(path.sep, "/")]
			: [];
	});
}

function importedSpecifiers(relativePath) {
	const source = fs.readFileSync(path.join(root, relativePath), "utf8");
	return ts
		.preProcessFile(source, true, true)
		.importedFiles.map((entry) => entry.fileName);
}

function resolvesOutsidePackage(relativePath, specifier) {
	if (!specifier.startsWith(".")) return false;
	const resolved = path.posix.normalize(
		path.posix.join(path.posix.dirname(relativePath), specifier),
	);
	return (
		resolved !== packageSourceRoot &&
		!resolved.startsWith(`${packageSourceRoot}/`)
	);
}

const packageFiles = walk(packageSourceRoot);
for (const relativePath of packageFiles) {
	for (const specifier of importedSpecifiers(relativePath)) {
		if (resolvesOutsidePackage(relativePath, specifier)) {
			errors.push(
				`${relativePath}: package relative import escapes package source (${specifier})`,
			);
		}
		if (
			specifier.startsWith("@api/") ||
			specifier.startsWith("@/") ||
			specifier.startsWith("api/") ||
			specifier.startsWith("src/") ||
			specifier.startsWith("shared/")
		) {
			errors.push(
				`${relativePath}: package must not import NightWorkers private source (${specifier})`,
			);
		}
		if (
			[
				"node:child_process",
				"node:fs",
				"node:fs/promises",
				"simple-git",
				"execa",
			].includes(specifier)
		) {
			errors.push(
				`${relativePath}: package must not access filesystem, Git, or shell (${specifier})`,
			);
		}
	}
}

for (const relativePath of [
	...walk("api/modules/codingAgent"),
	...walk("src/modules/codingAgent"),
	...walk("shared/modules/codingAgent"),
	...walk("api/modules/planMode"),
	...walk("src/modules/planMode"),
	...walk("api/modules/taskOperator"),
]) {
	for (const specifier of importedSpecifiers(relativePath)) {
		if (specifier.startsWith("@nightworkers/mission-pilot")) {
			errors.push(
				`${relativePath}: role-independent/Coding Agent code must not import Mission Pilot package`,
			);
		}
	}
}

for (const relativePath of [
	...walk("api"),
	...walk("src"),
	...walk("shared"),
	...walk("tests"),
]) {
	for (const specifier of importedSpecifiers(relativePath)) {
		if (
			!relativePath.startsWith("tests/") &&
			specifier.startsWith("@nightworkers/mission-pilot/") &&
			!productionPackageImportAllowlist.some(
				(prefix) =>
					relativePath === prefix ||
					relativePath.startsWith(prefix),
			)
		) {
			errors.push(
				`${relativePath}: only Mission Pilot composition roots may import the package`,
			);
		}
		if (
			specifier.startsWith("@nightworkers/mission-pilot/") &&
			!publicExports.has(specifier)
		) {
			errors.push(
				`${relativePath}: deep import into Mission Pilot package is forbidden (${specifier})`,
			);
		}
		if (specifier === "@nightworkers/mission-pilot") {
			errors.push(
				`${relativePath}: broad Mission Pilot package import is forbidden`,
			);
		}
	}
}

const ledger = JSON.parse(
	fs.readFileSync(
		path.join(root, ".agent-ontology/mission-pilot-migration-ledger.json"),
		"utf8",
	),
);
const baseline = new Set([
	...(ledger.backend ?? []),
	...(ledger.frontend ?? []),
	...(ledger.shared ?? []),
]);
const currentOldFiles = oldRoots.flatMap(walk);
for (const relativePath of currentOldFiles) {
	if (!baseline.has(relativePath)) {
		errors.push(
			`${relativePath}: old Mission Pilot production path is shrink-only during migration`,
		);
	}
}

if (errors.length > 0) {
	console.error("[architecture] Mission Pilot package boundary check failed");
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}

console.log(
	`[architecture] Mission Pilot package boundary checked across ${packageFiles.length} package files; ${currentOldFiles.length} legacy files remain`,
);
