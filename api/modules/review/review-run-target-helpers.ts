import type { ReviewTarget, ReviewTargetWarning } from "./review-mode.model";

export function summarizeTarget(target: ReviewTarget) {
	return {
		runId: target.runId,
		repositoryId: target.repositoryId,
		repoRoot: target.repoRoot,
		planArtifact: target.planArtifact,
		targetFiles: target.targetFiles.map((file) => ({
			path: file.path,
			status: file.status,
			sources: file.sources,
			diffBytes: file.diffBytes,
		})),
		excludedDirtyFiles: target.excludedDirtyFiles,
		signalOnlyFiles: target.signalOnlyFiles,
		diffOnlyFiles: target.diffOnlyFiles,
		warningCount: target.warnings.length,
	};
}

export function extractPlanBullets(body: string, headings: string[]) {
	const lines = body.split("\n");
	const results: string[] = [];
	let active = false;
	for (const line of lines) {
		const heading = /^#{1,4}\s+(.+?)\s*$/.exec(line)?.[1]?.trim() ?? null;
		if (heading) {
			active = headings.some((candidate) =>
				heading.toLowerCase().includes(candidate.toLowerCase()),
			);
			continue;
		}
		if (!active) continue;
		const bullet = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line)?.[1]?.trim();
		if (bullet) results.push(bullet);
	}
	return results;
}

export function reviewTargetWarningTitle(warning: ReviewTargetWarning) {
	if (warning.code === "current_diff_without_edit_signal")
		return "Dirty files outside this run were excluded from Review Run";
	if (warning.code === "edit_signal_without_current_diff")
		return "Run edit signal no longer has a current diff";
	if (warning.code === "plan_artifact_missing")
		return "Plan specification was not found for review";
	if (warning.code === "no_edit_signals")
		return "No edit signals were found for Review Run";
	if (warning.code === "target_file_limit_exceeded")
		return "Review Run target file limit was exceeded";
	return "Review Run target extraction warning";
}
