import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import {
	appendFinalResponseEvidence,
	bindEvidenceSubject,
	getLatestFinalResponseEvidence,
} from "../api/modules/evidenceLedger";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("Final Response Evidence", () => {
	it("records the same response again when its Evidence Subject becomes canonical", async () => {
		const repository = await repo.createRepository({
			name: `TEST: final response binding ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: final response binding",
		});
		if (!task.currentRevisionSnapshotId)
			throw new Error("Task revision snapshot is missing");
		const revisionSnapshot = await repo.getTaskRevisionSnapshot(
			task.currentRevisionSnapshotId,
		);
		if (!revisionSnapshot) throw new Error("Task revision snapshot is missing");
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			taskRevisionSnapshotId: task.currentRevisionSnapshotId,
			taskRevision: task.revision,
			taskDigest: revisionSnapshot.digest,
			status: "completed",
			finalReport: "同じ完了報告",
		});
		const legacy = await getLatestFinalResponseEvidence(run.id);
		expect(legacy).toMatchObject({
			bindingStatus: "legacy_unbound",
			subjectId: null,
			revision: 1,
		});

		const subject = await bindEvidenceSubject({
			taskId: task.id,
			runId: run.id,
			sourceStateHash: "source-state-1",
		});
		expect(subject?.bindingStatus).toBe("canonical");
		const canonical = await appendFinalResponseEvidence({
			taskId: task.id,
			runId: run.id,
			content: "同じ完了報告",
		});

		expect(canonical).toMatchObject({
			bindingStatus: "canonical",
			subjectId: subject?.id,
			revision: 2,
		});
		expect((await getLatestFinalResponseEvidence(run.id))?.id).toBe(
			canonical?.id,
		);
	});

	it("rejects a Task/Run mismatch", async () => {
		const repository = await repo.createRepository({
			name: `TEST: final response mismatch ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const [task, otherTask] = await Promise.all([
			repo.createTask({
				repositoryId: repository.id,
				title: "TEST: response owner",
			}),
			repo.createTask({
				repositoryId: repository.id,
				title: "TEST: wrong response owner",
			}),
		]);
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
		});

		await expect(
			appendFinalResponseEvidence({
				taskId: otherTask.id,
				runId: run.id,
				content: "wrong owner",
			}),
		).rejects.toThrow("run/task mismatch");
	});

	it("preserves both responses written concurrently", async () => {
		const repository = await repo.createRepository({
			name: `TEST: concurrent final responses ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: concurrent final responses",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
		});

		const results = await Promise.all([
			appendFinalResponseEvidence({
				taskId: task.id,
				runId: run.id,
				content: "response A",
			}),
			appendFinalResponseEvidence({
				taskId: task.id,
				runId: run.id,
				content: "response B",
			}),
		]);

		expect(new Set(results.map((item) => item?.content))).toEqual(
			new Set(["response A", "response B"]),
		);
		expect(new Set(results.map((item) => item?.revision))).toEqual(
			new Set([1, 2]),
		);
	});
});
