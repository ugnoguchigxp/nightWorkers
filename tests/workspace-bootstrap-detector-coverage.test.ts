import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectWorkspaceBootstrapComponents } from "../api/modules/gitworktree/workspace-bootstrap/detector";

const temporaryDirectories: string[] = [];

async function fixture(files: Record<string, string>) {
	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), "nw-detector-coverage-"),
	);
	temporaryDirectories.push(root);
	for (const [relativePath, content] of Object.entries(files)) {
		const target = path.join(root, relativePath);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, content);
	}
	return root;
}

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0))
		await fs.rm(directory, { recursive: true, force: true });
});

describe("workspace bootstrap detector coverage", () => {
	it("detects every JavaScript lockfile family and optional evidence file", async () => {
		for (const [lockfile, adapterId, optional] of [
			["bun.lockb", "bun", "bunfig.toml"],
			["package-lock.json", "npm", ".npmrc"],
			["npm-shrinkwrap.json", "npm", ".npmrc"],
			["pnpm-lock.yaml", "pnpm", "pnpm-workspace.yaml"],
			["yarn.lock", "yarn", ".yarnrc.yml"],
		] as const) {
			const root = await fixture({
				"package.json": JSON.stringify({
					packageManager: `${adapterId}@1.0.0`,
				}),
				[lockfile]: "lock",
				[optional]:
					optional === "pnpm-workspace.yaml" ? "packages: []\n" : "config",
			});
			const result = await detectWorkspaceBootstrapComponents(root);
			expect(result[0]).toMatchObject({ adapterId, rootRelativePath: "." });
			expect(result[0].evidencePaths).toContain(optional);
		}
	});

	it("parses pnpm workspace inclusions, exclusions, quotes, and comments", async () => {
		const root = await fixture({
			"package.json": JSON.stringify({ name: "root" }),
			"pnpm-lock.yaml": "lockfileVersion: 9",
			"pnpm-workspace.yaml": [
				"# comment",
				"packages:",
				"  - 'packages/**'",
				'  - "apps/?eb"',
				"  - '!packages/private/*'",
				"catalog:",
				"  react: latest",
			].join("\n"),
			"packages/ui/package.json": "{}",
			"packages/nested/core/package.json": "{}",
			"packages/private/secret/package.json": "{}",
			"packages/private/secret/yarn.lock": "lock",
			"apps/web/package.json": "{}",
		});
		const result = await detectWorkspaceBootstrapComponents(root);
		const pnpm = result.find((component) => component.adapterId === "pnpm")!;
		expect(pnpm.evidencePaths).toContain(
			path.join("packages", "ui", "package.json"),
		);
		expect(pnpm.evidencePaths).toContain(
			path.join("packages", "nested", "core", "package.json"),
		);
		expect(pnpm.evidencePaths).toContain(
			path.join("apps", "web", "package.json"),
		);
		expect(pnpm.evidencePaths).not.toContain(
			path.join("packages", "private", "secret", "package.json"),
		);
		expect(
			result.find((component) => component.adapterId === "yarn")
				?.rootRelativePath,
		).toBe(path.join("packages", "private", "secret"));
	});

	it("supports object-form workspaces and excludes independently locked nested roots", async () => {
		const root = await fixture({
			"package.json": JSON.stringify({
				workspaces: { packages: ["packages/*", "", 2] },
			}),
			"yarn.lock": "lock",
			"packages/ui/package.json": "{}",
			"packages/api/package.json": JSON.stringify({ workspaces: ["sub"] }),
			"packages/api/package-lock.json": "{}",
			"packages/api/sub/package.json": "{}",
		});
		const result = await detectWorkspaceBootstrapComponents(root);
		const yarn = result.find((component) => component.adapterId === "yarn")!;
		expect(yarn.evidencePaths).toContain(
			path.join("packages", "ui", "package.json"),
		);
		expect(yarn.evidencePaths).not.toContain(
			path.join("packages", "api", "package.json"),
		);
		expect(result.some((component) => component.adapterId === "npm")).toBe(
			true,
		);
	});

	it("detects all locked non-JavaScript ecosystems in one workspace", async () => {
		const root = await fixture({
			"python/uv/pyproject.toml": "[project]",
			"python/uv/uv.lock": "lock",
			"python/poetry/pyproject.toml": "[tool.poetry]",
			"python/poetry/poetry.lock": "lock",
			"python/pip/requirements.lock": "lock",
			"ruby/Gemfile": "source 'x'",
			"ruby/Gemfile.lock": "lock",
			"php/composer.json": "{}",
			"php/composer.lock": "{}",
			"go/go.mod": "module x",
			"go/go.sum": "sum",
			"rust/Cargo.toml": "[package]",
			"rust/Cargo.lock": "lock",
			"java/maven/pom.xml": "<project />",
			"java/maven/dependency-lock.xml": "<lock />",
			"java/gradle/settings.gradle.kts": "rootProject.name='x'",
			"java/gradle/build.gradle.kts": "plugins {}",
			"java/gradle/build.gradle": "plugins {}",
			"java/gradle/gradle.lockfile": "lock",
			"java/gradle/gradlew": "#!/bin/sh",
		});
		const result = await detectWorkspaceBootstrapComponents(root);
		expect(new Set(result.map((component) => component.adapterId))).toEqual(
			new Set([
				"uv",
				"poetry",
				"pip",
				"bundler",
				"composer",
				"go",
				"cargo",
				"maven",
				"gradle",
			]),
		);
		const gradle = result.find(
			(component) => component.adapterId === "gradle",
		)!;
		expect(gradle.evidencePaths).toContain(
			path.join("java", "gradle", "build.gradle"),
		);
	});

	it("accepts Gradle manifest fallbacks", async () => {
		for (const manifest of [
			"settings.gradle",
			"build.gradle.kts",
			"build.gradle",
		] as const) {
			const root = await fixture({
				[manifest]: "build",
				"gradle.lockfile": "lock",
				gradlew: "wrapper",
			});
			await expect(
				detectWorkspaceBootstrapComponents(root),
			).resolves.toMatchObject([
				{ adapterId: "gradle", rootRelativePath: "." },
			]);
		}
	});

	it("detects locked .NET project and solution forms", async () => {
		let root = await fixture({
			"App.csproj": "<Project />",
			"packages.lock.json": "{}",
		});
		await expect(
			detectWorkspaceBootstrapComponents(root),
		).resolves.toMatchObject([{ adapterId: "dotnet" }]);
		root = await fixture({
			"App.slnx": "solution",
			"packages.lock.json": "{}",
		});
		await expect(
			detectWorkspaceBootstrapComponents(root),
		).resolves.toMatchObject([{ adapterId: "dotnet" }]);
	});

	it("rejects ambiguous Python and .NET entrypoints", async () => {
		let root = await fixture({
			"pyproject.toml": "[project]",
			"uv.lock": "lock",
			"poetry.lock": "lock",
		});
		await expect(
			detectWorkspaceBootstrapComponents(root),
		).rejects.toMatchObject({ code: "BOOTSTRAP_MANAGER_AMBIGUOUS" });
		root = await fixture({
			"A.csproj": "",
			"B.csproj": "",
			"packages.lock.json": "{}",
		});
		await expect(
			detectWorkspaceBootstrapComponents(root),
		).rejects.toMatchObject({ code: "BOOTSTRAP_MANAGER_AMBIGUOUS" });
		root = await fixture({
			"A.sln": "",
			"B.slnx": "",
			"packages.lock.json": "{}",
		});
		await expect(
			detectWorkspaceBootstrapComponents(root),
		).rejects.toMatchObject({ code: "BOOTSTRAP_MANAGER_AMBIGUOUS" });
	});

	it("rejects every unlocked ecosystem and incomplete Gradle wrapper", async () => {
		for (const manifest of [
			"pyproject.toml",
			"Gemfile",
			"composer.json",
			"go.mod",
			"Cargo.toml",
			"pom.xml",
			"build.gradle",
		] as const) {
			const root = await fixture({ [manifest]: "manifest" });
			await expect(
				detectWorkspaceBootstrapComponents(root),
			).rejects.toMatchObject({ code: "BOOTSTRAP_LOCK_REQUIRED" });
		}
		const root = await fixture({
			"settings.gradle.kts": "build",
			"gradle.lockfile": "lock",
		});
		await expect(
			detectWorkspaceBootstrapComponents(root),
		).rejects.toMatchObject({ code: "BOOTSTRAP_LOCK_REQUIRED" });
	});

	it("rejects uncovered solutions, invalid manifests, and manager declarations without versions", async () => {
		let root = await fixture({ "App.sln": "solution" });
		await expect(
			detectWorkspaceBootstrapComponents(root),
		).rejects.toMatchObject({ code: "BOOTSTRAP_LOCK_REQUIRED" });
		root = await fixture({ "package.json": "not-json", "bun.lock": "lock" });
		await expect(
			detectWorkspaceBootstrapComponents(root),
		).rejects.toMatchObject({ code: "DEPENDENCY_STATE_INVALID" });
		root = await fixture({
			"package.json": JSON.stringify({ packageManager: "bun" }),
			"bun.lock": "lock",
		});
		await expect(
			detectWorkspaceBootstrapComponents(root),
		).resolves.toMatchObject([{ adapterId: "bun" }]);
		root = await fixture({
			"package.json": JSON.stringify({ packageManager: 2 }),
			"bun.lock": "lock",
		});
		await expect(
			detectWorkspaceBootstrapComponents(root),
		).resolves.toMatchObject([{ adapterId: "bun" }]);
	});

	it("ignores dependency/build directories and stops scanning below depth three", async () => {
		const root = await fixture({
			"node_modules/pkg/package.json": "{}",
			"node_modules/pkg/yarn.lock": "lock",
			"a/b/c/d/package.json": "{}",
			"a/b/c/d/package-lock.json": "lock",
		});
		await expect(detectWorkspaceBootstrapComponents(root)).resolves.toEqual([]);
	});
});
