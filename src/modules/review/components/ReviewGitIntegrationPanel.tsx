import { useEffect, useState } from "react";
import {
	deferRunGitMerge,
	executeRunGitMerge,
	overrideRunGitMergeTarget,
	previewRunGitMerge,
	reworkRunGitMerge,
} from "../../nightworkers/nightWorkersCommands";
import type { GitCloseoutState } from "../../nightworkers/types/core";

const buttonClass =
	"inline-flex h-8 items-center justify-center gap-1.5 rounded border px-3 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:shadow-none";

export function ReviewGitIntegrationPanel({
	mergeRecord: externalRecord,
	onError,
}: {
	mergeRecord: GitCloseoutState["mergeRecord"];
	onError: (message: string | null) => void;
}) {
	const [record, setRecord] = useState(externalRecord);
	const [busy, setBusy] = useState(false);
	useEffect(() => setRecord(externalRecord), [externalRecord]);
	if (!record) return null;
	const apply = async (kind: "preview" | "defer" | "rework" | "merge") => {
		setBusy(true);
		onError(null);
		try {
			const response =
				kind === "preview"
					? await previewRunGitMerge(record.runId, record.recordVersion)
					: kind === "defer"
						? await deferRunGitMerge(record.runId, record.recordVersion)
						: kind === "rework"
							? await reworkRunGitMerge(record.runId, record.recordVersion)
							: await executeRunGitMerge(record.runId, record.recordVersion);
			if (!response.ok) throw new Error(await response.text());
			setRecord(await response.json());
		} catch (error) {
			onError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};
	const changeTarget = async () => {
		const targetBranch = window
			.prompt(
				"新しいlocal merge target branchを入力してください。previewとCI証跡は無効になります。",
				record.targetBranch,
			)
			?.trim();
		if (!targetBranch || targetBranch === record.targetBranch) return;
		if (!window.confirm(`merge targetを ${targetBranch} に変更しますか？`))
			return;
		setBusy(true);
		try {
			const response = await overrideRunGitMergeTarget(
				record.runId,
				targetBranch,
				record.recordVersion,
			);
			if (!response.ok) throw new Error(await response.text());
			setRecord(await response.json());
		} catch (error) {
			onError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="rounded border border-slate-800 bg-slate-950/40 p-3 text-xs">
			<div className="font-medium text-slate-100">Review merge</div>
			<div className="mt-2 grid gap-1 text-slate-400 md:grid-cols-2">
				<span>
					Source: {record.sourceBranch} @ {record.sourceCommitSha.slice(0, 10)}
				</span>
				<span>
					Target: {record.targetBranch} @{" "}
					{(record.observedTargetSha ?? record.targetSelectedSha).slice(0, 10)}
				</span>
				<span>Plan base: {record.planTargetBaseSha.slice(0, 10)}</span>
				<span>
					Status: {record.status} / {record.strategy}
				</span>
			</div>
			{record.lastErrorMessage ? (
				<div className="mt-2 text-amber-200">{record.lastErrorMessage}</div>
			) : null}
			<div className="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					className={`${buttonClass} nightworkers-primary-action-button`}
					disabled={busy || record.status === "merged"}
					onClick={() => void apply("preview")}
				>
					再評価
				</button>
				<button
					type="button"
					className={`${buttonClass} nightworkers-success-action-button`}
					disabled={busy || record.status !== "merge_ready"}
					onClick={() => void apply("merge")}
				>
					マージ
				</button>
				<button
					type="button"
					className={buttonClass}
					disabled={busy || record.status === "merged"}
					onClick={() => void apply("defer")}
				>
					後で判断
				</button>
				<button
					type="button"
					className={buttonClass}
					disabled={busy || record.status === "merged"}
					onClick={() => void apply("rework")}
				>
					再作業
				</button>
				<button
					type="button"
					className={buttonClass}
					disabled={busy || record.status === "merged"}
					onClick={() => void changeTarget()}
				>
					統合先を変更
				</button>
			</div>
		</div>
	);
}
