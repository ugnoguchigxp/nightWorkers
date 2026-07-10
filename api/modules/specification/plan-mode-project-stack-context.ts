import fs from "node:fs";
import path from "node:path";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import {
	detectProjectStackProfile,
	renderProjectStackContext,
} from "../techStack";

export async function resolvePlanModeProjectStackContext(repositoryId: string) {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) return renderProjectStackContext(null);
	return [
		"Target Project Context",
		`- Project name: ${repository.name}`,
		`- Project root: ${repository.localPath}`,
		"",
		renderProjectStackContext(detectProjectStackProfile(repository.localPath)),
		"",
		renderPlanModePackageScriptsContext(repository.localPath),
	].join("\n");
}

export function renderPlanModePackageScriptsContext(repoRoot: string) {
	const scripts = readPackageScripts(repoRoot);
	if (scripts.length === 0) {
		return [
			"Project package scripts:",
			"- package.json scripts は未検出です。検証 command は推測で作らず、既存 tooling を確認してください。",
			"- 検証方針: template を使わない場合でも、既存構成に合わせた最小の verify 系 script を追加する手順を実装計画に入れてください。",
			"- verify 系 script は build / typecheck / lint / test など、この repository で実行可能な確認を束ねる quality gate として作ってください。",
		].join("\n");
	}
	const preferredOrder = [
		"verify",
		"verify:base",
		"verify:fast",
		"typecheck",
		"lint",
		"test",
		"test:unit",
		"test:e2e",
		"build",
	];
	const scriptByName = new Map(scripts);
	const ordered = [
		...preferredOrder.filter((name) => scriptByName.has(name)),
		...scripts
			.map(([name]) => name)
			.filter((name) => !preferredOrder.includes(name))
			.slice(0, 10),
	];
	const hasRepresentativeVerify =
		scriptByName.has("verify") || scriptByName.has("verify:base");
	const hasCoveredIndividualCheck = ["build", "typecheck", "lint", "test"].some(
		(name) => scriptByName.has(name),
	);
	const verificationGuidance =
		hasRepresentativeVerify && hasCoveredIndividualCheck
			? [
					"- 検証方針: verify / verify:base がある場合は代表 gate として優先し、同じ目的の build / typecheck / lint / test を検証計画に同列で重複列挙しないでください。",
					"- 個別の検証 script は対象範囲の確認または verify で代替できない理由がある場合だけ使ってください。",
				]
			: !hasRepresentativeVerify && hasCoveredIndividualCheck
				? [
						"- 検証方針: verify / verify:base が無い場合は、既存の build / typecheck / lint / test を束ねる verify 系 script の追加を実装計画に入れてください。",
						"- 検証計画では、追加した verify 系 script を代表 gate として扱い、個別 script は対象範囲の確認または失敗時の切り分けに限定してください。",
					]
				: [];
	return [
		"Project package scripts:",
		...ordered.map((name) => `- ${name}: ${scriptByName.get(name)}`),
		...verificationGuidance,
		"- Feature Plan の検証コマンドは、上記に存在する script 名だけを使ってください。存在しない script は推測しないでください。",
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
