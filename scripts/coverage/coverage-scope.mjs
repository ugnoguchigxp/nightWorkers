import path from "node:path";

// These roots define both instrumentation and report partitioning.
export const coverageSourceRoots = {
	backend: [
		"api/",
		"shared/",
		"packages/mission-pilot/src/backend/",
		"packages/mission-pilot/src/contracts/",
	],
	frontend: ["src/", "packages/mission-pilot/src/frontend/"],
};

export function coverageSegmentFor(file, repositoryRoot) {
	const relative = path
		.relative(repositoryRoot, file)
		.split(path.sep)
		.join("/");
	return (
		Object.entries(coverageSourceRoots).find(([, roots]) =>
			roots.some((root) => relative.startsWith(root)),
		)?.[0] ?? null
	);
}

export function assertCoverageScope(files, repositoryRoot, segment) {
	const relativeFiles = files.map((file) =>
		path.relative(repositoryRoot, file).split(path.sep).join("/"),
	);
	const missing = coverageSourceRoots[segment].filter(
		(root) => !relativeFiles.some((file) => file.startsWith(root)),
	);
	if (missing.length)
		throw new Error(
			`Coverage is missing production roots: ${missing.join(", ")}`,
		);
}
