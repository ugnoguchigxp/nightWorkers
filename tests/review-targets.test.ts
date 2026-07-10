import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { buildReviewTarget } from "../api/modules/review/review-targets.service";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("Review target extraction", () => {
	it("extracts run edit signals and excludes unrelated dirty files", async () => {
		const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nw-review-"));
		await git(repoRoot, "init");
		await fs.writeFile(path.join(repoRoot, "app.ts"), "export const a = 1;\n");
		await fs.writeFile(
			path.join(repoRoot, "other.ts"),
			"export const b = 1;\n",
		);
		await git(repoRoot, "add", ".");
		await git(
			repoRoot,
			"-c",
			"user.email=test@example.com",
			"-c",
			"user.name=Test",
			"commit",
			"-m",
			"init",
		);
		await fs.writeFile(path.join(repoRoot, "app.ts"), "export const a = 2;\n");
		await fs.writeFile(
			path.join(repoRoot, "other.ts"),
			"export const b = 2;\n",
		);
		const repository = await repo.createRepository({
			name: `review-targets-${Date.now()}`,
			localPath: repoRoot,
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "Review target task",
			description: "Task",
			objective: "Review target",
			acceptanceCriteria: "Target files are extracted",
			status: "completed",
		});
		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content:
				"# Feature Plan\n\n## Acceptance Criteria\n- app.ts changes work",
			messageType: "markdown_document",
			payloadJson: { intent: "feature_plan", title: "Feature Plan" },
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "completed",
			workerKind: "codex-agent",
			startedAt: new Date(),
			endedAt: new Date(),
			finishedAt: new Date(),
			diffPatch: "diff --git a/app.ts b/app.ts\n",
		});
		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			taskId: task.id,
			timestamp: new Date().toISOString(),
			type: "git.diff_collected",
			severity: "checkpoint",
			actor: "worker",
			message: "Diff collected",
			data: { provider: "codex", changedFiles: ["app.ts"] },
		});

		const target = await buildReviewTarget({ runId: run.id });

		expect(target.planArtifact.source).toBe("plan_artifact");
		expect(target.targetFiles.map((file) => file.path)).toEqual(["app.ts"]);
		expect(target.targetFiles[0]?.sources).toContain("codex_file_change");
		expect(target.excludedDirtyFiles).toContain("other.ts");
		expect(target.warnings.map((warning) => warning.code)).toContain(
			"current_diff_without_edit_signal",
		);
	});

	it("keeps untracked run-created files as added targets with diff content", async () => {
		const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nw-review-"));
		await git(repoRoot, "init");
		await fs.writeFile(path.join(repoRoot, "README.md"), "# Test\n");
		await git(repoRoot, "add", ".");
		await git(
			repoRoot,
			"-c",
			"user.email=test@example.com",
			"-c",
			"user.name=Test",
			"commit",
			"-m",
			"init",
		);
		await fs.mkdir(path.join(repoRoot, "src"));
		await fs.writeFile(
			path.join(repoRoot, "src/new.ts"),
			"export const n = 1;\n",
		);
		const repository = await repo.createRepository({
			name: `review-targets-added-${Date.now()}`,
			localPath: repoRoot,
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "Review added file task",
			description: "Task",
			objective: "Review added file",
			acceptanceCriteria: "Added files are diffed",
			status: "completed",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "completed",
			workerKind: "codex-agent",
			startedAt: new Date(),
			endedAt: new Date(),
			finishedAt: new Date(),
			diffPatch: "diff --git a/src/new.ts b/src/new.ts\n",
		});
		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			taskId: task.id,
			timestamp: new Date().toISOString(),
			type: "git.diff_collected",
			severity: "checkpoint",
			actor: "worker",
			message: "Diff collected",
			data: { provider: "codex", changedFiles: ["src/new.ts"] },
		});

		const target = await buildReviewTarget({ runId: run.id });

		expect(target.targetFiles[0]).toMatchObject({
			path: "src/new.ts",
			status: "added",
		});
		expect(target.targetFiles[0]?.diff).toContain("+export const n = 1;");
	});
});

async function git(cwd: string, ...args: string[]) {
	execFileSync("git", args, { cwd, stdio: "ignore" });
}
