import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

export const frontendBundleBudgets = Object.freeze({
	initialJsBytes: 850 * 1024,
	maxApplicationChunkBytes: 600 * 1024,
	maxChunkBytes: 700 * 1024,
	totalJsBytes: 6.25 * 1024 * 1024,
});

const knownLargeVendorPrefixes = ["chunk-KEIR6QF5-"];
const deferredInitialAssetPrefixes = [
	"ArtifactPane-",
	"PlanModeWorkspaceViewer-",
	"planMode-",
	"ReviewStatusViewer-",
	"review-",
	"OverviewScreen-",
	"queue-",
	"ProjectDetailScreen-",
	"SettingsScreen-",
	"NightWorkersShellThreadPanel-",
	"blueprint-preview-",
	"cytoscape.",
	"katex-",
	"mermaid.",
	"mermaid-parser.",
	...knownLargeVendorPrefixes,
];

export function evaluateFrontendBundle({
	distRoot = path.join(repoRoot, "dist"),
	budgets = frontendBundleBudgets,
} = {}) {
	const assetsRoot = path.join(distRoot, "assets");
	const indexPath = path.join(distRoot, "index.html");
	const errors = [];
	if (!fs.existsSync(indexPath) || !fs.existsSync(assetsRoot)) {
		return {
			ok: false,
			errors: [
				"Frontend bundle is missing. Run the production Vite build first.",
			],
		};
	}

	const jsAssets = listJavaScriptAssets(assetsRoot);
	if (jsAssets.length === 0) {
		return {
			ok: false,
			errors: ["Frontend bundle does not contain any JavaScript assets."],
		};
	}

	const indexHtml = fs.readFileSync(indexPath, "utf8");
	const initialAssetPaths = new Set(
		[
			...indexHtml.matchAll(
				/(?:src|href)=["']\/(assets\/[^"']+\.js)["']/g,
			),
		].map((match) => match[1]),
	);
	if (initialAssetPaths.size === 0) {
		errors.push("Frontend index does not reference an initial JavaScript entry.");
	}

	let initialJsBytes = 0;
	for (const assetPath of initialAssetPaths) {
		const absolutePath = path.join(distRoot, assetPath);
		if (!fs.existsSync(absolutePath)) {
			errors.push(`Initial JavaScript asset is missing: ${assetPath}`);
			continue;
		}
		initialJsBytes += fs.statSync(absolutePath).size;
	}
	const unexpectedlyInitial = [...initialAssetPaths].filter((assetPath) =>
		deferredInitialAssetPrefixes.some((prefix) =>
			path.basename(assetPath).startsWith(prefix),
		),
	);
	if (unexpectedlyInitial.length > 0) {
		errors.push(
			`Deferred JavaScript entered the initial load: ${unexpectedlyInitial.join(", ")}`,
		);
	}

	const totalJsBytes = jsAssets.reduce(
		(total, asset) => total + asset.bytes,
		0,
	);
	const largestChunk = largestAsset(jsAssets);
	const applicationAssets = jsAssets.filter(
		(asset) =>
			!knownLargeVendorPrefixes.some((prefix) =>
				path.basename(asset.name).startsWith(prefix),
			),
	);
	if (applicationAssets.length === 0) {
		errors.push("Frontend bundle does not contain an application JavaScript chunk.");
	}
	const largestApplicationChunk = largestAsset(applicationAssets);
	const checks = [
		["initial JavaScript", initialJsBytes, budgets.initialJsBytes],
		[
			"largest application chunk",
			largestApplicationChunk.bytes,
			budgets.maxApplicationChunkBytes,
		],
		["largest chunk", largestChunk.bytes, budgets.maxChunkBytes],
		["total JavaScript", totalJsBytes, budgets.totalJsBytes],
	];
	for (const [label, actual, budget] of checks) {
		if (actual > budget) {
			errors.push(
				`${label} is ${formatBytes(actual)} (budget ${formatBytes(budget)})`,
			);
		}
	}

	return {
		ok: errors.length === 0,
		budgets,
		checks,
		errors,
		initialAssetPaths: [...initialAssetPaths],
		initialJsBytes,
		jsAssetCount: jsAssets.length,
		totalJsBytes,
		largestApplicationChunk,
		largestChunk,
	};
}

function listJavaScriptAssets(directory, relativeDirectory = "") {
	return fs
		.readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const relativePath = path.join(relativeDirectory, entry.name);
			const absolutePath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				return listJavaScriptAssets(absolutePath, relativePath);
			}
			return entry.isFile() && entry.name.endsWith(".js")
				? [{ name: relativePath, bytes: fs.statSync(absolutePath).size }]
				: [];
		});
}

function largestAsset(assets) {
	return assets.reduce(
		(largest, asset) => (asset.bytes > largest.bytes ? asset : largest),
		{ name: "(none)", bytes: 0 },
	);
}

function formatBytes(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function main() {
	const result = evaluateFrontendBundle();
	if (result.checks) {
		for (const [label, actual, budget] of result.checks) {
			console.log(
				`[frontend] ${label}: ${formatBytes(actual)} / ${formatBytes(budget)}`,
			);
		}
		console.log(
			`[frontend] largest chunk file: assets/${result.largestChunk.name}; application: assets/${result.largestApplicationChunk.name}; initial files: ${result.initialAssetPaths.length}`,
		);
	}
	if (!result.ok) {
		throw new Error(`Frontend bundle budget failed:\n- ${result.errors.join("\n- ")}`);
	}
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	main();
}
