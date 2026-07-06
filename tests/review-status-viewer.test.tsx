import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { i18next } from "../src/i18n/setup";
import { ReviewStatusViewer } from "../src/modules/nightworkers/components/ReviewStatusViewer";
import type { ReviewSessionDetail } from "../src/modules/nightworkers/types";

function visibleText(markup: string) {
	return markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function reviewSessionDetail(): ReviewSessionDetail {
	const now = "2026-07-06T00:00:00.000Z";
	return {
		session: {
			id: "11111111-1111-4111-8111-111111111111",
			runId: "22222222-2222-4222-8222-222222222222",
			taskId: "33333333-3333-4333-8333-333333333333",
			repositoryId: "44444444-4444-4444-8444-444444444444",
			status: "in_progress",
			recommendationId: "55555555-5555-4555-8555-555555555555",
			startedAt: now,
			completedAt: null,
			finalAction: null,
			finalNote: null,
			createdAt: now,
			updatedAt: now,
		},
		recommendation: {
			version: 1,
			id: "55555555-5555-4555-8555-555555555555",
			runId: "22222222-2222-4222-8222-222222222222",
			taskId: "33333333-3333-4333-8333-333333333333",
			repositoryId: "44444444-4444-4444-8444-444444444444",
			level: "required",
			defaultAction: "require_review",
			reasons: [
				{
					code: "public_contract_change",
					severity: "blocking",
					label: "Public API, schema, MCP, or worker-tool contract changed.",
					evidenceRefs: [],
				},
			],
			createdAt: now,
			updatedAt: now,
		},
		statusArtifact: {
			version: 1,
			reviewSessionId: "11111111-1111-4111-8111-111111111111",
			runId: "22222222-2222-4222-8222-222222222222",
			taskId: "33333333-3333-4333-8333-333333333333",
			recommendation: {
				version: 1,
				id: "55555555-5555-4555-8555-555555555555",
				runId: "22222222-2222-4222-8222-222222222222",
				taskId: "33333333-3333-4333-8333-333333333333",
				repositoryId: "44444444-4444-4444-8444-444444444444",
				level: "required",
				defaultAction: "require_review",
				reasons: [
					{
						code: "public_contract_change",
						severity: "blocking",
						label: "Public API, schema, MCP, or worker-tool contract changed.",
						evidenceRefs: [],
					},
				],
				createdAt: now,
				updatedAt: now,
			},
			sections: [
				{
					kind: "test_coverage",
					requirement: "recommended",
					progress: "done",
					reason:
						"Check test evidence for implementation-plan acceptance criteria.",
					artifactId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
					findingCounts: { blocking: 0, warning: 1, info: 0 },
				},
			],
			finalActionGate: {
				canApprove: true,
				blockingReason: null,
				unresolvedBlockingFindingIds: [],
				requiredSectionKindsRemaining: [],
			},
			promptSuggestionCount: 1,
			securityHandoffCount: 0,
		},
		artifacts: [
			{
				id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				reviewSessionId: "11111111-1111-4111-8111-111111111111",
				runId: "22222222-2222-4222-8222-222222222222",
				taskId: "33333333-3333-4333-8333-333333333333",
				kind: "test_coverage",
				status: "done",
				createdAt: now,
				updatedAt: now,
				sourceEvidenceRefs: [],
				artifact: {
					version: 2,
					kind: "test_coverage",
					requirement: "recommended",
					summary:
						"1 confirmed, 1 not confirmed, 0 unclear by agentic test evidence review.",
					mode: "agentic_review",
					precheck: {
						version: 1,
						taskId: "33333333-3333-4333-8333-333333333333",
						repositoryPath: "/Users/y.noguchi/Code/nightWorkers",
						planFound: true,
						planTitle: "Feature Plan",
						criteria: ["ルート A が保存される", "ルート B が削除される"],
						testFilesScanned: 12,
						testNamesScanned: 48,
						matches: [
							{
								criterion: "ルート A が保存される",
								matched: true,
								bestScore: 0.9,
								testNames: ["ルート A が保存される"],
							},
							{
								criterion: "ルート B が削除される",
								matched: false,
								bestScore: 0,
								testNames: [],
							},
						],
					},
					agenticReview: {
						version: 1,
						summary: "1 confirmed, 1 not confirmed.",
						criteria: [
							{
								criterion: "ルート A が保存される",
								status: "confirmed",
								confidence: "high",
								evidence: [
									{
										kind: "test_name",
										filePath: "tests/routes.test.ts",
										testName: "ルート A が保存される",
										note: "対応する test name を確認しました。",
									},
								],
							},
							{
								criterion: "ルート B が削除される",
								status: "not_found",
								confidence: "medium",
								evidence: [
									{
										kind: "reasoning",
										note: "近い test name はなく、確認した範囲では対応が不明です。",
									},
								],
								improvementPrompt:
									"ルート B の削除を検証する focused test を追加してください。",
							},
						],
						commandsRun: [
							{
								command: 'rg "ルート B" tests',
								exitCode: 1,
								summary: "No matches",
							},
						],
					},
					findings: [],
					recommendedActions: [],
				},
			},
		],
		findings: [
			{
				id: "66666666-6666-4666-8666-666666666666",
				reviewSessionId: "11111111-1111-4111-8111-111111111111",
				runId: "22222222-2222-4222-8222-222222222222",
				taskId: "33333333-3333-4333-8333-333333333333",
				severity: "warning",
				title:
					"Test evidence not confirmed for acceptance criterion: ルート B が削除される",
				body: "受け入れ条件「ルート B が削除される」に近い describe/it/test 名が見つかりません。",
				disposition: null,
				dispositionStatus: "unresolved",
				dispositionNote: null,
				evidenceRefs: [],
				createdGoalId: null,
				createdTaskProposalId: null,
				contextStillCandidateId: null,
				createdAt: now,
				updatedAt: now,
			},
		],
		promptSuggestions: [
			{
				id: "88888888-8888-4888-8888-888888888888",
				reviewSessionId: "11111111-1111-4111-8111-111111111111",
				findingId: "66666666-6666-4666-8666-666666666666",
				runId: "22222222-2222-4222-8222-222222222222",
				taskId: "33333333-3333-4333-8333-333333333333",
				repositoryId: "44444444-4444-4444-8444-444444444444",
				title: "テスト名を追加する",
				prompt: "この session の作業を続けてください。",
				expectedOutcome:
					"Missing acceptance criteria are represented by test names.",
				acceptanceCriteria: "Test names map to acceptance criteria.",
				verificationHint: "bun run test run ...",
				evidenceRefs: [],
				status: "draft",
				useCount: 0,
				lastUsedAt: null,
				dismissedAt: null,
				createdMessageId: null,
				createdAt: now,
				updatedAt: now,
			},
		],
		securityHandoffs: [],
	};
}

describe("ReviewStatusViewer", () => {
	it("renders acceptance criteria test-name check results in Japanese", async () => {
		await i18next.changeLanguage("ja");

		const text = visibleText(
			renderToStaticMarkup(
				<ReviewStatusViewer detail={reviewSessionDetail()} />,
			),
		);

		expect(text).toContain("テスト証跡確認");
		expect(text).toContain("実装計画: Feature Plan");
		expect(text).toContain("受け入れ条件: 1 / 2 件一致");
		expect(text).toContain("テストファイル 12 件 / テスト名 48 件");
		expect(text).toContain("LLM がファイル/CLIで確認");
		expect(text).toContain("確認済み 1 件");
		expect(text).toContain("未確認 1 件");
		expect(text).toContain("ルート B が削除される");
		expect(text).not.toContain("検証記録");
		expect(text).not.toContain("最終報告");
		expect(text).not.toContain("保存済み Run 記録");
	});

	it("renders acceptance criteria test-name check results in English", async () => {
		await i18next.changeLanguage("en");

		const text = visibleText(
			renderToStaticMarkup(
				<ReviewStatusViewer detail={reviewSessionDetail()} />,
			),
		);

		expect(text).toContain("Test Evidence Review");
		expect(text).toContain("Implementation plan: Feature Plan");
		expect(text).toContain("Acceptance criteria matched: 1 / 2");
		expect(text).toContain("12 test files / 48 test names");
		expect(text).toContain("LLM checked files/CLI");
		expect(text).toContain("1 confirmed");
		expect(text).toContain("1 not confirmed");
		expect(text).not.toContain("Verification Record");
		expect(text).not.toContain("Final Report");
		expect(text).not.toContain("Run Record Check");
	});
});
