import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { buildTestEvidencePrecheck } from "../api/modules/nightworkers/nightworkers.review-mode.test-evidence-precheck";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("buildTestEvidencePrecheck", () => {
	it("extracts acceptance criteria and test-name candidates without producing findings", async () => {
		const repoDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "nightworkers-precheck-"),
		);
		await fs.mkdir(path.join(repoDir, "tests"), { recursive: true });
		await fs.writeFile(
			path.join(repoDir, "tests/routes.test.ts"),
			'import { describe, it } from "vitest";\ndescribe("routes", () => {\n  it("ルート A が保存される", () => {});\n});\n',
			"utf-8",
		);
		const repository = await repo.createRepository({
			name: `TEST: Precheck ${crypto.randomUUID()}`,
			localPath: repoDir,
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "Precheck task",
			objective: "Check test names",
			acceptanceCriteria: "",
			status: "completed",
		});
		await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			messageType: "markdown_document",
			content:
				"# Feature Plan\n\n## 受け入れ条件\n- ルート A が保存される\n- 月次レポート CSV を送信できる",
			payloadJson: {
				intent: "feature_plan",
				markdownDocumentData: {
					title: "Feature Plan",
					content:
						"# Feature Plan\n\n## 受け入れ条件\n- ルート A が保存される\n- 月次レポート CSV を送信できる",
				},
			},
		});

		const result = await buildTestEvidencePrecheck({
			taskId: task.id,
			repositoryId: repository.id,
		});

		expect(result).toMatchObject({
			planFound: true,
			planTitle: "Feature Plan",
			testFilesScanned: 1,
			testNamesScanned: 2,
		});
		expect(result.matches[0]).toMatchObject({
			criterion: "ルート A が保存される",
			matched: true,
			candidates: [{ filePath: "tests/routes.test.ts", lineNumber: 3 }],
		});
		expect(result.matches[1]).toMatchObject({
			criterion: "月次レポート CSV を送信できる",
			matched: false,
		});
		expect(result).not.toHaveProperty("findings");
	});
});
