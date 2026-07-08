import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import type { ReviewPlanSpec } from "../api/modules/nightworkers/nightworkers.review-mode.model";
import * as reviewRepo from "../api/modules/nightworkers/nightworkers.review-mode.repository";
import { runReviewRunUnitTestCoverageCheck } from "../api/modules/nightworkers/nightworkers.review-run-test-evidence.service";

const tempRoots: string[] = [];

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("ReviewRun unit test coverage check", () => {
	it("stores semantic unit-test coverage evidence without exact wording matches", async () => {
		const fixture = await createFixture({
			testBody: `
				describe("review target extraction", () => {
					it("keeps unrelated dirty files out of the review target", () => {
						expect(target.excludedDirtyFiles).toContain("notes.md");
					});
				});
			`,
		});

		await runReviewRunUnitTestCoverageCheck({
			...fixture.input,
			llm: async () =>
				JSON.stringify({
					version: 1,
					summary: "Completion conditions are covered by unit tests.",
					criteria: [
						{
							criterion:
								"対象外 dirty file を ReviewRun のレビュー対象に含めない",
							status: "covered",
							viewpoint:
								"Unrelated dirty files are excluded from ReviewRun targets.",
							reason:
								"The unit test validates excludedDirtyFiles instead of matching the Japanese wording exactly.",
							matchedTests: [
								{
									filePath: "tests/review-targets.test.ts",
									lineNumber: 3,
									testName:
										"keeps unrelated dirty files out of the review target",
									evidenceKind: "test_body",
									coveredViewpoint:
										"Checks excludedDirtyFiles contains an unrelated file.",
								},
							],
						},
					],
				}),
		});

		const artifacts = await reviewRepo.listReviewArtifacts(
			fixture.reviewSessionId,
		);
		const coverage = artifacts.find(
			(artifact) => artifact.kind === "test_coverage",
		);
		expect(coverage).toMatchObject({ status: "done" });
		expect(coverage?.artifactJson).toMatchObject({
			kind: "unit_test_coverage_review",
			mode: "semantic_unit_test_coverage",
			review: {
				criteria: [
					{
						status: "covered",
						matchedTests: [
							{
								filePath: "tests/review-targets.test.ts",
								evidenceKind: "test_body",
							},
						],
					},
				],
			},
		});
		expect(
			await reviewRepo.listReviewFindings(fixture.reviewSessionId),
		).toEqual([]);
	});

	it("creates a finding when a completion condition is not covered by unit tests", async () => {
		const fixture = await createFixture({
			testBody: `
				it("renders the ReviewRun button", () => {
					expect(screen.getByText("Run")).toBeVisible();
				});
			`,
		});

		await runReviewRunUnitTestCoverageCheck({
			...fixture.input,
			llm: async () =>
				JSON.stringify({
					version: 1,
					summary: "One completion condition is missing unit coverage.",
					criteria: [
						{
							criterion:
								"対象外 dirty file を ReviewRun のレビュー対象に含めない",
							status: "missing",
							viewpoint: "Dirty-tree boundary preservation.",
							reason:
								"The available unit test only checks button rendering and does not cover excluded dirty files.",
							matchedTests: [],
						},
					],
				}),
		});

		const artifacts = await reviewRepo.listReviewArtifacts(
			fixture.reviewSessionId,
		);
		expect(
			artifacts.find((artifact) => artifact.kind === "test_coverage"),
		).toMatchObject({
			status: "needs_human",
		});
		const findings = await reviewRepo.listReviewFindings(
			fixture.reviewSessionId,
		);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({
			severity: "warning",
			title:
				"Unit test coverage missing for completion condition: 対象外 dirty file を ReviewRun のレビュー対象に含めない",
			sourceSection: "review_run",
		});
		expect(findings[0]?.body).toContain("Dirty-tree boundary preservation.");
		expect(findings[0]?.body).toContain("修正方針:");
		expect(findings[0]?.body).toContain("test / it / describe 名を寄せる");
		expect(findings[0]?.body).toContain("focused unit test を追加");
	});
});

async function createFixture(input: { testBody: string }) {
	const root = await mkdtemp(
		path.join(tmpdir(), "nightworkers-review-run-test-"),
	);
	tempRoots.push(root);
	await writeFile(
		path.join(root, "package.json"),
		JSON.stringify({ scripts: { test: "vitest" } }),
	);
	await mkdir(path.join(root, "tests"), { recursive: true });
	await writeFile(
		path.join(root, "tests", "review-targets.test.ts"),
		input.testBody,
	);
	const repository = await repo.createRepository({
		name: `TEST: ReviewRun test evidence ${crypto.randomUUID()}`,
		localPath: root,
		branch: "main",
	});
	const task = await repo.createTask({
		repositoryId: repository.id,
		title: "ReviewRun test evidence",
		objective: "Check completion conditions",
		acceptanceCriteria:
			"対象外 dirty file を ReviewRun のレビュー対象に含めない",
		status: "completed",
	});
	const run = await repo.createTaskRun({
		taskId: task.id,
		repositoryId: repository.id,
		status: "completed",
		workerKind: "native-local",
		summary: "Done",
		finalReport: "Done",
		startedAt: new Date(),
		endedAt: new Date(),
		finishedAt: new Date(),
	});
	const recommendation = await reviewRepo.upsertReviewRecommendation({
		runId: run.id,
		taskId: task.id,
		repositoryId: repository.id,
		level: "required",
		defaultAction: "require_review",
		reasonsJson: [],
	});
	const session = await reviewRepo.createOrStartReviewSession({
		runId: run.id,
		taskId: task.id,
		repositoryId: repository.id,
		recommendationId: recommendation.id,
	});
	const planSpec: ReviewPlanSpec = {
		sourceMessageId: "message-1",
		title: "Feature Plan",
		body: "# Feature Plan",
		acceptanceCriteria: [
			"対象外 dirty file を ReviewRun のレビュー対象に含めない",
		],
		verificationHints: ["bun run test"],
		securityNotes: [],
		implementationScopeHints: [],
	};
	return {
		reviewSessionId: session.id,
		input: {
			reviewSessionId: session.id,
			taskId: task.id,
			repositoryId: repository.id,
			target: {
				runId: run.id,
				taskId: task.id,
				repositoryId: repository.id,
				repoRoot: root,
				planArtifact: {
					messageId: "message-1",
					title: "Feature Plan",
					source: "plan_artifact" as const,
				},
				targetFiles: [],
				excludedDirtyFiles: [],
				signalOnlyFiles: [],
				diffOnlyFiles: [],
				warnings: [],
			},
			planSpec,
		},
	};
}
