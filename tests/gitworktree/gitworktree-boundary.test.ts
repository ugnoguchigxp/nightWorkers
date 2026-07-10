import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(target);
		return /\.(ts|tsx)$/.test(entry.name) ? [target] : [];
	});
}

describe("gitworktree module boundary", () => {
	it("removes the former NightWorkers and generic service locations", () => {
		for (const relativePath of [
			"api/modules/nightworkers/nightworkers.worktrees.service.ts",
			"api/modules/nightworkers/worktree.routes.ts",
			"api/services/git-worktree/git-worktree-cli.ts",
			"api/services/git-worktree/git-worktree-parser.ts",
			"src/modules/nightworkers/components/project-detail/ProjectDetailWorktrees.tsx",
			"shared/schemas/git-worktree.schema.ts",
		]) {
			expect(existsSync(path.join(root, relativePath)), relativePath).toBe(
				false,
			);
		}
	});

	it("keeps the domain independent from NightWorkers implementation imports", () => {
		const files = [
			...sourceFiles(path.join(root, "api/modules/gitworktree")),
			...sourceFiles(path.join(root, "src/modules/gitworktree")),
		];
		const forbiddenImports = files.flatMap((file) => {
			const source = readFileSync(file, "utf8");
			return /from\s+["'][^"']*nightworkers[^"']*["']/i.test(source)
				? [path.relative(root, file)]
				: [];
		});

		expect(forbiddenImports).toEqual([]);
	});

	it("mounts the API router and Project Detail panel through public module paths", () => {
		const appSource = readFileSync(path.join(root, "api/app.ts"), "utf8");
		const projectDetailSource = readFileSync(
			path.join(
				root,
				"src/modules/nightworkers/components/ProjectDetailScreen.tsx",
			),
			"utf8",
		);

		expect(appSource).toContain(
			'from "./modules/gitworktree/gitworktree.routes"',
		);
		expect(projectDetailSource).toContain(
			'import { ProjectDetailWorktrees } from "../../gitworktree"',
		);
	});

	it("owns all worktree client commands outside nightWorkersCommands", () => {
		const domainCommands = readFileSync(
			path.join(root, "src/modules/gitworktree/api/gitworktreeCommands.ts"),
			"utf8",
		);
		const nightworkersCommands = readFileSync(
			path.join(root, "src/modules/nightworkers/nightWorkersCommands.ts"),
			"utf8",
		);

		expect(domainCommands).toContain("fetchRepositoryWorktrees");
		expect(domainCommands).toContain("/worktrees/prune-preview");
		expect(domainCommands).toContain("/worktrees/advice");
		expect(nightworkersCommands).not.toContain("fetchRepositoryWorktrees");
		expect(nightworkersCommands).not.toContain("createRepositoryWorktree");
	});
});
