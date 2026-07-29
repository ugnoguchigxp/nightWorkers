import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import * as verificationRepo from "../api/modules/nightworkers/nightworkers.verification.repository";
import { buildCommandLevelEvidence } from "../api/services/verification/normalized-evidence";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("Verification Evidence immutability", () => {
	it("accepts an identical retry and rejects reuse with changed results", async () => {
		const repository = await repo.createRepository({
			name: `TEST: immutable evidence ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: immutable verification evidence",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
		});
		const base = {
			runId: run.id,
			taskId: task.id,
			command: "bun test",
			cwd: repository.localPath,
			startedAt: "2026-07-29T00:00:00.000Z",
			finishedAt: "2026-07-29T00:00:01.000Z",
			exitCode: 0,
			runner: "vitest" as const,
			rawStdoutArtifactId: "stdout-artifact",
			rawStderrArtifactId: "stderr-artifact",
		};
		const evidence = buildCommandLevelEvidence(base);
		const input = {
			taskId: task.id,
			runId: run.id,
			checkKind: "test",
			evidence,
		};
		const created = await verificationRepo.createVerificationEvidenceRun(input);
		const retried = await verificationRepo.createVerificationEvidenceRun(input);
		expect(retried.id).toBe(created.id);

		await expect(
			verificationRepo.createVerificationEvidenceRun({
				...input,
				evidence: { ...evidence, exitCode: 1 },
			}),
		).rejects.toMatchObject({ code: "verification_evidence_conflict" });
		expect(
			(await verificationRepo.listVerificationEvidenceRuns([created.id]))[0]
				?.exitCode,
		).toBe(0);
	});
});
