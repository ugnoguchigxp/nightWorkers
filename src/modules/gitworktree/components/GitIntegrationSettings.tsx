import { useEffect, useState } from "react";
import {
	defaultProjectGitIntegrationPolicy,
	type ProjectGitIntegrationPolicy,
} from "../../../../shared/schemas/git-integration.schema";
import {
	fetchRepositoryGitIntegration,
	readGitworktreeResponse,
	updateRepositoryGitIntegration,
} from "../api/gitworktreeCommands";
import {
	controlStyle,
	panelStyle,
	primaryButtonStyle,
} from "./gitworktreeStyles";

type RepositoryGitSettings = {
	branch: string;
	gitIntegrationPolicyJson?: ProjectGitIntegrationPolicy | null;
	gitIntegrationVersion: number;
};

export function GitIntegrationSettings({
	repositoryId,
}: {
	repositoryId: string;
}) {
	const [branch, setBranch] = useState("");
	const [policy, setPolicy] = useState<ProjectGitIntegrationPolicy>(
		defaultProjectGitIntegrationPolicy,
	);
	const [version, setVersion] = useState(0);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	useEffect(() => {
		void fetchRepositoryGitIntegration(repositoryId)
			.then((response) =>
				readGitworktreeResponse<RepositoryGitSettings>(response),
			)
			.then((value) => {
				setBranch(value.branch);
				setPolicy(
					value.gitIntegrationPolicyJson ?? defaultProjectGitIntegrationPolicy,
				);
				setVersion(value.gitIntegrationVersion ?? 0);
			});
	}, [repositoryId]);
	const save = async () => {
		setBusy(true);
		setMessage("");
		try {
			const value = await readGitworktreeResponse<RepositoryGitSettings>(
				await updateRepositoryGitIntegration(repositoryId, {
					branch,
					gitIntegrationPolicy: policy,
					expectedGitIntegrationVersion: version,
				}),
			);
			setVersion(value.gitIntegrationVersion);
			setMessage("保存しました");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="space-y-3 border p-4" style={panelStyle}>
			<h3 className="text-sm font-semibold">既定のマージ先</h3>
			<div className="grid gap-3 md:grid-cols-3">
				<input
					aria-label="既定のマージ先"
					className="h-9 border px-2 text-sm"
					style={controlStyle}
					value={branch}
					onChange={(event) => setBranch(event.target.value)}
				/>
				<select
					aria-label="マージ方式"
					className="h-9 border px-2 text-sm"
					style={controlStyle}
					value={policy.defaultMergeStrategy}
					onChange={(event) =>
						setPolicy({
							...policy,
							defaultMergeStrategy: event.target
								.value as ProjectGitIntegrationPolicy["defaultMergeStrategy"],
						})
					}
				>
					<option value="merge_commit">merge commit</option>
					<option value="squash">squash</option>
					<option value="fast_forward_only">fast-forward only</option>
				</select>
				<select
					aria-label="CI gate"
					className="h-9 border px-2 text-sm"
					style={controlStyle}
					value={policy.ciGate}
					onChange={(event) =>
						setPolicy({
							...policy,
							ciGate: event.target
								.value as ProjectGitIntegrationPolicy["ciGate"],
						})
					}
				>
					<option value="none">CI gateなし</option>
					<option value="external_ci_required">外部CI必須</option>
				</select>
				<input
					aria-label="Git remote"
					className="h-9 border px-2 text-sm"
					style={controlStyle}
					placeholder="remote（任意）"
					value={policy.remoteName ?? ""}
					onChange={(event) =>
						setPolicy({
							...policy,
							remoteName: event.target.value.trim() || null,
						})
					}
				/>
				<select
					aria-label="source push policy"
					className="h-9 border px-2 text-sm"
					style={controlStyle}
					value={policy.sourcePushPolicy}
					onChange={(event) =>
						setPolicy({
							...policy,
							sourcePushPolicy: event.target
								.value as ProjectGitIntegrationPolicy["sourcePushPolicy"],
						})
					}
				>
					<option value="optional">source push任意</option>
					<option value="required_before_merge">merge前source push必須</option>
				</select>
				<select
					aria-label="target push policy"
					className="h-9 border px-2 text-sm"
					style={controlStyle}
					value={policy.targetPushPolicy}
					onChange={(event) =>
						setPolicy({
							...policy,
							targetPushPolicy: event.target
								.value as ProjectGitIntegrationPolicy["targetPushPolicy"],
						})
					}
				>
					<option value="manual">target push手動</option>
					<option value="after_merge">merge後target push</option>
				</select>
			</div>
			<div className="flex items-center gap-3">
				<button
					type="button"
					disabled={busy || !branch.trim()}
					onClick={() => void save()}
					className="h-9 border px-3 text-sm"
					style={primaryButtonStyle}
				>
					保存
				</button>
				{message ? <span className="text-xs">{message}</span> : null}
			</div>
		</section>
	);
}
