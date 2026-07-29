import fs from "node:fs/promises";
import path from "node:path";
import type {
	WorkspaceBootstrapAdapterId,
	WorkspaceBootstrapComponent,
} from "./types";
import { WorkspaceBootstrapError } from "./types";

const IGNORED_DIRECTORIES = new Set([
	".git",
	".idea",
	".next",
	".venv",
	".vscode",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"target",
	"vendor",
]);
const MAX_SCAN_DEPTH = 3;
const MAX_DIRECTORIES = 2_000;

type DirectorySnapshot = {
	relativePath: string;
	files: Set<string>;
};

type ManagedJavaScriptRoot = {
	relativePath: string;
	patterns: string[];
};

export async function detectWorkspaceBootstrapComponents(
	workspaceRoot: string,
): Promise<WorkspaceBootstrapComponent[]> {
	const directories = await scanDirectories(workspaceRoot);
	const managedJavaScriptRoots = await findManagedJavaScriptRoots(
		workspaceRoot,
		directories,
	);
	const components: WorkspaceBootstrapComponent[] = [];
	for (const directory of directories) {
		const javascript = resolveJavaScriptManager(
			directory,
			managedJavaScriptRoots.some(
				(root) =>
					root.relativePath !== directory.relativePath &&
					matchesManagedJavaScriptRoot(root, directory.relativePath),
			),
		);
		if (javascript) components.push(javascript);
		components.push(...resolveNonJavaScriptComponents(directory));
	}
	const augmented = augmentJavaScriptEvidence(
		components,
		directories,
		managedJavaScriptRoots,
	);
	assertDotnetSolutionsCovered(directories, augmented);
	await validateJavaScriptPackageManagers(workspaceRoot, augmented);
	return augmented.sort((left, right) => {
		const depthDifference =
			pathDepth(left.rootRelativePath) - pathDepth(right.rootRelativePath);
		if (depthDifference !== 0) return depthDifference;
		return `${left.rootRelativePath}:${left.adapterId}`.localeCompare(
			`${right.rootRelativePath}:${right.adapterId}`,
		);
	});
}

async function scanDirectories(root: string) {
	const queue: Array<{
		absolutePath: string;
		relativePath: string;
		depth: number;
	}> = [{ absolutePath: root, relativePath: ".", depth: 0 }];
	const result: DirectorySnapshot[] = [];
	while (queue.length > 0) {
		if (result.length >= MAX_DIRECTORIES) {
			throw new WorkspaceBootstrapError(
				"BOOTSTRAP_ADAPTER_UNSUPPORTED",
				"Workspace dependency scan exceeded its structural limit.",
				{ stage: "detection", retryable: false },
			);
		}
		const current = queue.shift();
		if (!current) break;
		const entries = await fs.readdir(current.absolutePath, {
			withFileTypes: true,
		});
		const files = new Set(
			entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
		);
		result.push({ relativePath: current.relativePath, files });
		if (current.depth >= MAX_SCAN_DEPTH) continue;
		for (const entry of entries) {
			if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
			queue.push({
				absolutePath: path.join(current.absolutePath, entry.name),
				relativePath:
					current.relativePath === "."
						? entry.name
						: path.join(current.relativePath, entry.name),
				depth: current.depth + 1,
			});
		}
	}
	return result;
}

function hasJavaScriptLock(directory: DirectorySnapshot) {
	if (!directory.files.has("package.json")) return false;
	return [
		"bun.lock",
		"bun.lockb",
		"package-lock.json",
		"npm-shrinkwrap.json",
		"pnpm-lock.yaml",
		"yarn.lock",
	].some((file) => directory.files.has(file));
}

async function findManagedJavaScriptRoots(
	workspaceRoot: string,
	directories: DirectorySnapshot[],
) {
	const roots: ManagedJavaScriptRoot[] = [];
	for (const directory of directories) {
		if (!hasJavaScriptLock(directory)) continue;
		let patterns: string[] = [];
		if (directory.files.has("pnpm-workspace.yaml")) {
			patterns = parsePnpmWorkspacePatterns(
				await fs.readFile(
					path.resolve(
						workspaceRoot,
						directory.relativePath,
						"pnpm-workspace.yaml",
					),
					"utf8",
				),
			);
		}
		const manifestPath = path.resolve(
			workspaceRoot,
			directory.relativePath,
			"package.json",
		);
		const manifest = await fs
			.readFile(manifestPath, "utf8")
			.then((content) => JSON.parse(content) as Record<string, unknown>)
			.catch(() => null);
		const workspaces = manifest?.workspaces;
		const packagePatterns = Array.isArray(workspaces)
			? workspaces
			: workspaces &&
					typeof workspaces === "object" &&
					!Array.isArray(workspaces) &&
					Array.isArray((workspaces as Record<string, unknown>).packages)
				? ((workspaces as Record<string, unknown>).packages as unknown[])
				: [];
		patterns.push(
			...packagePatterns.filter(
				(pattern): pattern is string =>
					typeof pattern === "string" && Boolean(pattern.trim()),
			),
		);
		if (patterns.length > 0) {
			roots.push({
				relativePath: directory.relativePath,
				patterns: [...new Set(patterns.map((pattern) => pattern.trim()))],
			});
		}
	}
	return roots;
}

function parsePnpmWorkspacePatterns(content: string) {
	const patterns: string[] = [];
	let inPackages = false;
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		if (!rawLine.startsWith(" ") && !rawLine.startsWith("\t")) {
			inPackages = /^packages\s*:/.test(line);
			continue;
		}
		if (!inPackages || !line.startsWith("-")) continue;
		const pattern = line
			.slice(1)
			.trim()
			.replace(/^(['"])(.*)\1$/, "$2");
		if (pattern) patterns.push(pattern);
	}
	return patterns;
}

function resolveJavaScriptManager(
	directory: DirectorySnapshot | null,
	skipUnlockedNestedPackage: boolean,
): WorkspaceBootstrapComponent | null {
	if (!directory?.files.has("package.json")) return null;
	const lockfiles: Array<{
		file: string;
		adapterId: WorkspaceBootstrapAdapterId;
	}> = [
		{ file: "bun.lock", adapterId: "bun" },
		{ file: "bun.lockb", adapterId: "bun" },
		{ file: "package-lock.json", adapterId: "npm" },
		{ file: "npm-shrinkwrap.json", adapterId: "npm" },
		{ file: "pnpm-lock.yaml", adapterId: "pnpm" },
		{ file: "yarn.lock", adapterId: "yarn" },
	];
	const detected = lockfiles.filter(({ file }) => directory.files.has(file));
	const managers = new Set(detected.map(({ adapterId }) => adapterId));
	if (managers.size > 1 || detected.length > 1) {
		throw new WorkspaceBootstrapError(
			"BOOTSTRAP_MANAGER_AMBIGUOUS",
			`Multiple JavaScript lockfiles exist in ${directory.relativePath}.`,
			{
				stage: "detection",
				componentRoot: directory.relativePath,
				retryable: false,
			},
		);
	}
	if (detected.length === 0) {
		if (skipUnlockedNestedPackage) return null;
		throw new WorkspaceBootstrapError(
			"BOOTSTRAP_LOCK_REQUIRED",
			`package.json in ${directory.relativePath} has no supported lockfile.`,
			{
				stage: "detection",
				componentRoot: directory.relativePath,
				retryable: false,
			},
		);
	}
	const adapterId = detected[0]?.adapterId;
	if (!adapterId) return null;
	return component(directory, adapterId, [
		"package.json",
		...detected.map(({ file }) => file),
		...[
			".npmrc",
			".yarnrc",
			".yarnrc.yml",
			"bunfig.toml",
			"pnpm-workspace.yaml",
		].filter((file) => directory.files.has(file)),
	]);
}

function augmentJavaScriptEvidence(
	components: WorkspaceBootstrapComponent[],
	directories: DirectorySnapshot[],
	managedRoots: ManagedJavaScriptRoot[],
) {
	const javascriptAdapters = new Set<WorkspaceBootstrapAdapterId>([
		"bun",
		"npm",
		"pnpm",
		"yarn",
	]);
	return components.map((candidate) => {
		if (!javascriptAdapters.has(candidate.adapterId)) return candidate;
		const managedRoot = managedRoots.find(
			(root) => root.relativePath === candidate.rootRelativePath,
		);
		const nestedRoots = components
			.filter(
				(other) =>
					other !== candidate &&
					javascriptAdapters.has(other.adapterId) &&
					isWithin(candidate.rootRelativePath, other.rootRelativePath),
			)
			.map((other) => other.rootRelativePath);
		const workspaceManifests = directories
			.filter(
				(directory) =>
					directory.files.has("package.json") &&
					(directory.relativePath === candidate.rootRelativePath ||
						Boolean(
							managedRoot &&
								matchesManagedJavaScriptRoot(
									managedRoot,
									directory.relativePath,
								),
						)) &&
					!nestedRoots.some((root) => isWithin(root, directory.relativePath)),
			)
			.map((directory) =>
				directory.relativePath === "."
					? "package.json"
					: path.join(directory.relativePath, "package.json"),
			);
		return {
			...candidate,
			evidencePaths: [
				...new Set([...candidate.evidencePaths, ...workspaceManifests]),
			],
		};
	});
}

function matchesManagedJavaScriptRoot(
	root: ManagedJavaScriptRoot,
	candidate: string,
) {
	const relative = path
		.relative(root.relativePath, candidate)
		.split(path.sep)
		.join("/");
	if (!relative || relative.startsWith("../")) return false;
	let included = false;
	for (const rawPattern of root.patterns) {
		const excluded = rawPattern.startsWith("!");
		const pattern = excluded ? rawPattern.slice(1) : rawPattern;
		if (!workspacePatternMatches(pattern, relative)) continue;
		if (excluded) return false;
		included = true;
	}
	return included;
}

function workspacePatternMatches(pattern: string, candidate: string) {
	const escaped = pattern
		.split("/")
		.map((segment) => {
			if (segment === "**") return "(?:.+/)?[^/]*";
			return segment
				.replace(/[.+^${}()|[\]\\]/g, "\\$&")
				.replace(/\*/g, "[^/]*")
				.replace(/\?/g, "[^/]");
		})
		.join("/");
	return new RegExp(`^${escaped}$`).test(candidate);
}

async function validateJavaScriptPackageManagers(
	workspaceRoot: string,
	components: WorkspaceBootstrapComponent[],
) {
	for (const component of components) {
		if (!["bun", "npm", "pnpm", "yarn"].includes(component.adapterId)) continue;
		const manifestPath = path.resolve(
			workspaceRoot,
			component.rootRelativePath,
			"package.json",
		);
		let manifest: Record<string, unknown>;
		try {
			manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<
				string,
				unknown
			>;
		} catch {
			throw new WorkspaceBootstrapError(
				"DEPENDENCY_STATE_INVALID",
				`package.json in ${component.rootRelativePath} is invalid.`,
				{
					stage: "detection",
					adapterId: component.adapterId,
					componentRoot: component.rootRelativePath,
					retryable: false,
				},
			);
		}
		if (typeof manifest.packageManager !== "string") continue;
		const declaredManager = manifest.packageManager.split("@", 1)[0]?.trim();
		if (declaredManager && declaredManager !== component.adapterId) {
			throw new WorkspaceBootstrapError(
				"BOOTSTRAP_MANAGER_AMBIGUOUS",
				`packageManager and lockfile disagree in ${component.rootRelativePath}.`,
				{
					stage: "detection",
					adapterId: component.adapterId,
					componentRoot: component.rootRelativePath,
					retryable: false,
				},
			);
		}
	}
}

function resolveNonJavaScriptComponents(directory: DirectorySnapshot) {
	const components: WorkspaceBootstrapComponent[] = [];
	if (directory.files.has("pyproject.toml")) {
		const pythonLocks = [
			directory.files.has("uv.lock") ? "uv" : null,
			directory.files.has("poetry.lock") ? "poetry" : null,
		].filter(Boolean) as WorkspaceBootstrapAdapterId[];
		if (pythonLocks.length > 1) {
			throw ambiguous(directory, "Multiple Python lockfile families");
		}
		if (pythonLocks[0]) {
			components.push(
				component(directory, pythonLocks[0], [
					"pyproject.toml",
					pythonLocks[0] === "uv" ? "uv.lock" : "poetry.lock",
				]),
			);
		} else {
			throw lockRequired(directory, "pyproject.toml");
		}
	} else if (directory.files.has("requirements.lock")) {
		components.push(component(directory, "pip", ["requirements.lock"]));
	}
	if (directory.files.has("Gemfile")) {
		if (!directory.files.has("Gemfile.lock")) {
			throw lockRequired(directory, "Gemfile");
		}
		components.push(
			component(directory, "bundler", ["Gemfile", "Gemfile.lock"]),
		);
	}
	if (directory.files.has("composer.json")) {
		if (!directory.files.has("composer.lock")) {
			throw lockRequired(directory, "composer.json");
		}
		components.push(
			component(directory, "composer", ["composer.json", "composer.lock"]),
		);
	}
	if (directory.files.has("go.mod")) {
		if (!directory.files.has("go.sum")) throw lockRequired(directory, "go.mod");
		components.push(component(directory, "go", ["go.mod", "go.sum"]));
	}
	if (directory.files.has("Cargo.toml")) {
		if (!directory.files.has("Cargo.lock")) {
			throw lockRequired(directory, "Cargo.toml");
		}
		components.push(
			component(directory, "cargo", ["Cargo.toml", "Cargo.lock"]),
		);
	}
	const dotnetProjects = [...directory.files].filter((file) =>
		file.endsWith(".csproj"),
	);
	const dotnetSolutions = [...directory.files].filter(
		(file) => file.endsWith(".sln") || file.endsWith(".slnx"),
	);
	if (dotnetProjects.length > 1 || dotnetSolutions.length > 1) {
		throw ambiguous(directory, "Multiple .NET entrypoints");
	}
	const dotnetManifest = dotnetProjects[0] ?? dotnetSolutions[0];
	if (dotnetManifest && dotnetProjects.length > 0) {
		if (!directory.files.has("packages.lock.json")) {
			throw lockRequired(directory, dotnetManifest);
		}
		components.push(
			component(directory, "dotnet", [dotnetManifest, "packages.lock.json"]),
		);
	} else if (dotnetManifest && directory.files.has("packages.lock.json")) {
		components.push(
			component(directory, "dotnet", [dotnetManifest, "packages.lock.json"]),
		);
	}
	if (directory.files.has("pom.xml")) {
		if (!directory.files.has("dependency-lock.xml")) {
			throw lockRequired(directory, "pom.xml");
		}
		components.push(
			component(directory, "maven", ["pom.xml", "dependency-lock.xml"]),
		);
	}
	const gradleManifest = directory.files.has("settings.gradle.kts")
		? "settings.gradle.kts"
		: directory.files.has("settings.gradle")
			? "settings.gradle"
			: directory.files.has("build.gradle.kts")
				? "build.gradle.kts"
				: directory.files.has("build.gradle")
					? "build.gradle"
					: null;
	if (gradleManifest) {
		if (
			!directory.files.has("gradle.lockfile") ||
			!directory.files.has("gradlew")
		) {
			throw lockRequired(directory, gradleManifest);
		}
		components.push(
			component(directory, "gradle", [
				gradleManifest,
				...["build.gradle.kts", "build.gradle"].filter(
					(file) => file !== gradleManifest && directory.files.has(file),
				),
				"gradle.lockfile",
				"gradlew",
			]),
		);
	}
	return components;
}

function assertDotnetSolutionsCovered(
	directories: DirectorySnapshot[],
	components: WorkspaceBootstrapComponent[],
) {
	for (const directory of directories) {
		const hasSolution = [...directory.files].some(
			(file) => file.endsWith(".sln") || file.endsWith(".slnx"),
		);
		if (!hasSolution || directory.files.has("packages.lock.json")) continue;
		const covered = components.some(
			(component) =>
				component.adapterId === "dotnet" &&
				component.rootRelativePath !== directory.relativePath &&
				isWithin(directory.relativePath, component.rootRelativePath),
		);
		if (!covered) throw lockRequired(directory, ".NET solution");
	}
}

function component(
	directory: DirectorySnapshot,
	adapterId: WorkspaceBootstrapAdapterId,
	files: string[],
): WorkspaceBootstrapComponent {
	return {
		adapterId,
		rootRelativePath: directory.relativePath,
		evidencePaths: files.map((file) =>
			directory.relativePath === "."
				? file
				: path.join(directory.relativePath, file),
		),
	};
}

function ambiguous(directory: DirectorySnapshot, message: string) {
	return new WorkspaceBootstrapError(
		"BOOTSTRAP_MANAGER_AMBIGUOUS",
		`${message} in ${directory.relativePath}.`,
		{
			stage: "detection",
			componentRoot: directory.relativePath,
			retryable: false,
		},
	);
}

function lockRequired(directory: DirectorySnapshot, manifest: string) {
	return new WorkspaceBootstrapError(
		"BOOTSTRAP_LOCK_REQUIRED",
		`${manifest} in ${directory.relativePath} has no supported lock evidence.`,
		{
			stage: "detection",
			componentRoot: directory.relativePath,
			retryable: false,
		},
	);
}

function pathDepth(relativePath: string) {
	return relativePath === "." ? 0 : relativePath.split(path.sep).length;
}

function isWithin(parent: string, candidate: string) {
	const relative = path.relative(parent, candidate);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}
