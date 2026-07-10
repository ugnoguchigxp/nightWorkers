import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseDocumentPaths = [
	"README.md",
	"CHANGELOG.md",
	"CONTRIBUTING.md",
	"SECURITY.md",
	"SUPPORT.md",
	"spec/feature-tour.md",
	"spec/first-run-orientation.md",
	"spec/adoption-checklist.md",
	"spec/configuration.md",
	"demo/support-ops-crm/README.md",
];

const exists = async (filePath) => {
	try {
		await stat(filePath);
		return true;
	} catch {
		return false;
	}
};

function slugify(heading) {
	return heading
		.trim()
		.toLowerCase()
		.replace(/[`*_~]/g, "")
		.replace(/[^\p{L}\p{N}\s-]/gu, "")
		.replace(/\s/g, "-");
}

function collectAnchors(markdown) {
	return new Set(
		[...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => slugify(match[1])),
	);
}

function localLinks(markdown) {
	return [...markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
		.map((match) => match[1].trim().replace(/^<|>$/g, ""))
		.filter((target) => !/^(?:https?:|mailto:|app:)/.test(target));
}

export async function checkDocsConsistency(options = {}) {
	const root = options.root ?? repoRoot;
	const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
	const documentPaths = options.documentPaths ?? [
		...baseDocumentPaths,
		`spec/release-notes/${packageJson.version}.md`,
	];
	const errors = [];
	const cache = new Map();
	const read = async (relativePath) => {
		if (!cache.has(relativePath)) {
			cache.set(relativePath, await readFile(path.join(root, relativePath), "utf8"));
		}
		return cache.get(relativePath);
	};

	for (const relativePath of documentPaths) {
		if (!(await exists(path.join(root, relativePath)))) {
			errors.push(`${relativePath}: document is missing`);
			continue;
		}
		const markdown = await read(relativePath);
		for (const commandMatch of markdown.matchAll(/\bbun run ([A-Za-z0-9:_-]+)/g)) {
			const command = commandMatch[1];
			if (!packageJson.scripts?.[command]) {
				errors.push(`${relativePath}: bun run ${command} is not defined in package.json`);
			}
		}

		for (const target of localLinks(markdown)) {
			const [pathname, rawAnchor] = target.split("#", 2);
			const targetPath = pathname
				? path.normalize(path.join(path.dirname(relativePath), decodeURIComponent(pathname)))
				: relativePath;
			if (!(await exists(path.join(root, targetPath)))) {
				errors.push(`${relativePath}: broken link ${target}`);
				continue;
			}
			if (rawAnchor && targetPath.endsWith(".md")) {
				const anchors = collectAnchors(await read(targetPath));
				if (!anchors.has(decodeURIComponent(rawAnchor).toLowerCase())) {
					errors.push(`${relativePath}: broken anchor ${target}`);
				}
			}
		}
	}

	for (const completed of [
		"p0-01-desktop-sidecar-startup-implementation-plan.md",
		"p0-02-sanitize-html-critical-implementation-plan.md",
		"p0-03-high-critical-dependencies-implementation-plan.md",
		"p0-04-ci-foundation-implementation-plan.md",
		"p0-05-release-verification-gate-implementation-plan.md",
		"p1-01-pricing-table-pagination-implementation-plan.md",
		"p1-02-timeline-virtualization-implementation-plan.md",
		"p1-03-coverage-measurement-implementation-plan.md",
		"p1-04-critical-branch-coverage-implementation-plan.md",
		"p1-05-core-workflow-e2e-implementation-plan.md",
		"p1-06-desktop-os-ci-implementation-plan.md",
		"p1-07-non-loopback-security-implementation-plan.md",
		"p2-01-frontend-boundary-refactor-implementation-plan.md",
		"p2-02-backend-boundary-refactor-implementation-plan.md",
		"p2-03-durable-queue-lease-implementation-plan.md",
		"p2-04-worker-process-isolation-implementation-plan.md",
		"p2-05-accessibility-automation-implementation-plan.md",
		"p2-06-dependency-update-automation-implementation-plan.md",
		"p3-01-release-discipline-implementation-plan.md",
		"p3-02-demo-and-doc-sync-implementation-plan.md",
	]) {
		if (await exists(path.join(root, "spec/docs", completed))) {
			errors.push(`completed plan is still in spec/docs: ${completed}`);
		}
		if (!(await exists(path.join(root, "spec/archive", completed)))) {
			errors.push(`completed plan is missing from spec/archive: ${completed}`);
		}
	}

	return errors;
}

async function main() {
	const errors = await checkDocsConsistency();
	if (errors.length > 0) {
		for (const error of errors) console.error(`[docs] ${error}`);
		process.exit(1);
	}
	console.log(`[docs] ${baseDocumentPaths.length + 1} documents are consistent`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
