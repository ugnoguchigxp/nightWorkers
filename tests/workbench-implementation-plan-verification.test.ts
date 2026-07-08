import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { ensureTestModeVerificationDocument } from "../api/modules/nightworkers/nightworkers.service";
import { listVerificationChecklistItems } from "../api/modules/nightworkers/nightworkers.verification.repository";
import { createPlanningArtifactMessageIfNeeded } from "../api/modules/nightworkers/nightworkers.workbench.service";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("Workbench implementation plan verification metadata", () => {
	it("creates verification metadata and checklist items for implementation plans", async () => {
		const repository = await repo.createRepository({
			name: `implementation-plan-verification-${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "Implementation plan verification",
			status: "draft",
		});
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "completed",
			workerKind: "codex-agent",
			contextSnapshot: { executionMode: "planning" },
		});
		await repo.createTaskMessage({
			taskId: task.id,
			runId: run.id,
			role: "system",
			content: "Run started",
			messageType: "system_event",
			payloadJson: {
				intent: "run_started",
				source: "workbench",
				intakeJobSelection: { jobType: "planning" },
			},
		});

		await createPlanningArtifactMessageIfNeeded({
			taskId: task.id,
			runId: run.id,
			finalReport: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [ ] Test Mode ボタンが表示される",
				"1. 実装計画の完了条件がチェックリスト化される",
			].join("\n"),
		});

		const messages = await repo.listTaskMessages(task.id);
		const implementationPlan = messages.find((message) => {
			const metadata = message.metadataJson as Record<string, unknown>;
			return metadata.intent === "implementation_plan";
		});
		expect(implementationPlan).toBeTruthy();
		const metadata = implementationPlan?.metadataJson as Record<
			string,
			unknown
		>;
		expect(metadata.verificationDocumentId).toEqual(expect.any(String));
		expect(metadata.verificationArtifactId).toEqual(expect.any(String));
		expect(metadata.verificationSidecarMessageId).toEqual(expect.any(String));

		const verificationMessage = messages.find(
			(message) => message.id === metadata.verificationSidecarMessageId,
		);
		expect(verificationMessage?.messageType).toBe("verification_json");
		expect(
			(verificationMessage?.metadataJson as Record<string, unknown>)
				.sourceImplementationPlanMessageId,
		).toBe(implementationPlan?.id);

		const checklist = await listVerificationChecklistItems(
			String(metadata.verificationDocumentId),
		);
		expect(checklist.map((item) => item.text)).toEqual([
			"Test Mode ボタンが表示される",
			"実装計画の完了条件がチェックリスト化される",
		]);
	});

	it("creates missing verification metadata when Test Mode starts from a markdown checklist", async () => {
		const repository = await repo.createRepository({
			name: `test-mode-missing-verification-${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "Test Mode missing verification",
			status: "ready",
		});
		const implementationPlan = await repo.createTaskMessage({
			taskId: task.id,
			role: "assistant",
			content: [
				"# Implementation Plan",
				"",
				"## 完了条件",
				"- [AC-001] API が成功する",
				"- UI が状態を表示する",
			].join("\n"),
			messageType: "markdown_document",
			payloadJson: {
				intent: "implementation_plan",
				title: "Implementation Plan",
			},
		});

		const verificationDocument = await ensureTestModeVerificationDocument({
			projectId: repository.id,
			taskId: task.id,
			specArtifactId: `implementation-plan-${implementationPlan.id}`,
		});

		expect(verificationDocument?.id).toEqual(expect.any(String));
		const messages = await repo.listTaskMessages(task.id);
		const updatedPlan = messages.find(
			(message) => message.id === implementationPlan.id,
		);
		expect(updatedPlan?.metadataJson).toMatchObject({
			verificationDocumentId: verificationDocument?.id,
			verificationSidecarMessageId: expect.any(String),
		});
		const checklist = await listVerificationChecklistItems(
			String(verificationDocument?.id),
		);
		expect(checklist.map((item) => item.text)).toEqual([
			"API が成功する",
			"UI が状態を表示する",
		]);
	});
});
