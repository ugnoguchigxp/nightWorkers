import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "../../lib/errors";
import { runCommandTool } from "../../services/worker-tools/run-command";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import {
	detectProjectStackProfile,
	renderProjectStackContext,
} from "../techStack";

export async function resolvePlanModeProjectStackContext(repositoryId: string) {
	return (await resolvePlanModeQuestionnaireProjectContext(repositoryId))
		.projectStackContext;
}

export type PlanModeQuestionnaireRepositoryPolicy =
	| "repository_fixed"
	| "starter_selection_required";

export type PlanModeQuestionnaireProjectContext = {
	projectStackContext: string;
	repositoryPolicy: PlanModeQuestionnaireRepositoryPolicy;
};

const MAX_PROJECT_INSTRUCTION_CONTEXT_BYTES = 32 * 1024;

export async function resolvePlanModeQuestionnaireProjectContext(
	repositoryId: string,
): Promise<PlanModeQuestionnaireProjectContext> {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) {
		throw new AppError(
			409,
			"QUESTIONNAIRE_REPOSITORY_PREFLIGHT_FAILED",
			"Questionnaire開始前のpwdとlsを実行する登録済みProjectが見つかりません。",
		);
	}
	const repositoryPreflight = await inspectPlanModeProjectRoot({
		repositoryRoot: repository.localPath,
		safetyPolicy: repository.safetyPolicy ?? undefined,
	});
	const projectInstructionContext = readPlanModeProjectInstructionContext(
		repository.localPath,
	);
	const repositoryPolicy = resolvePlanModeQuestionnaireRepositoryPolicy({
		gitHead: repositoryPreflight.gitHead,
		hasProjectInstructionContext: projectInstructionContext !== null,
	});
	const projectStackContext = [
		"Target Project Context",
		`- Project name: ${repository.name}`,
		`- Project root: ${repository.localPath}`,
		"",
		renderPlanModeProjectRootPreflight(repositoryPreflight),
		"",
		renderProjectStackContext(detectProjectStackProfile(repository.localPath), {
			repositoryHasGitHead: repositoryPreflight.gitHead !== null,
		}),
		"",
		renderPlanModeQuestionnaireRepositoryPolicy(repositoryPolicy),
		...(projectInstructionContext
			? ["", renderPlanModeProjectInstructionContext(projectInstructionContext)]
			: []),
		"",
		renderPlanModePackageScriptsContext(repository.localPath),
	].join("\n");
	return { projectStackContext, repositoryPolicy };
}

export type PlanModeProjectInstructionContext = {
	path: string;
	content: string;
	digest: string;
	byteLength: number;
	includedByteLength: number;
	truncated: boolean;
};

export function resolvePlanModeQuestionnaireRepositoryPolicy(input: {
	gitHead: string | null;
	hasProjectInstructionContext: boolean;
}): PlanModeQuestionnaireRepositoryPolicy {
	return input.gitHead !== null || input.hasProjectInstructionContext
		? "repository_fixed"
		: "starter_selection_required";
}

export function readPlanModeProjectInstructionContext(
	repoRoot: string,
): PlanModeProjectInstructionContext | null {
	const instructionPath = path.join(repoRoot, "LLM_CONTEXT.md");
	if (!fs.existsSync(instructionPath)) return null;
	try {
		const stat = fs.statSync(instructionPath);
		if (!stat.isFile()) return null;
		const source = fs.readFileSync(instructionPath);
		const included = source.subarray(
			0,
			Math.min(source.byteLength, MAX_PROJECT_INSTRUCTION_CONTEXT_BYTES),
		);
		return {
			path: instructionPath,
			content: included.toString("utf8"),
			digest: `sha256:${crypto.createHash("sha256").update(source).digest("hex")}`,
			byteLength: source.byteLength,
			includedByteLength: included.byteLength,
			truncated: included.byteLength < source.byteLength,
		};
	} catch {
		return null;
	}
}

export function renderPlanModeQuestionnaireRepositoryPolicy(
	policy: PlanModeQuestionnaireRepositoryPolicy,
) {
	return policy === "repository_fixed"
		? [
				"Questionnaire repository policy:",
				"- state: existing_materialized_project",
				"- 技術スタック、runtime、framework、starter template、DB製品、永続化platformはrepositoryの確定済み事実です。",
				"- ユーザーが移行または置換を明示的に依頼していない限り、これらの再選択をQuestionnaireで質問しないでください。",
			].join("\n")
		: [
				"Questionnaire repository policy:",
				"- state: empty_unmaterialized_project",
				"- 実装前にstarter templateを一意に選べない場合だけ、技術スタックとDB/永続化をQuestionnaireで確認できます。",
			].join("\n");
}

export function renderPlanModeProjectInstructionContext(
	context: PlanModeProjectInstructionContext,
) {
	return [
		"Project instruction context (LLM_CONTEXT.md):",
		`- source: ${context.path}`,
		`- digest: ${context.digest}`,
		`- bytes: ${context.byteLength}`,
		`- included byte range: 0-${context.includedByteLength}`,
		`- truncated: ${context.truncated}`,
		...(context.truncated
			? ["- 続きはsource pathから再取得してください。"]
			: []),
		"--- LLM_CONTEXT.md begin ---",
		context.content.trimEnd(),
		"--- LLM_CONTEXT.md end ---",
	].join("\n");
}

export type PlanModeProjectRootPreflight = {
	version: 1;
	workingDirectory: string;
	directoryListing: string;
	directoryListingDigest: string;
	directoryListingTruncated: boolean;
	directoryListingArtifactPath: string | null;
	gitHead: string | null;
	gitHeadStatus: "present" | "not_verified";
	checks: [
		{ command: "pwd"; status: "passed" },
		{ command: "ls"; status: "passed" },
	];
};

/** Questionnaireへ渡す前に登録済みProject rootを固定順序で観測する。 */
export async function inspectPlanModeProjectRoot(input: {
	repositoryRoot: string;
	safetyPolicy?: {
		allowedPaths?: string[];
		externalAllowedPaths?: string[];
		deniedPaths?: string[];
		blockedCommands?: string[];
		maxCommandSeconds?: number;
	};
}): Promise<PlanModeProjectRootPreflight> {
	const policy = input.safetyPolicy ?? {};
	const pwd = await runCommandTool({
		command: "pwd",
		repoRoot: input.repositoryRoot,
		timeoutSeconds: 10,
		...policy,
	});
	assertQuestionnairePreflightCommand("pwd", pwd);

	const ls = await runCommandTool({
		command: "ls",
		repoRoot: input.repositoryRoot,
		timeoutSeconds: 10,
		...policy,
	});
	assertQuestionnairePreflightCommand("ls", ls);

	const gitHeadResult = await runCommandTool({
		command: "git rev-parse --verify HEAD^{commit}",
		repoRoot: input.repositoryRoot,
		timeoutSeconds: 10,
		...policy,
	});
	const gitHead =
		gitHeadResult.ok && gitHeadResult.payload.exitCode === 0
			? gitHeadResult.payload.stdout.trim() || null
			: null;

	return {
		version: 1,
		workingDirectory: pwd.payload.stdout.trim(),
		directoryListing: ls.payload.stdout.trimEnd(),
		directoryListingDigest: ls.payload.stdoutDigest,
		directoryListingTruncated: ls.payload.truncated,
		directoryListingArtifactPath: ls.payload.logArtifactPath ?? null,
		gitHead,
		gitHeadStatus: gitHead ? "present" : "not_verified",
		checks: [
			{ command: "pwd", status: "passed" },
			{ command: "ls", status: "passed" },
		],
	};
}

export function renderPlanModeProjectRootPreflight(
	preflight: PlanModeProjectRootPreflight,
) {
	return [
		"Questionnaire開始前のRepository観測（固定順序）",
		"- pwd: passed",
		`- working directory実測値: ${preflight.workingDirectory}`,
		"- ls: passed",
		`- ls digest: ${preflight.directoryListingDigest}`,
		`- ls truncated: ${preflight.directoryListingTruncated}`,
		...(preflight.directoryListingArtifactPath
			? [`- ls全出力の保存先: ${preflight.directoryListingArtifactPath}`]
			: []),
		"- ls出力:",
		preflight.directoryListing || "(empty)",
		preflight.gitHeadStatus === "present"
			? `- Git HEAD: ${preflight.gitHead}`
			: "- Git HEAD: 未確認（確定済みの既存stackとして扱わない）",
	].join("\n");
}

function assertQuestionnairePreflightCommand(
	command: "pwd" | "ls",
	result: Awaited<ReturnType<typeof runCommandTool>>,
) {
	if (result.ok && result.payload.exitCode === 0) return;
	throw new AppError(
		409,
		"QUESTIONNAIRE_REPOSITORY_PREFLIGHT_FAILED",
		`Questionnaire開始前の${command}に失敗しました: ${result.error?.message ?? (result.payload.stderr || "unknown error")}`,
	);
}

export function renderPlanModePackageScriptsContext(repoRoot: string) {
	const scripts = readPackageScripts(repoRoot);
	if (scripts.length === 0) {
		return [
			"Project package scripts:",
			"- package.json scripts は未検出です。",
		].join("\n");
	}
	return [
		"Project package scripts:",
		...scripts.map(([name, command]) => `- ${name}: ${command}`),
	].join("\n");
}

function readPackageScripts(repoRoot: string): Array<[string, string]> {
	const packageJsonPath = path.join(repoRoot, "package.json");
	if (!fs.existsSync(packageJsonPath)) return [];
	try {
		const parsed = JSON.parse(
			fs.readFileSync(packageJsonPath, "utf8"),
		) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return [];
		const scripts = (parsed as Record<string, unknown>).scripts;
		if (!scripts || typeof scripts !== "object" || Array.isArray(scripts))
			return [];
		return Object.entries(scripts).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		);
	} catch {
		return [];
	}
}
