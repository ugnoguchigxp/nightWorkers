import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	evaluateFrontendBundle,
	frontendBundleBudgets,
} from "../scripts/check-frontend-bundle.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { force: true, recursive: true });
	}
});

describe("frontend bundle budget", () => {
	it("measures nested chunks and keeps deferred viewers out of the initial load", () => {
		const distRoot = createBundle({
			indexHtml: [
				'<script type="module" src="/assets/index.js"></script>',
				'<link rel="modulepreload" href="/assets/shared/vendor.js">',
			].join("\n"),
			assets: {
				"index.js": 100,
				"shared/vendor.js": 80,
				"ArtifactPane-lazy.js": 120,
			},
		});

		const result = evaluateFrontendBundle({ distRoot });

		expect(result).toMatchObject({
			ok: true,
			initialJsBytes: 180,
			jsAssetCount: 3,
			totalJsBytes: 300,
		});
		expect(result.initialAssetPaths).toEqual([
			"assets/index.js",
			"assets/shared/vendor.js",
		]);
	});

	it("rejects deferred viewers in the initial load and application chunk growth", () => {
		const oversizedBytes = frontendBundleBudgets.maxApplicationChunkBytes + 1;
		const distRoot = createBundle({
			indexHtml:
				'<script type="module" src="/assets/ArtifactPane-initial.js"></script>',
			assets: { "ArtifactPane-initial.js": oversizedBytes },
		});

		const result = evaluateFrontendBundle({ distRoot });

		expect(result.ok).toBe(false);
		expect(result.errors).toContain(
			"Deferred JavaScript entered the initial load: assets/ArtifactPane-initial.js",
		);
		expect(
			result.errors.some((message) =>
				message.includes("largest application chunk is"),
			),
		).toBe(true);
	});

	it("fails closed when the index has no JavaScript entry", () => {
		const distRoot = createBundle({
			indexHtml: "<html><body></body></html>",
			assets: { "orphan.js": 10 },
		});

		const result = evaluateFrontendBundle({ distRoot });

		expect(result.ok).toBe(false);
		expect(result.errors).toContain(
			"Frontend index does not reference an initial JavaScript entry.",
		);
	});

	it("fails closed when every JavaScript asset is an exempted vendor chunk", () => {
		const distRoot = createBundle({
			indexHtml:
				'<script type="module" src="/assets/chunk-KEIR6QF5-only.js"></script>',
			assets: { "chunk-KEIR6QF5-only.js": 10 },
		});

		const result = evaluateFrontendBundle({ distRoot });

		expect(result.ok).toBe(false);
		expect(result.errors).toContain(
			"Frontend bundle does not contain an application JavaScript chunk.",
		);
	});
});

function createBundle({
	indexHtml,
	assets,
}: {
	indexHtml: string;
	assets: Record<string, number>;
}) {
	const distRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "nightworkers-frontend-bundle-"),
	);
	temporaryDirectories.push(distRoot);
	fs.mkdirSync(path.join(distRoot, "assets"), { recursive: true });
	fs.writeFileSync(path.join(distRoot, "index.html"), indexHtml);
	for (const [assetPath, bytes] of Object.entries(assets)) {
		const absolutePath = path.join(distRoot, "assets", assetPath);
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
		fs.writeFileSync(absolutePath, Buffer.alloc(bytes));
	}
	return distRoot;
}
