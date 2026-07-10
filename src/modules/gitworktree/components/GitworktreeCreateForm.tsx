import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { CreateWorktreeRequest } from "../../../../shared/schemas/gitworktree.schema";
import {
	controlStyle,
	panelStyle,
	primaryButtonStyle,
} from "./gitworktreeStyles";

type GitworktreeCreateFormProps = {
	draft: CreateWorktreeRequest;
	setDraft: Dispatch<SetStateAction<CreateWorktreeRequest>>;
	disabled: boolean;
	creating: boolean;
	onSubmit: () => void;
	onCancel: () => void;
};

export function GitworktreeCreateForm({
	draft,
	setDraft,
	disabled,
	creating,
	onSubmit,
	onCancel,
}: GitworktreeCreateFormProps) {
	const { t } = useTranslation();
	return (
		<form
			className="grid gap-3 border p-4 md:grid-cols-2"
			style={panelStyle}
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<label className="space-y-1 text-xs">
				<span>{t("projectDetail.worktrees.createMode")}</span>
				<select
					className="h-9 w-full border px-2"
					style={controlStyle}
					disabled={disabled}
					value={draft.mode}
					onChange={(event) =>
						setDraft(
							event.target.value === "existing_branch"
								? {
										mode: "existing_branch",
										branchName: draft.branchName,
									}
								: {
										mode: "new_branch",
										branchName: draft.branchName,
										startPoint: "HEAD",
									},
						)
					}
				>
					<option value="new_branch">
						{t("projectDetail.worktrees.newBranch")}
					</option>
					<option value="existing_branch">
						{t("projectDetail.worktrees.existingBranch")}
					</option>
				</select>
			</label>
			<label className="space-y-1 text-xs">
				<span>{t("projectDetail.worktrees.branchName")}</span>
				<input
					className="h-9 w-full border px-2"
					style={controlStyle}
					disabled={disabled}
					required
					value={draft.branchName}
					onChange={(event) =>
						setDraft({ ...draft, branchName: event.target.value })
					}
				/>
			</label>
			{draft.mode === "new_branch" ? (
				<label className="space-y-1 text-xs">
					<span>{t("projectDetail.worktrees.startPoint")}</span>
					<input
						className="h-9 w-full border px-2"
						style={controlStyle}
						disabled={disabled}
						required
						value={draft.startPoint}
						onChange={(event) =>
							setDraft({ ...draft, startPoint: event.target.value })
						}
					/>
				</label>
			) : null}
			<label className="space-y-1 text-xs">
				<span>{t("projectDetail.worktrees.pathOptional")}</span>
				<input
					className="h-9 w-full border px-2"
					style={controlStyle}
					disabled={disabled}
					value={draft.path || ""}
					onChange={(event) =>
						setDraft({ ...draft, path: event.target.value || undefined })
					}
				/>
			</label>
			<div className="flex gap-2 md:col-span-2">
				<button
					type="submit"
					className="h-8 border px-3 text-xs"
					style={primaryButtonStyle}
					disabled={disabled}
				>
					{creating
						? t("projectDetail.worktrees.creating")
						: t("projectDetail.worktrees.confirmCreate")}
				</button>
				<button
					type="button"
					className="h-8 border px-3 text-xs"
					style={controlStyle}
					disabled={disabled}
					onClick={onCancel}
				>
					{t("projectDetail.worktrees.cancel")}
				</button>
			</div>
		</form>
	);
}
