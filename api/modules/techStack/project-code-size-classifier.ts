import fs from "node:fs";
import path from "node:path";
import type {
	ProjectCodeSizeClassificationSource,
	ProjectCodeSizeSourceCategory,
	ProjectCodeSizeTestKind,
} from "../../../shared/schemas/tech-stack.schema";

export type ProjectCodeSizeTarget =
	| { type: "source"; category: ProjectCodeSizeSourceCategory }
	| { type: "test"; kind: ProjectCodeSizeTestKind };

export type ProjectCodeSizeClassification = {
	target: ProjectCodeSizeTarget;
	root: string;
	source: ProjectCodeSizeClassificationSource;
};

type ClassifierInput = {
	repoRoot: string;
	relativePath: string;
	topLevelSegments: Set<string>;
	manifestCategoryCache?: Map<string, ProjectCodeSizeSourceCategory | null>;
};

const EXPLICIT_SOURCE_SEGMENTS: Record<string, ProjectCodeSizeSourceCategory> =
	{
		batch: "batch",
		batches: "batch",
		jobs: "batch",
		cron: "batch",
		crons: "batch",
		workers: "batch",
		script: "script",
		scripts: "script",
		bin: "script",
		share: "shared",
		shared: "shared",
		common: "shared",
		db: "database",
		database: "database",
		drizzle: "database",
		migrations: "database",
		desktop: "desktop",
		electron: "desktop",
		"src-tauri": "desktop",
	};

const ROOT_CATEGORIES: Record<string, ProjectCodeSizeSourceCategory> = {
	frontend: "frontend",
	front: "frontend",
	web: "frontend",
	client: "frontend",
	ui: "frontend",
	backend: "backend",
	server: "backend",
	api: "backend",
	...EXPLICIT_SOURCE_SEGMENTS,
};

const MONOREPO_CONTAINERS = new Set(["apps", "packages", "services", "libs"]);
const E2E_SEGMENTS = new Set(["e2e", "playwright", "cypress"]);
const OTHER_TEST_SEGMENTS = new Set([
	"integration",
	"contract",
	"performance",
	"load",
	"benchmark",
]);
const UNIT_SEGMENTS = new Set([
	"test",
	"tests",
	"__tests__",
	"spec",
	"specs",
	"unit",
]);

function markerIndex(segments: string[], markers: Set<string>) {
	return segments.findIndex((segment) => markers.has(segment.toLowerCase()));
}

function markerRoot(segments: string[], index: number) {
	return segments.slice(0, Math.max(index + 1, 1)).join("/") || ".";
}

function hasFilenameMarker(fileName: string, markers: string[]) {
	const lower = fileName.toLowerCase();
	return markers.some((marker) => lower.includes(marker));
}

function ownershipRoot(segments: string[]) {
	if (segments.length <= 1) return ".";
	if (MONOREPO_CONTAINERS.has(segments[0]) && segments.length >= 2) {
		return `${segments[0]}/${segments[1]}`;
	}
	return segments[0];
}

function packageDependencies(repoRoot: string, root: string) {
	const candidates = [
		path.join(repoRoot, root, "package.json"),
		path.join(repoRoot, "package.json"),
	];
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as Record<
				string,
				unknown
			>;
			const dependencies = {
				...(parsed.dependencies as Record<string, unknown> | undefined),
				...(parsed.devDependencies as Record<string, unknown> | undefined),
			};
			return new Set(Object.keys(dependencies));
		} catch {}
	}
	return new Set<string>();
}

function manifestCategory(
	repoRoot: string,
	root: string,
	topLevelSegments: Set<string>,
): ProjectCodeSizeSourceCategory | null {
	const dependencies = packageDependencies(repoRoot, root);
	const frontend = [
		"react",
		"react-dom",
		"next",
		"vue",
		"svelte",
		"@angular/core",
		"vite",
	].some((name) => dependencies.has(name));
	const backend = ["hono", "express", "fastify", "koa", "@nestjs/core"].some(
		(name) => dependencies.has(name),
	);
	if (frontend && !backend) return "frontend";
	if (backend && !frontend) return "backend";
	if (
		frontend &&
		backend &&
		["api", "backend", "server"].some((name) => topLevelSegments.has(name))
	)
		return "frontend";
	return null;
}

function cachedManifestCategory(input: ClassifierInput, root: string) {
	if (!input.manifestCategoryCache) {
		return manifestCategory(input.repoRoot, root, input.topLevelSegments);
	}
	if (input.manifestCategoryCache.has(root)) {
		return input.manifestCategoryCache.get(root) ?? null;
	}
	const category = manifestCategory(
		input.repoRoot,
		root,
		input.topLevelSegments,
	);
	input.manifestCategoryCache.set(root, category);
	return category;
}

export function classifyProjectCodeFile(
	input: ClassifierInput,
): ProjectCodeSizeClassification {
	const segments = input.relativePath.split("/").filter(Boolean);
	const fileName = segments.at(-1) ?? input.relativePath;
	const e2eIndex = markerIndex(segments, E2E_SEGMENTS);
	if (e2eIndex >= 0 || hasFilenameMarker(fileName, [".e2e.", ".pw."])) {
		return {
			target: { type: "test", kind: "e2e" },
			root:
				e2eIndex >= 0
					? markerRoot(segments, e2eIndex)
					: ownershipRoot(segments),
			source: "test_path_rule",
		};
	}
	const otherTestIndex = markerIndex(segments, OTHER_TEST_SEGMENTS);
	if (
		otherTestIndex >= 0 ||
		hasFilenameMarker(fileName, [
			".integration.",
			".contract.",
			".performance.",
			".load.",
			".benchmark.",
		])
	) {
		return {
			target: { type: "test", kind: "other" },
			root:
				otherTestIndex >= 0
					? markerRoot(segments, otherTestIndex)
					: ownershipRoot(segments),
			source: "test_path_rule",
		};
	}
	const unitIndex = markerIndex(segments, UNIT_SEGMENTS);
	if (
		unitIndex >= 0 ||
		hasFilenameMarker(fileName, [".test.", ".spec.", ".unit."])
	) {
		return {
			target: { type: "test", kind: "unit" },
			root:
				unitIndex >= 0
					? markerRoot(segments, unitIndex)
					: ownershipRoot(segments),
			source: "test_path_rule",
		};
	}
	if (
		["Dockerfile", "Makefile", "Rakefile", "Procfile"].includes(fileName) ||
		/[.](sh|bash|zsh|fish|ps1)$/i.test(fileName)
	) {
		return {
			target: { type: "source", category: "script" },
			root: ownershipRoot(segments),
			source: "explicit_path_rule",
		};
	}

	for (let index = segments.length - 2; index >= 0; index -= 1) {
		const category = EXPLICIT_SOURCE_SEGMENTS[segments[index].toLowerCase()];
		if (category) {
			return {
				target: { type: "source", category },
				root: markerRoot(segments, index),
				source: "explicit_path_rule",
			};
		}
	}

	const root = ownershipRoot(segments);
	const rootName = root.split("/").at(-1)?.toLowerCase() ?? root;
	const rootCategory = ROOT_CATEGORIES[rootName];
	if (rootCategory) {
		return {
			target: { type: "source", category: rootCategory },
			root,
			source: "ownership_root_rule",
		};
	}
	if (rootName === "src" || rootName === "app") {
		const category = cachedManifestCategory(input, root);
		if (category) {
			return {
				target: { type: "source", category },
				root,
				source: "manifest_evidence",
			};
		}
	}
	return {
		target: { type: "source", category: "other" },
		root,
		source: "fallback",
	};
}

export function createProjectCodeSizeClassifier(input: {
	repoRoot: string;
	topLevelSegments: Set<string>;
}) {
	const manifestCategoryCache = new Map<
		string,
		ProjectCodeSizeSourceCategory | null
	>();
	return (relativePath: string) =>
		classifyProjectCodeFile({
			...input,
			relativePath,
			manifestCategoryCache,
		});
}
