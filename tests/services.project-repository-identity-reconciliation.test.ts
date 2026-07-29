import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories } from "../api/db/schema";
import { createRepository } from "../api/modules/nightworkers/nightworkers.repository";
import {
	applyProjectRepositoryIdentityBackfill,
	previewProjectRepositoryIdentityBackfill,
} from "../api/services/git/project-repository-identity-reconciliation";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("project repository identity reconciliation", () => {
	it("previews a materialized Project without mutating the stored identity", async () => {
		const root = await fs.mkdtemp(
			path.join(os.tmpdir(), "nw-identity-preview-"),
		);
		const project = await createRepository({
			name: `TEST: identity preview ${crypto.randomUUID()}`,
			localPath: root,
			branch: "main",
		});
		expect(project.repositoryIdentityStatus).toBe("materialization_pending");
		execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });
		await fs.writeFile(path.join(root, "README.md"), "# fixture\n", "utf-8");
		execFileSync("git", ["-C", root, "add", "README.md"], { stdio: "ignore" });
		execFileSync(
			"git",
			[
				"-C",
				root,
				"-c",
				"user.name=NightWorkers Test",
				"-c",
				"user.email=nightworkers@example.test",
				"commit",
				"-m",
				"fixture",
			],
			{ stdio: "ignore" },
		);

		const [preview] = await previewProjectRepositoryIdentityBackfill(
			project.id,
		);

		expect(preview.needsBackfill).toBe(true);
		expect(preview.observed.status).toBe("ready");
		expect(preview.expected.status).toBe("materialization_pending");
		expect(project.repositoryIdentityRevision).toBe(1);
		const updated = await applyProjectRepositoryIdentityBackfill({
			repositoryId: project.id,
			expectedRevision: project.repositoryIdentityRevision,
		});
		expect(updated.repositoryIdentityStatus).toBe("ready");
		expect(updated.repositoryIdentityRevision).toBe(2);
		const [stored] = await db
			.select()
			.from(repositories)
			.where(eq(repositories.id, project.id));
		expect(stored.repositoryIdentityDigest).toBe(preview.observed.digest);
		expect(stored).toMatchObject({
			baseWorktreeBranch: "main",
			baseWorktreeHeadSha: preview.observed.observedHeadSha,
			baseWorktreeDirty: false,
		});
		await fs.rm(root, { recursive: true, force: true });
	});
});
