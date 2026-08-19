import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseDocumentPaths = [
	"README.md",
	"README.ja.md",
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
const activeSpecificationDirectory = "spec/docs";
const archivedSpecificationDirectory = "spec/docs/.archived";
const legacyArchiveDirectories = ["spec/.archived", "spec/archive"];

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

function markdownStatusSection(markdown) {
	const statusHeading = /^## Status\s*$/m.exec(markdown);
	const statusStart = statusHeading
		? statusHeading.index + statusHeading[0].length
		: 0;
	const remaining = markdown.slice(statusStart);
	const nextHeading = remaining.search(/^##\s+/m);
	return nextHeading >= 0 ? remaining.slice(0, nextHeading) : remaining;
}

function htmlText(fragment) {
	return fragment
		.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, " ")
		.replace(/<[^>]+>/g, "\n")
		.replace(/&nbsp;/gi, " ")
		.replace(/&(?:amp|#38);/gi, "&")
		.replace(/&(?:lt|#60);/gi, "<")
		.replace(/&(?:gt|#62);/gi, ">")
		.replace(/&(?:quot|#34);/gi, '"')
		.replace(/&#39;|&apos;/gi, "'");
}

function htmlStatusSection(html) {
	const headings = [...html.matchAll(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi)];
	const selected =
		headings.find((match) => htmlText(match[0]).trim() === "Status") ?? headings[0];
	if (!selected || selected.index === undefined) return htmlText(html);
	const start = selected.index + selected[0].length;
	const nextHeading = html.slice(start).search(/<h2\b/i);
	return htmlText(nextHeading >= 0 ? html.slice(start, start + nextHeading) : html.slice(start));
}

function completedImplementationStatus(document, extension) {
	const status =
		extension === ".html" ? htmlStatusSection(document) : markdownStatusSection(document);
	return [
		/^\s*(?:-\s*)?Status:\s*`?(?:completed|complete|implemented)(?=[\s;`/(),-]|$)/im,
		/^\s*(?:-\s*)?Plan status:\s*`?(?:completed|complete|implemented)(?=[\s;`/(),-]|$)/im,
		/^\s*(?:-\s*)?Implementation status:\s*`?(?:completed|complete|implemented)(?=[\s;`/(),-]|$)/im,
		/^\s*(?:-\s*)?実装状態:\s*`?完了(?=[\s`（(]|$)/m,
	].some((pattern) => pattern.test(status));
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
			const absoluteTargetPath = path.resolve(root, targetPath);
			const rootRelativeTarget = path.relative(root, absoluteTargetPath);
			if (
				rootRelativeTarget === ".." ||
				rootRelativeTarget.startsWith(`..${path.sep}`) ||
				path.isAbsolute(rootRelativeTarget)
			) {
				errors.push(`${relativePath}: link escapes repository root ${target}`);
				continue;
			}
			if (!(await exists(absoluteTargetPath))) {
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

	const activeSpecificationRoot = path.join(root, activeSpecificationDirectory);
	if (await exists(activeSpecificationRoot)) {
		const entries = await readdir(activeSpecificationRoot, { withFileTypes: true });
		for (const entry of entries.sort((left, right) =>
			left.name.localeCompare(right.name),
		)) {
			if (!entry.isFile()) continue;
			const relativePath = path.join(activeSpecificationDirectory, entry.name);
			const extension = path.extname(entry.name);
			if (extension === ".md") {
				errors.push(`${relativePath}: design document must be converted to HTML`);
				continue;
			}
			if (
				extension === ".html" &&
				completedImplementationStatus(await read(relativePath), extension)
			) {
				errors.push(
					`${relativePath}: completed implementation document must move to ${archivedSpecificationDirectory}/`,
				);
			}
		}
	}

	const archivedSpecificationRoot = path.join(root, archivedSpecificationDirectory);
	if (await exists(archivedSpecificationRoot)) {
		const entries = await readdir(archivedSpecificationRoot, { withFileTypes: true });
		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			if (entry.isFile() && entry.name.endsWith(".md")) {
				errors.push(
					`${path.join(archivedSpecificationDirectory, entry.name)}: design document must be converted to HTML`,
				);
			}
		}
	}

	for (const legacyArchiveDirectory of legacyArchiveDirectories) {
		if (await exists(path.join(root, legacyArchiveDirectory))) {
			errors.push(
				`${legacyArchiveDirectory}/: legacy archive directory must be renamed to ${archivedSpecificationDirectory}/`,
			);
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
