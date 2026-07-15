import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NotFoundError } from "../../lib/errors";
import type { ImplementationTodoInput } from "../../services/todo-runtime";
import {
	formatMissionPilotReworkPacket,
	hasMissionPilotReworkPacket,
	missionPilotReworkPaths,
} from "../missionPilot/mission-pilot-rework";
import * as repo from "../nightworkers/nightworkers.repository";
import { startTaskRun } from "../nightworkers/run-orchestration/start-task-run";
import { getProjectSecurityIntelligenceSettings } from "../ontology";
import {
	DEFAULT_REVIEW_RUN_OPTIONS,
	type ReviewPlanSpec,
	type ReviewRunOptions,
	type ReviewTarget,
	type ReviewTargetWarning,
} from "./review-mode.model";
import * as reviewRepo from "./review-mode.repository";
import { buildReviewRunArtifact } from "./review-run-artifact";
import {
	findExistingReviewTaskRun,
	reviewRunArtifactStatus,
} from "./review-run-idempotency.service";
import {
	extractPlanBullets,
	reviewTargetWarningTitle,
	summarizeTarget,
} from "./review-run-target-helpers";
import {
	buildReviewTargetManifest,
	type ReviewTargetManifestContext,
} from "./review-target-manifest";
import {
	buildReviewTarget,
	findLatestPlanArtifact,
} from "./review-targets.service";
import {
	findingForVulnWorkbenchResult,
	readVulnWorkbenchCliSettings,
	runVulnWorkbenchSecurityDiagnostic,
} from "./review-vulnworkbench.service";

export {
	extractPlanBullets,
	reviewTargetWarningTitle,
	summarizeTarget,
} from "./review-run-target-helpers";

export function normalizeReviewRunOptions(
	value: Partial<ReviewRunOptions> | null | undefined,
): ReviewRunOptions {
	const { testEvidenceReview: _legacyTestEvidenceReview, ...supportedOptions } =
		(value ?? {}) as Partial<ReviewRunOptions> & {
			testEvidenceReview?: boolean;
		};
	return {
		...DEFAULT_REVIEW_RUN_OPTIONS,
		...supportedOptions,
	};
}

export function buildReviewRunTodos(input: {
	options: ReviewRunOptions;
	target: ReviewTarget;
	planSpec: ReviewPlanSpec;
	missionPilotReworkPacket?: unknown;
}): ImplementationTodoInput[] {
	const todos: ImplementationTodoInput[] = [];
	const appendTodo = (
		todo: Omit<ImplementationTodoInput, "dependsOn">,
	): void => {
		const previousSeq = todos.length;
		todos.push({
			...todo,
			...(previousSeq > 0 ? { dependsOn: [previousSeq] } : {}),
		});
	};
	if (hasMissionPilotReworkPacket(input.missionPilotReworkPacket)) {
		appendTodo({
			title: "前回Reviewのblocking指摘だけを再確認する",
			description: formatMissionPilotReworkPacket(
				input.missionPilotReworkPacket,
			),
			taskType: "focused_verification",
			procedureId: "review.rework_findings",
		});
		appendTodo({
			title: "指摘対象の修正diffと関連テストだけを確認する",
			description:
				"前回Reviewのblocking指摘、修正対象パス、修正後の関連テストに限定して再Reviewする。対象外の全体レビューやsecurity診断は再実行しない。",
			taskType: "focused_verification",
			procedureId: "review.rework_diff",
		});
		appendTodo({
			title: "再作業指摘の解消結果を保存する",
			description:
				"各blocking指摘が解消したかを判定し、未解消ならblocking findingとして報告する。",
			taskType: "documentation",
			procedureId: "review.rework_consolidate",
		});
		if (input.options.applyFixes) {
			appendTodo({
				title: "未解消指摘を次のImplementation correctionへ引き渡す",
				description:
					"Review Run自身は編集せず、未解消のblocking finding/evidenceだけを次のcorrection Sessionへ送る。",
				taskType: "documentation",
				procedureId: "review.correction_request",
			});
		}
		if (input.options.commitChanges) {
			appendTodo({
				title: "focused correction loop後のcloseout権限を記録する",
				description:
					"focused Reviewがpassした場合だけ、correction Implementation -> Test -> Review後のcloseout権限を有効にする。",
				taskType: "documentation",
				procedureId: "review.correction_closeout_permission",
			});
		}
		return todos;
	}

	if (input.options.codeReview) {
		appendTodo({
			title: "Review Plan 仕様書を読む",
			description: input.planSpec.body
				? "Plan 仕様書を source of truth として読み、受け入れ条件・検証観点・security notes を確認する。"
				: "Plan 仕様書が見つからないため、missing warning を確認して code review path に限定する。",
			taskType: "inspection",
			procedureId: "review.read_plan_spec",
		});
		appendTodo({
			title: "この run の編集対象と diff を確認する",
			description: `対象ファイル ${input.target.targetFiles.length} 件、除外 dirty file ${input.target.excludedDirtyFiles.length} 件、warning ${input.target.warnings.length} 件を確認する。`,
			taskType: "inspection",
			procedureId: "review.inspect_targets",
		});
		appendTodo({
			title: "Plan 仕様と対象 diff を照合し、コードレビュー findings を作る",
			description:
				"対象ファイルだけを主対象に、バグ・回帰・責務境界・低品質な修正を重大度付き finding として整理する。",
			taskType: "inspection",
			procedureId: "review.code_findings",
		});
	}
	if (input.options.securityReview) {
		appendTodo({
			title: "vulnWorkbench CLI のセキュリティ診断結果を確認する",
			description:
				"NightWorkers が事前実行した vulnWorkbench の scanner-backed evidence を確認し、LLM-only concern を confirmed vulnerability として扱わない。対象 repository 内で CLI を再実行しない。",
			taskType: "focused_verification",
			procedureId: "review.security_vulnworkbench",
		});
	}
	const enabledReviewSources = [
		input.options.codeReview ? "code review" : null,
		input.options.securityReview ? "security review" : null,
	].filter((value): value is string => value !== null);
	appendTodo({
		title: "findings を統合して artifact に保存する",
		description:
			enabledReviewSources.length > 0
				? `${enabledReviewSources.join("、")} の結果を統合し、Review Mode findings と Review Run artifact の材料を整理する。`
				: "選択された review option がないことを確認し、Review Run artifact の材料を整理する。",
		taskType: "documentation",
		procedureId: "review.consolidate_findings",
	});
	if (input.options.applyFixes) {
		appendTodo({
			title: "accepted findings を Implementation correction に引き渡す",
			description:
				"Review Run 自身は編集・verify・commitせず、accepted finding/evidenceを新しい Implementation correction Sessionへ送るrequest artifact/eventを作成する。",
			taskType: "documentation",
			procedureId: "review.correction_request",
		});
	}
	if (input.options.commitChanges) {
		appendTodo({
			title: "correction loop 後の closeout 権限を記録する",
			description:
				"commitChanges=true は correction Implementation -> Test -> Review pass 後だけ有効とし、Review Runではcommitしない。",
			taskType: "documentation",
			procedureId: "review.correction_closeout_permission",
		});
	}
	return todos;
}

type ReviewRunMissionInput = {
	targetRunIds?: string[];
	targetManifestContext?: ReviewTargetManifestContext;
	missionPilot?: Record<string, unknown>;
	reviewCorrection?: Record<string, unknown>;
};

export function resolveReviewTargetRunIds(
	missionInput: ReviewRunMissionInput | null | undefined,
) {
	return missionInput?.targetRunIds;
}

export async function startReviewRunForSession(
	reviewSessionId: string,
	optionsInput?: Partial<ReviewRunOptions> | null,
	missionInput?: ReviewRunMissionInput | null,
) {
	let session = await reviewRepo.getReviewSession(reviewSessionId);
	if (!session) throw new NotFoundError("Review session not found");
	const options = normalizeReviewRunOptions(optionsInput);
	const missionPilotReworkPacket = missionInput?.missionPilot?.reworkPacket;
	const target = await buildReviewTarget({
		runId: session.runId,
		runIds: resolveReviewTargetRunIds(missionInput),
	});
	const targetManifest = await buildReviewTargetManifest({
		target,
		context: missionInput?.targetManifestContext,
	});
	const planSpec = await readReviewPlanSpec(session.taskId);
	const todos = buildReviewRunTodos({
		options,
		target,
		planSpec,
		missionPilotReworkPacket,
	});
	const existing = await findExistingReviewTaskRun(session);
	if (existing) {
		if (session.status === "not_started") {
			session =
				(await reviewRepo.markReviewSessionStarted(reviewSessionId)) ?? session;
		}
		if (!existing.artifact) {
			const recoveredStatus = reviewRunArtifactStatus(existing.run.status);
			await reviewRepo.upsertReviewArtifact({
				reviewSessionId,
				runId: session.runId,
				taskId: session.taskId,
				kind: "review_run",
				status: recoveredStatus,
				artifactJson: buildReviewRunArtifact({
					session,
					options,
					target,
					todos,
					status: recoveredStatus,
					reviewRunId: existing.run.id,
					initialFindingCount: 0,
				}),
				sourceEvidenceRefsJson: [],
			});
		}
		return { reviewRun: existing.run, target, planSpec, todos };
	}
	const initialFindings = await createInitialReviewRunFindings({
		session,
		target,
		planSpec,
		options,
	});
	session =
		(await reviewRepo.markReviewSessionStarted(reviewSessionId)) ?? session;
	await reviewRepo.upsertReviewArtifact({
		reviewSessionId,
		runId: session.runId,
		taskId: session.taskId,
		kind: "review_targets",
		status: target.warnings.some((warning) => warning.severity === "blocking")
			? "needs_human"
			: "done",
		artifactJson: target,
		sourceEvidenceRefsJson: target.targetFiles.flatMap((file) =>
			file.eventIds.map((eventId) => ({ kind: "run_event", eventId })),
		),
	});
	await reviewRepo.upsertReviewArtifact({
		reviewSessionId,
		runId: session.runId,
		taskId: session.taskId,
		kind: "review_run",
		status: "running",
		artifactJson: buildReviewRunArtifact({
			session,
			options,
			target,
			todos,
			status: "running",
			reviewRunId: null,
			initialFindingCount: initialFindings.length,
		}),
		sourceEvidenceRefsJson: [],
	});
	const blockingWarnings = target.warnings.filter(
		(warning) => warning.severity === "blocking",
	);
	if (blockingWarnings.length > 0) {
		await reviewRepo.updateReviewSession(reviewSessionId, {
			status: "needs_human",
			finalNote: "Review target extraction needs human review.",
		});
		await reviewRepo.upsertReviewArtifact({
			reviewSessionId,
			runId: session.runId,
			taskId: session.taskId,
			kind: "review_run",
			status: "needs_human",
			artifactJson: buildReviewRunArtifact({
				session,
				options,
				target,
				todos,
				status: "needs_human",
				reviewRunId: null,
				initialFindingCount: initialFindings.length,
			}),
			sourceEvidenceRefsJson: [],
		});
		await repo.createRunEvent({
			version: 1,
			runId: session.runId,
			taskId: session.taskId,
			timestamp: new Date().toISOString(),
			type: "review.run_started",
			severity: "warning",
			actor: "system",
			message:
				"Review Run did not start because target extraction needs human review.",
			data: {
				reviewSessionId,
				options,
				blockingWarnings,
				targetSummary: summarizeTarget(target),
			},
		});
		return { reviewRun: null, target, planSpec, todos };
	}

	const reviewPrompt = buildReviewRunPrompt({
		session,
		options,
		target,
		planSpec,
		todos,
		initialFindings,
		missionPilot: Boolean(missionInput?.missionPilot),
		missionPilotReworkPacket,
	});
	await repo.createTaskMessage({
		taskId: session.taskId,
		runId: null,
		role: "user",
		content: reviewPrompt,
		messageType: "review_run_request",
		payloadJson: {
			intent: "review_run",
			reviewSessionId,
			reviewedRunId: session.runId,
			options,
			targetSummary: summarizeTarget(target),
		},
	});
	const reviewRun = await startTaskRun(session.taskId, {
		executionModeSource: "review_run",
		initialTodos: todos,
		runtimeOptionsPatch: {
			...(missionInput?.missionPilot
				? { missionPilot: missionInput.missionPilot }
				: {}),
			...(missionInput?.reviewCorrection
				? { reviewCorrection: missionInput.reviewCorrection }
				: {}),
			...(hasMissionPilotReworkPacket(missionPilotReworkPacket)
				? { missionPilotReworkPacket }
				: {}),
			reviewRun: {
				reviewSessionId,
				reviewedRunId: session.runId,
				options,
				targetSummary: summarizeTarget(target),
				targetManifest,
				focusedReview: hasMissionPilotReworkPacket(missionPilotReworkPacket),
			},
		},
	});
	await reviewRepo.upsertReviewArtifact({
		reviewSessionId,
		runId: session.runId,
		taskId: session.taskId,
		kind: "review_run",
		status: "running",
		artifactJson: buildReviewRunArtifact({
			session,
			options,
			target,
			todos,
			status: "running",
			reviewRunId: reviewRun.id,
			initialFindingCount: initialFindings.length,
		}),
		sourceEvidenceRefsJson: [],
	});
	await repo.createRunEvent({
		version: 1,
		runId: session.runId,
		taskId: session.taskId,
		timestamp: new Date().toISOString(),
		type: "review.run_started",
		severity: "info",
		actor: "system",
		message: "Review Run was started.",
		data: {
			reviewSessionId,
			reviewRunId: reviewRun.id,
			options,
			targetSummary: summarizeTarget(target),
		},
	});
	return { reviewRun, target, planSpec, todos };
}

async function readReviewPlanSpec(taskId: string): Promise<ReviewPlanSpec> {
	const artifact = await findLatestPlanArtifact(taskId);
	if (!artifact) {
		return {
			sourceMessageId: null,
			title: null,
			body: "",
			acceptanceCriteria: [],
			verificationHints: [],
			securityNotes: [],
			implementationScopeHints: [],
		};
	}
	return {
		sourceMessageId: artifact.id,
		title: artifact.title,
		body: artifact.body,
		acceptanceCriteria: extractPlanBullets(artifact.body, [
			"Acceptance Criteria",
			"受け入れ条件",
			"Completion Conditions",
			"完了条件",
		]),
		verificationHints: extractPlanBullets(artifact.body, [
			"Verification",
			"検証",
			"Verification Gates",
		]),
		securityNotes: extractPlanBullets(artifact.body, [
			"Security",
			"セキュリティ",
		]),
		implementationScopeHints: extractPlanBullets(artifact.body, [
			"Implementation",
			"実装",
			"Scope",
		]),
	};
}

async function createInitialReviewRunFindings(input: {
	session: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewSession>>>;
	target: ReviewTarget;
	planSpec: ReviewPlanSpec;
	options: ReviewRunOptions;
}) {
	const rows: Parameters<typeof reviewRepo.createReviewFindings>[0] =
		input.target.warnings
			.filter((warning) => warning.severity !== "info")
			.map((warning) => warningToFinding(input.session, warning));
	if (input.options.securityReview) {
		const securityIntelligence = await getProjectSecurityIntelligenceSettings(
			input.session.repositoryId,
		);
		if (!securityIntelligence.securityOracle.effectiveEnabled) {
			const reason = securityIntelligence.securityOracle.reason;
			const artifact = await reviewRepo.upsertReviewArtifact({
				reviewSessionId: input.session.id,
				runId: input.session.runId,
				taskId: input.session.taskId,
				kind: "security_review",
				status: "done",
				artifactJson: {
					version: 1,
					kind: "vulnworkbench_security_diagnostic_skipped",
					status: "skipped",
					reason,
					eligibility: securityIntelligence.eligibility,
				},
				sourceEvidenceRefsJson: [],
			});
			rows.push({
				reviewSessionId: input.session.id,
				runId: input.session.runId,
				taskId: input.session.taskId,
				severity: "info",
				title: "Security review was skipped by the effective Project policy",
				body: `vulnWorkbench CLI was not executed (${reason}).`,
				evidenceRefsJson: [
					{
						kind: "artifact",
						artifactId: artifact.id,
						artifactKind: "security_review",
					},
				],
				sourceSection: "security_review",
			});
			return reviewRepo.createReviewFindings(rows);
		}
		const settings = readVulnWorkbenchCliSettings();
		const artifactDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "nightworkers-review-"),
		);
		const result = await runVulnWorkbenchSecurityDiagnostic({
			target: input.target,
			artifactDir,
			settings,
		});
		const artifact = await reviewRepo.upsertReviewArtifact({
			reviewSessionId: input.session.id,
			runId: input.session.runId,
			taskId: input.session.taskId,
			kind: "security_review",
			status: result.ok ? "done" : "needs_human",
			artifactJson: {
				version: 1,
				kind: "vulnworkbench_security_diagnostic",
				result,
			},
			sourceEvidenceRefsJson: [],
		});
		const finding = findingForVulnWorkbenchResult(result);
		const evidenceRefsJson: unknown[] = [
			...finding.evidenceRefsJson,
			{
				kind: "artifact",
				artifactId: artifact.id,
				artifactKind: "security_review",
			},
		];
		rows.push({
			reviewSessionId: input.session.id,
			runId: input.session.runId,
			taskId: input.session.taskId,
			...finding,
			evidenceRefsJson,
		});
	}
	return reviewRepo.createReviewFindings(rows);
}

function warningToFinding(
	session: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewSession>>>,
	warning: ReviewTargetWarning,
) {
	return {
		reviewSessionId: session.id,
		runId: session.runId,
		taskId: session.taskId,
		severity: warning.severity === "blocking" ? "blocking" : "warning",
		title: reviewTargetWarningTitle(warning),
		body: [warning.message, warning.paths?.slice(0, 10).join("\n")]
			.filter(Boolean)
			.join("\n"),
		evidenceRefsJson: [],
		sourceSection: "review_run",
	};
}

export function buildReviewRunPrompt(input: {
	session: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewSession>>>;
	options: ReviewRunOptions;
	target: ReviewTarget;
	planSpec: ReviewPlanSpec;
	todos: ImplementationTodoInput[];
	initialFindings: Array<{
		severity: string;
		title: string;
		body: string | null;
	}>;
	missionPilot?: boolean;
	missionPilotReworkPacket?: unknown;
}) {
	const focusedReview = hasMissionPilotReworkPacket(
		input.missionPilotReworkPacket,
	);
	const focusedPaths = missionPilotReworkPaths(input.missionPilotReworkPacket);
	const targetFiles = focusedReview
		? input.target.targetFiles.filter((file) =>
				focusedPaths.includes(file.path),
			)
		: input.target.targetFiles;
	const targetLines = targetFiles
		.map((file) => `- ${file.path} (${file.status}, ${file.diffBytes} bytes)`)
		.join("\n");
	const warningLines = input.target.warnings
		.map(
			(warning) =>
				`- [${warning.severity}] ${warning.code}: ${warning.message}`,
		)
		.join("\n");
	const initialFindingLines = input.initialFindings
		.map((finding, index) =>
			[
				`${index + 1}. [${finding.severity}] ${finding.title}`,
				finding.body?.trim() || "(本文なし)",
			].join("\n"),
		)
		.join("\n\n");
	const planSpecification =
		input.options.codeReview && !focusedReview
			? input.planSpec.body || "(missing)"
			: focusedReview
				? "(focused rework Reviewのため、Plan全体の再読は省略)"
				: "(codeReview=false のため、コードレビュー用 Plan 本文は省略)";
	const acceptanceCriteria =
		input.options.codeReview && !focusedReview
			? input.planSpec.acceptanceCriteria
					.map((item) => `- ${item}`)
					.join("\n") || "(none)"
			: focusedReview
				? "(focused rework packetの受け入れ条件だけを使用)"
				: "(codeReview=false のため省略)";
	const codeReviewRule = focusedReview
		? "- focused rework Review。前回Reviewのblocking指摘と修正対象だけを再確認し、全体コードレビューを行わない。"
		: input.options.codeReview
			? "- codeReview=true。レビュー主対象は Review target files に限定し、Plan と対象 diff を根拠にコードレビューする。"
			: input.options.applyFixes
				? "- codeReview=false。機能・仕様の一般コードレビューや全体 diff 取得は行わない。applyFixes=true は accepted finding を correction Implementation へ送るだけで、Review Run自身は編集しない。"
				: "- codeReview=false。Review target boundary はスコープ表示専用であり、機能・仕様のコードレビューを行わない。git diff を取得せず、source / test / schema / migration の内容を個別に読まない。事前取得済み Review evidence だけを使用する。";
	return [
		"Review Run を開始してください。",
		"",
		`reviewSessionId: ${input.session.id}`,
		`reviewedRunId: ${input.session.runId}`,
		`options: ${JSON.stringify(input.options)}`,
		"",
		"Plan specification:",
		planSpecification,
		"",
		"Acceptance criteria:",
		acceptanceCriteria,
		"",
		input.options.codeReview
			? "Review target files:"
			: "Review target boundary (metadata only):",
		targetLines ||
			(focusedPaths.length
				? focusedPaths.map((path) => `- ${path}`).join("\n")
				: "(none)"),
		"",
		"Excluded dirty files:",
		input.target.excludedDirtyFiles.map((file) => `- ${file}`).join("\n") ||
			"(none)",
		"",
		"Target warnings:",
		warningLines || "(none)",
		"",
		"NightWorkers が事前取得した Review evidence:",
		initialFindingLines || "(none)",
		"",
		"Required Review Run TODOs:",
		input.todos.map((todo, index) => `${index + 1}. ${todo.title}`).join("\n"),
		"",
		"Rules:",
		"- Required Review Run TODOs は TodoList pane の進捗 source of truth です。各段階が終わったら todo_list operation=done で次へ進み、未完了なら block/fail で理由を残す。",
		codeReviewRule,
		...(focusedReview
			? [
					"- focused rework Review: 前回Reviewのblocking指摘と、その修正diff・関連テストだけを再確認する。対象外の全体レビュー、Plan全体の再読、vulnWorkbenchの再実行は行わない。",
					`- focused rework scope:\n${formatMissionPilotReworkPacket(input.missionPilotReworkPacket)}`,
				]
			: []),
		"- Findings は重大度、file/line、根拠、推奨アクションを分けて報告する。",
		"- findings 保存用の別ファイルを作成しない。final report には repoRoot 外のローカルファイルパスや /tmp /private/tmp への Markdown link を書かず、指摘は final report と Review Status artifact に残す。",
		input.options.securityReview
			? "- security review は NightWorkers 側で実行またはProject policyによるskip判定が完了済み。上記 Review evidence を主根拠にし、対象 repository 内で vulnWorkbench を検索・再実行しない。"
			: "- security review option は off。",
		input.options.applyFixes
			? "- applyFixes=true は accepted findings を新しい Implementation correction Session に handoff する権限です。Review Run内でsource edit/verify/commitを行わない。"
			: "- applyFixes=false のため、ファイルを編集しない。",
		input.options.commitChanges
			? "- commitChanges=true は correction Implementation -> Test -> Review pass 後のcloseout権限であり、Review Run内ではcommitしない。"
			: "- commitChanges=false のため、commit しない。",
		...(input.missionPilot
			? [
					"- Mission Pilot Review の最終回答は説明文ではなく、次の構造だけを持つJSON objectにする: verdict(pass|rework|attention), summary, findings。",
					"- findingsの各要素は severity(blocking|warning|info), category, file, line, evidence, recommendedAction, blockingReason を持つ。指摘がなければ空配列にする。",
					"- file、line、blockingReason に該当値がない場合もキーを省略せず null を設定する。",
					"- correction Session の起動はReview Run完了後にシステムが行うため、summaryでは起動・引き渡し完了を断定せず、修正要求が必要であることだけを述べる。",
					"- blocking findingが1件でもあればverdict=passにしない。",
				]
			: []),
	].join("\n");
}
