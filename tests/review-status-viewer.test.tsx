import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { i18next } from "../src/i18n/setup";
import { ReviewStatusViewer } from "../src/modules/nightworkers/components/ReviewStatusViewer";
import type {
	GitCloseoutState,
	ReviewSessionDetail,
} from "../src/modules/nightworkers/types";

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
					requirement: "required",
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
					requirement: "required",
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

function gitCloseoutState(
	override: Partial<GitCloseoutState> = {},
): GitCloseoutState {
	return {
		runId: "22222222-2222-4222-8222-222222222222",
		repositoryId: "44444444-4444-4444-8444-444444444444",
		canCommit: true,
		canPush: false,
		state: "commit_ready",
		blockingCode: null,
		blockingReason: null,
		commitRecord: {
			status: "ready",
			baselineHead: "abc123",
			preExistingDirtyPathsJson: [],
			ownedCandidatePathsJson: ["src/app.ts"],
			stageableOwnedPathsJson: ["src/app.ts"],
			excludedPathsJson: [],
			verificationStatus: "passed",
			commitSha: null,
			commitMessage: null,
			pushStatus: null,
			pushedAt: null,
			pushRemote: null,
			pushBranch: null,
			statusReason: null,
		},
		requiredReview: {
			reviewSessionId: "11111111-1111-4111-8111-111111111111",
			testCoverageStatus: null,
			reviewRunStatus: "running",
			complete: true,
		},
		git: {
			head: "abc123",
			branch: "main",
			upstream: null,
			dirtyPaths: ["src/app.ts"],
			stagedPaths: [],
		},
		counts: { stageablePaths: 1, excludedPaths: 0 },
		...override,
	};
}

function reviewRunArtifact(
	status: "not_started" | "running" | "needs_human" | "done" | "failed",
): ReviewSessionDetail["artifacts"][number] {
	const now = "2026-07-06T00:00:00.000Z";
	return {
		id: "99999999-9999-4999-8999-999999999999",
		reviewSessionId: "11111111-1111-4111-8111-111111111111",
		runId: "22222222-2222-4222-8222-222222222222",
		taskId: "33333333-3333-4333-8333-333333333333",
		kind: "review_run",
		status,
		createdAt: now,
		updatedAt: now,
		sourceEvidenceRefs: [],
		artifact: {
			version: 1,
			kind: "review_run",
			runId: "22222222-2222-4222-8222-222222222222",
			reviewRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			taskId: "33333333-3333-4333-8333-333333333333",
			repositoryId: "44444444-4444-4444-8444-444444444444",
			options: {
				codeReview: true,
				testEvidenceReview: true,
				securityReview: false,
				applyFixes: true,
				commitChanges: false,
			},
			status,
			target: {
				targetFiles: [
					{ path: "src/app.ts", status: "modified", diffBytes: 120 },
					{ path: "src/app.test.ts", status: "modified", diffBytes: 80 },
				],
				excludedDirtyFiles: [],
			},
			todos: [
				{
					seq: 1,
					title: "Review Plan 仕様書を読む",
					taskType: "inspection",
					procedureId: "review.read_plan_spec",
				},
			],
			warnings: [],
		},
	};
}

describe("ReviewStatusViewer", () => {
	it("renders Review Run options with detailed descriptions in Japanese", async () => {
		await i18next.changeLanguage("ja");

		const text = visibleText(
			renderToStaticMarkup(
				<ReviewStatusViewer detail={reviewSessionDetail()} />,
			),
		);

		expect(text).toContain("Review Run");
		expect(text).toContain("コードレビュー");
		expect(text).toContain("実装計画、対象 diff、変更ファイルを照合");
		expect(text).toContain("テスト証跡確認");
		expect(text).toContain("受け入れ条件に対応するテスト、実行結果、証跡");
		expect(text).toContain("セキュリティレビュー");
		expect(text).toContain("vulnWorkbench を使って Semgrep");
		expect(text).toContain("DAST、reproduction、dynamic verification");
		expect(text).toContain("修正を適用");
		expect(text).toContain("既存テスト名を完了条件の観点に寄せる");
		expect(text).toContain("focused unit test を追加して通します");
		expect(text).toContain("コミット");
		expect(text).toContain("対象抽出が人の確認待ち");
		expect(text).not.toContain("理由");
		expect(text).not.toContain("実装計画: Feature Plan");
		expect(text).not.toContain("検証記録");
		expect(text).not.toContain("最終報告");
		expect(text).not.toContain("保存済み Run 記録");
	});

	it("enables the Review Run button when a runner callback is provided", async () => {
		await i18next.changeLanguage("ja");
		const detail = {
			...reviewSessionDetail(),
			artifacts: [],
			findings: [],
			promptSuggestions: [],
		};

		const markup = renderToStaticMarkup(
			<ReviewStatusViewer
				detail={detail}
				onStartReviewRun={async () => detail}
			/>,
		);
		const runButton = markup.match(/<button[^>]*>[\s\S]*?Run<\/button>/)?.[0];

		expect(runButton).toBeTruthy();
		expect(runButton).not.toContain(' disabled=""');
		expect(runButton).toContain("bg-cyan-300");
		expect(runButton).toContain("font-semibold");
	});

	it("keeps the Review Run button loading and disabled while ReviewRun is running", async () => {
		await i18next.changeLanguage("ja");
		const detail = {
			...reviewSessionDetail(),
			artifacts: [
				...reviewSessionDetail().artifacts,
				reviewRunArtifact("running"),
			],
		};

		const markup = renderToStaticMarkup(
			<ReviewStatusViewer
				detail={detail}
				onStartReviewRun={async () => detail}
			/>,
		);
		const runButton = markup
			.match(/<button[^>]*>[\s\S]*?<\/button>/g)
			?.find((button) => button.includes("Run"));

		expect(runButton).toBeTruthy();
		expect(runButton).toContain('disabled=""');
		expect(runButton).toContain("animate-spin");
	});

	it("renders a manual commit button for the reviewed run", async () => {
		await i18next.changeLanguage("ja");
		const detail = reviewSessionDetail();
		const markup = renderToStaticMarkup(
			<ReviewStatusViewer
				detail={detail}
				gitCloseout={gitCloseoutState()}
				onCommitGitCloseout={async () =>
					gitCloseoutState({ state: "committed" })
				}
			/>,
		);
		const text = visibleText(markup);
		const commitButton = markup
			.match(/<button[^>]*>[\s\S]*?<\/button>/g)
			?.find((button) => button.includes("LLMメッセージでコミット"));

		expect(text).toContain("手動コミット");
		expect(text).toContain("対象 1 件 / 除外 0 件 / commit_ready");
		expect(commitButton).toBeTruthy();
		expect(commitButton).not.toContain(' disabled=""');
		expect(commitButton).toContain("bg-emerald-300");
	});

	it("does not render the ReviewRun status badge", async () => {
		await i18next.changeLanguage("ja");
		const detail = {
			...reviewSessionDetail(),
			artifacts: [
				...reviewSessionDetail().artifacts,
				reviewRunArtifact("needs_human"),
			],
		};

		const text = visibleText(
			renderToStaticMarkup(<ReviewStatusViewer detail={detail} />),
		);

		expect(text).toContain("targets 2");
		expect(text).toContain("todos 1");
		expect(text).not.toContain("needs_human");
	});

	it("hides the required review badge after ReviewRun completes", async () => {
		await i18next.changeLanguage("ja");
		const detail = {
			...reviewSessionDetail(),
			artifacts: [
				...reviewSessionDetail().artifacts,
				reviewRunArtifact("done"),
			],
		};

		const text = visibleText(
			renderToStaticMarkup(<ReviewStatusViewer detail={detail} />),
		);

		expect(text).not.toContain("レビュー必須");
	});

	it("disables the manual commit button when the reviewed run is already committed", async () => {
		await i18next.changeLanguage("ja");
		const markup = renderToStaticMarkup(
			<ReviewStatusViewer
				detail={reviewSessionDetail()}
				gitCloseout={gitCloseoutState({
					canCommit: false,
					state: "committed",
					commitRecord: {
						...gitCloseoutState().commitRecord,
						status: "committed",
						commitSha: "def456",
						commitMessage: "Update review run UI",
						pushStatus: "not_pushed",
					},
				})}
				onCommitGitCloseout={async () =>
					gitCloseoutState({ state: "committed" })
				}
			/>,
		);
		const commitButton = markup
			.match(/<button[^>]*>[\s\S]*?<\/button>/g)
			?.find((button) => button.includes("コミット済み"));

		expect(commitButton).toBeTruthy();
		expect(commitButton).toContain('disabled=""');
		expect(commitButton).toContain("bg-slate-900");
		expect(commitButton).toContain("cursor-not-allowed");
		expect(commitButton).not.toContain("bg-emerald-300");
	});

	it("renders the complete-and-archive task action for active review tasks", async () => {
		await i18next.changeLanguage("ja");
		const text = visibleText(
			renderToStaticMarkup(
				<ReviewStatusViewer
					detail={reviewSessionDetail()}
					activeTaskStatus="completed"
					onCompleteAndArchiveTask={async () => null}
					onRestoreArchivedTask={async () => null}
				/>,
			),
		);

		expect(text).toContain("レビュー後のタスク状態");
		expect(text).toContain("完了してアーカイブ");
		expect(text).not.toContain("アクティブタスクに戻す");
	});

	it("swaps to the restore action for archived review tasks", async () => {
		await i18next.changeLanguage("ja");
		const text = visibleText(
			renderToStaticMarkup(
				<ReviewStatusViewer
					detail={reviewSessionDetail()}
					activeTaskStatus="cancelled"
					onCompleteAndArchiveTask={async () => null}
					onRestoreArchivedTask={async () => null}
				/>,
			),
		);

		expect(text).toContain("アクティブタスクに戻す");
		expect(text).not.toContain("完了してアーカイブ");
	});

	it("does not render legacy review menus or final actions", async () => {
		await i18next.changeLanguage("en");

		const text = visibleText(
			renderToStaticMarkup(
				<ReviewStatusViewer detail={reviewSessionDetail()} />,
			),
		);

		expect(text).toContain("Review Run");
		expect(text).not.toContain("Test Evidence Review");
		expect(text).not.toContain("Implementation plan: Feature Plan");
		expect(text).not.toContain("Git closeout");
		expect(text).not.toContain(
			"Test evidence not confirmed for acceptance criterion",
		);
		expect(text).not.toContain("テスト名を追加する");
		expect(text).not.toContain("Continue with prompt");
		expect(text).not.toContain("Final Action");
		expect(text).not.toContain("Approve");
		expect(text).not.toContain("Request changes");
		expect(text).not.toContain("Verification Record");
		expect(text).not.toContain("Final Report");
		expect(text).not.toContain("Run Record Check");
	});
});
