import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkDocsConsistency } from "../scripts/check-docs-consistency.mjs";
import { resetDemo, smokeDemo } from "../scripts/demo/support-ops-crm.mjs";
import { executeRelease } from "../scripts/release/create-release.mjs";
import {
	createArtifactManifest,
	verifyReleaseMetadata,
} from "../scripts/release/release-metadata.mjs";

const temporaryPaths: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryPaths
			.splice(0)
			.map((temporaryPath) =>
				rm(temporaryPath, { recursive: true, force: true }),
			),
	);
});

async function releaseFixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), "nightworkers-release-"));
	temporaryPaths.push(root);
	await mkdir(path.join(root, "src-tauri"), { recursive: true });
	await mkdir(path.join(root, "spec/release-notes"), { recursive: true });
	await writeFile(path.join(root, "package.json"), '{"version":"1.2.3"}\n');
	await writeFile(
		path.join(root, "src-tauri/tauri.conf.json"),
		'{"version":"1.2.3"}\n',
	);
	await writeFile(
		path.join(root, "CHANGELOG.md"),
		"# Changelog\n\n## [1.2.3] - 2026-07-10\n\n### Added\n- A\n\n### Changed\n- B\n\n### Fixed\n- C\n\n### Removed\n- D\n",
	);
	await writeFile(
		path.join(root, "spec/release-notes/1.2.3.md"),
		"# 1.2.3\n\n## Migration\nNone.\n\n## Rollback\nRestore.\n\n## Known Limitations\nKnown.\n\n## Desktop Support Matrix\nmacOS.\n",
	);
	return root;
}

describe("P3 release discipline", () => {
	it("rejects package and Tauri version drift", async () => {
		const root = await releaseFixture();
		await writeFile(
			path.join(root, "src-tauri/tauri.conf.json"),
			'{"version":"1.2.4"}\n',
		);
		const result = await verifyReleaseMetadata({ root });
		expect(result.errors.join("\n")).toContain(
			"does not match package.json 1.2.3",
		);
	});

	it("creates and validates versioned checksum metadata", async () => {
		const root = await releaseFixture();
		await writeFile(path.join(root, "NightWorkers-1.2.3.zip"), "artifact");
		const { outputPath, manifest } = await createArtifactManifest({
			root,
			artifactPath: "NightWorkers-1.2.3.zip",
			outputPath: "manifest.json",
			verificationStatus: "passed",
			signing: "verified",
			notarization: "verified",
		});
		expect(manifest.artifacts[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
		const result = await verifyReleaseMetadata({
			root,
			tag: "v1.2.3",
			manifestPath: path.relative(root, outputPath),
		});
		expect(result.errors).toEqual([]);
	});

	it("rejects an artifact that changed after its manifest was created", async () => {
		const root = await releaseFixture();
		const artifactPath = path.join(root, "NightWorkers-1.2.3.zip");
		await writeFile(artifactPath, "verified artifact");
		await createArtifactManifest({
			root,
			artifactPath,
			outputPath: "manifest.json",
			verificationStatus: "passed",
		});
		await writeFile(artifactPath, "tampered artifact with additional bytes");

		const result = await verifyReleaseMetadata({
			root,
			manifestPath: "manifest.json",
		});

		expect(result.errors).toEqual(
			expect.arrayContaining([
				"artifact size does not match file: NightWorkers-1.2.3.zip",
				"artifact sha256 does not match file: NightWorkers-1.2.3.zip",
			]),
		);
	});

	it("does not overwrite an artifact with its own manifest", async () => {
		const root = await releaseFixture();
		const artifactPath = path.join(root, "NightWorkers-1.2.3.zip");
		await writeFile(artifactPath, "artifact");

		await expect(
			createArtifactManifest({
				root,
				artifactPath,
				outputPath: "NightWorkers-1.2.3.zip",
				verificationStatus: "passed",
			}),
		).rejects.toThrow("must not overwrite the artifact");
		expect(await readFile(artifactPath, "utf8")).toBe("artifact");
	});

	it("never creates a tag after a failed release gate", () => {
		const run = vi.fn((command: string, args: string[]) => {
			if (command === "git" && args[0] === "status") {
				return { status: 0, stdout: "" };
			}
			if (command === "git" && args[0] === "rev-parse") {
				return { status: 0, stdout: "abc123\n" };
			}
			if (command === "git" && args[0] === "show-ref") {
				return { status: 1, stdout: "" };
			}
			return { status: 1, stdout: "" };
		});
		expect(() => executeRelease({ execute: true, tag: "v1.2.3", run })).toThrow(
			"tag was not created",
		);
		expect(run).not.toHaveBeenCalledWith(
			"git",
			expect.arrayContaining(["tag"]),
		);
	});

	it("rejects a dirty worktree before running the release gate", () => {
		const run = vi.fn(() => ({ status: 0, stdout: " M package.json\n" }));

		expect(() => executeRelease({ execute: true, tag: "v1.2.3", run })).toThrow(
			"requires a clean worktree",
		);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("tags the exact HEAD that passed release verification", () => {
		const run = vi.fn((command: string, args: string[]) => {
			if (command === "git" && args[0] === "status") {
				return { status: 0, stdout: "" };
			}
			if (command === "git" && args[0] === "rev-parse") {
				return { status: 0, stdout: "abc123\n" };
			}
			if (command === "git" && args[0] === "show-ref") {
				return { status: 1, stdout: "" };
			}
			return { status: 0, stdout: "" };
		});

		const result = executeRelease({ execute: true, tag: "v1.2.3", run });

		expect(result).toEqual({ tagged: true, verifiedHead: "abc123" });
		expect(run).toHaveBeenCalledWith("git", [
			"tag",
			"-a",
			"v1.2.3",
			"abc123",
			"-m",
			"NightWorkers v1.2.3",
		]);
	});
});

describe("P3 deterministic demo and docs", () => {
	it("executes every lifecycle stage and can reset all runtime data", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "nightworkers-demo-"));
		temporaryPaths.push(root);
		const result = await smokeDemo({ root, keep: true });
		expect(result.evidence.stages).toEqual([
			"project_registered",
			"plan_created",
			"queue_approved",
			"implementation_applied",
			"verification_passed",
			"review_completed",
		]);
		expect(result.evidence.verification.status).toBe("passed");
		const persisted = JSON.parse(
			await readFile(path.join(root, "evidence/review.json"), "utf8"),
		);
		expect(persisted.review.changedFiles).toEqual(["src/tickets.mjs"]);
		await resetDemo({ root });
		await expect(
			readFile(path.join(root, "evidence/review.json")),
		).rejects.toThrow();
	});

	it("refuses to reset a nonempty directory without demo ownership", async () => {
		const root = await mkdtemp(
			path.join(os.tmpdir(), "nightworkers-demo-unowned-"),
		);
		temporaryPaths.push(root);
		const userFile = path.join(root, "keep.txt");
		await writeFile(userFile, "keep");

		await expect(resetDemo({ root })).rejects.toThrow("unowned demo root");
		expect(await readFile(userFile, "utf8")).toBe("keep");
	});

	it("keeps documented commands, links, and archived P3 plans consistent", async () => {
		expect(await checkDocsConsistency()).toEqual([]);
	});
});
