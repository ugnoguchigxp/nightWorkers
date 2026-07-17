import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const entrypoints = [
	"api/workers/task-run-worker.ts",
	"api/modules/nightworkers/run-orchestration/start-task-run-entry.ts",
	"api/modules/nightworkers/run-orchestration/runtime-execution.ts",
	"api/services/worker-tools/read-current-specification.ts",
];
const extensions = [".ts", ".tsx", ".js", ".mjs"];
const forbiddenRuntimeDependencies = [
	"api/modules/missionPilot/",
	"api/db/mission-pilot-schema-bootstrap.ts",
];

function resolveLocalImport(fromFile, specifier) {
	if (!specifier.startsWith(".")) return null;
	const base = path.resolve(path.dirname(fromFile), specifier);
	const candidates = [
		base,
		...extensions.map((extension) => `${base}${extension}`),
		...extensions.map((extension) => path.join(base, `index${extension}`)),
	];
	return (
		candidates.find(
			(candidate) =>
				fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
		) ?? null
	);
}

function listStaticRuntimeDependencies(file) {
	const source = fs.readFileSync(file, "utf8");
	const dependencies = [];
	const staticImport =
		/(?:^|\n)\s*(?:import(?!\s+type\b)[\s\S]*?\sfrom\s|export\s+(?!type\b)[^;\n]*?\sfrom\s)["']([^"']+)["']/g;
	for (const match of source.matchAll(staticImport)) {
		const dependency = resolveLocalImport(file, match[1]);
		if (dependency) dependencies.push(dependency);
	}
	const sideEffectImport = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
	for (const match of source.matchAll(sideEffectImport)) {
		const dependency = resolveLocalImport(file, match[1]);
		if (dependency) dependencies.push(dependency);
	}
	return dependencies;
}

function findForbiddenChains(entrypoint) {
	const queue = [[path.resolve(repositoryRoot, entrypoint), [entrypoint]]];
	const visited = new Set();
	const violations = [];
	while (queue.length > 0) {
		const [file, chain] = queue.shift();
		if (visited.has(file)) continue;
		visited.add(file);
		for (const dependency of listStaticRuntimeDependencies(file)) {
			const relative = path.relative(repositoryRoot, dependency);
			const nextChain = [...chain, relative];
			if (
				forbiddenRuntimeDependencies.some((forbidden) =>
					relative.includes(forbidden),
				)
			) {
				violations.push(nextChain);
				continue;
			}
			queue.push([dependency, nextChain]);
		}
	}
	return violations;
}

const violations = entrypoints.flatMap((entrypoint) =>
	findForbiddenChains(entrypoint),
);
if (violations.length > 0) {
	console.error(
		[
			"[architecture] Coding Agent standalone paths depend on Mission Pilot:",
			...violations.map((chain) => `  ${chain.join(" -> ")}`),
		].join("\n"),
	);
	process.exit(1);
}

console.log(
	`[architecture] Coding Agent standalone boundary checked across ${entrypoints.length} entrypoints`,
);
