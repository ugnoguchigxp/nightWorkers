import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "@typescript/typescript6";

const root = process.cwd();
const errors = [];
const sourcePattern = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const packageRoot = "packages/mission-pilot";
const packageSourceRoot = `${packageRoot}/src`;
const forbiddenPackageSourceRoots = [`${packageSourceRoot}/db`];
const publicExports = new Set([
	"@nightworkers/mission-pilot/backend",
	"@nightworkers/mission-pilot/contracts",
	"@nightworkers/mission-pilot/frontend",
	"@nightworkers/mission-pilot/i18n",
	"@nightworkers/mission-pilot/testing",
	"@nightworkers/mission-pilot/frontend.css",
]);
const retiredRoots = ["src/modules/missionPilot", "shared/modules/missionPilot"];
const productionPackageImportAllowlist = [
	"api/composition/mission-pilot/",
	"api/modules/missionPilot/persistence/",
	"src/composition/mission-pilot/",
];
const corePersistenceRoot = "api/modules/missionPilot/persistence";
const allowedCorePersistenceImports = new Map([
	[
		"api/composition/mission-pilot/mission-pilot-runtime-bindings.ts",
		new Set([`${corePersistenceRoot}/capability`]),
	],
	[
		"api/composition/mission-pilot/mission-pilot-storage-composition.ts",
		new Set([`${corePersistenceRoot}/bootstrap`]),
	],
	[
		"api/db/client.ts",
		new Set([
			`${corePersistenceRoot}/agent-schema`,
			`${corePersistenceRoot}/schema`,
		]),
	],
]);

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

function resolveRelativeModule(relativePath, specifier) {
	if (!specifier.startsWith(".")) return null;
	return path.posix
		.normalize(path.posix.join(path.posix.dirname(relativePath), specifier))
		.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/, "");
}

const packageFiles = walk(packageSourceRoot);
const packagePersistencePort = `${packageSourceRoot}/backend/persistence-port`;
for (const forbiddenRoot of forbiddenPackageSourceRoots) {
	if (fs.existsSync(path.join(root, forbiddenRoot)))
		errors.push(
			`${forbiddenRoot}: Mission Pilot package must not own a database layer`,
		);
}
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
		if (
			resolveRelativeModule(relativePath, specifier) === packagePersistencePort &&
			!relativePath.startsWith(`${packageSourceRoot}/backend/`)
		) {
			errors.push(
				`${relativePath}: only Mission Pilot backend may call the persistence port`,
			);
		}
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
				"better-sqlite3",
				"bun:sqlite",
				"child_process",
				"drizzle-orm",
				"drizzle-orm/libsql",
				"drizzle-orm/sqlite-core",
				"fs",
				"fs/promises",
				"module",
				"node:child_process",
				"node:fs",
				"node:fs/promises",
				"node:module",
				"node:sqlite",
				"simple-git",
				"sqlite3",
				"execa",
			].includes(specifier)
		) {
			errors.push(
				`${relativePath}: package must not access persistence, filesystem, Git, or shell (${specifier})`,
			);
		}
	}
	if (
		relativePath !== `${packageSourceRoot}/backend/host-bindings.ts` &&
		relativePath !== `${packageSourceRoot}/backend/persistence-port.ts` &&
		fs
			.readFileSync(path.join(root, relativePath), "utf8")
			.includes("executeMissionPilotPersistence")
	) {
		errors.push(
			`${relativePath}: persistence host capability may be referenced only by the package-private port`,
		);
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
			specifier === "@nightworkers/mission-pilot/testing"
		) {
			errors.push(
				`${relativePath}: Mission Pilot testing entry point is forbidden in production`,
			);
		}
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

const productionFiles = [
	...walk("api"),
	...walk("src"),
	...walk("shared"),
];
for (const relativePath of productionFiles) {
	if (relativePath.startsWith(`${corePersistenceRoot}/`)) continue;
	for (const specifier of importedSpecifiers(relativePath)) {
		const resolved = resolveRelativeModule(relativePath, specifier);
		if (
			resolved !== corePersistenceRoot &&
			!resolved?.startsWith(`${corePersistenceRoot}/`)
		)
			continue;
		if (!allowedCorePersistenceImports.get(relativePath)?.has(resolved)) {
			errors.push(
				`${relativePath}: direct Mission Pilot persistence import is forbidden (${specifier})`,
			);
		}
	}
}

const runtimeBindingsModule =
	"api/composition/mission-pilot/mission-pilot-runtime-bindings";
for (const relativePath of productionFiles) {
	for (const specifier of importedSpecifiers(relativePath)) {
		if (
			resolveRelativeModule(relativePath, specifier) === runtimeBindingsModule &&
			relativePath !==
				"api/composition/mission-pilot/mission-pilot-dependencies.ts"
		) {
			errors.push(
				`${relativePath}: only Mission Pilot dependency composition may acquire runtime bindings`,
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
