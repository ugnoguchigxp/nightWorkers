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
const retiredRoots = ["src/modules/missionPilot", "shared/modules/missionPilot"];
const productionPackageImportAllowlist = [
	"api/composition/mission-pilot/",
	"api/modules/missionPilot/persistence/",
	"src/composition/mission-pilot/",
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
for (const forbiddenBoundaryFile of [
	`${packageRoot}/package.json`,
	`${packageRoot}/tsconfig.json`,
]) {
	if (fs.existsSync(path.join(root, forbiddenBoundaryFile)))
		errors.push(
			`${forbiddenBoundaryFile}: Mission Pilot is a Pure TypeScript boundary and must not own an npm project manifest`,
		);
}
const backendIndexPath = `${packageSourceRoot}/backend/index.ts`;
const backendIndexSource = fs.readFileSync(
	path.join(root, backendIndexPath),
	"utf8",
);
if (/\bexport\s+\*\s+from\b/.test(backendIndexSource)) {
	errors.push(
		`${backendIndexPath}: backend public API must use explicit factory and dependency exports`,
	);
}
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
				"@libsql/client",
				"drizzle-orm",
				"drizzle-orm/libsql",
				"drizzle-orm/sqlite-core",
				"node:child_process",
				"node:fs",
				"node:fs/promises",
				"simple-git",
				"execa",
			].includes(specifier)
		) {
			errors.push(
				`${relativePath}: package must not access persistence, filesystem, Git, or shell (${specifier})`,
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
			relativePath.startsWith("api/modules/missionPilot/persistence/") &&
			specifier.startsWith("@nightworkers/mission-pilot/") &&
			specifier !== "@nightworkers/mission-pilot/contracts"
		)
			errors.push(
				`${relativePath}: core persistence may import only Mission Pilot public contracts`,
			);
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

const currentRetiredFiles = retiredRoots.flatMap(walk);
for (const relativePath of currentRetiredFiles) {
	errors.push(`${relativePath}: retired Mission Pilot production path is forbidden`);
}

for (const relativePath of walk("api/modules/missionPilot")) {
	if (!relativePath.startsWith("api/modules/missionPilot/persistence/"))
		errors.push(
			`${relativePath}: NightWorkers Mission Pilot core code is limited to the persistence capability`,
		);
}

const capabilityImporters = [...walk("api"), ...walk("src")].filter(
	(relativePath) =>
		importedSpecifiers(relativePath).some((specifier) =>
			specifier.endsWith("modules/missionPilot/persistence/capability"),
		),
);
const allowedCapabilityImporter =
	"api/composition/mission-pilot/mission-pilot-runtime-bindings.ts";
for (const relativePath of capabilityImporters) {
	if (relativePath !== allowedCapabilityImporter)
		errors.push(
			`${relativePath}: only the Mission Pilot runtime composition may acquire the persistence capability`,
		);
}

const rootPackage = JSON.parse(
	fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
if (rootPackage.workspaces)
	errors.push(
		"package.json: Mission Pilot Pure TypeScript boundary must not be configured as a workspace",
	);
if (rootPackage.dependencies?.["@nightworkers/mission-pilot"])
	errors.push(
		"package.json: Mission Pilot Pure TypeScript boundary must not be a package dependency",
	);

if (errors.length > 0) {
	console.error("[architecture] Mission Pilot package boundary check failed");
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}

console.log(
	`[architecture] Mission Pilot Pure TypeScript boundary checked across ${packageFiles.length} files; persistence is capability-injected from NightWorkers core`,
);
