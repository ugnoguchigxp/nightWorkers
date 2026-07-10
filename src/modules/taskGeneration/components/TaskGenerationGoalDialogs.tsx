import { Check, Pencil, Trash2, X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { getMissionGoalTemplatesForStack } from "../../../../shared/mission-goal-templates";
import type { MissionGoal } from "../../../../shared/schemas/task-generation.schema";
import type { ProjectStackProfile } from "../../../../shared/schemas/tech-stack.schema";
import {
	ActiveChip,
	IconActionButton,
	KpiTile,
} from "../../nightworkers/components/project-detail/ProjectDetailCommon";
import {
	controlStyle,
	panelStyle,
	primaryButtonStyle,
	subtleTextStyle,
} from "../../nightworkers/components/project-detail/styles";
import { toggleMissionGoalTemplate } from "../taskGenerationModel";
import type { GoalDraft } from "../types";
import { DrawerSection } from "./TaskGenerationDialogSection";

export function GoalEditorDialog({
	draft,
	busy,
	stackProfile,
	onChange,
	onClose,
	onSave,
}: {
	draft: GoalDraft;
	busy: boolean;
	stackProfile?: ProjectStackProfile | null;
	onChange: (draft: GoalDraft) => void;
	onClose: () => void;
	onSave: () => void;
}) {
	const { t } = useTranslation();
	const availableTemplates = getMissionGoalTemplatesForStack(stackProfile);
	const selectedTemplateId = availableTemplates.find(
		(template) => template.goalText === draft.goalText,
	)?.id;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="task-generation-goal-editor-title"
				className="w-full max-w-lg border p-3"
				style={panelStyle}
			>
				<div
					id="task-generation-goal-editor-title"
					className="text-sm font-bold"
				>
					{draft.id
						? t("projectDetail.goalDialog.editTitle")
						: t("projectDetail.goalDialog.addTitle")}
				</div>
				<div className="mt-3 space-y-2.5">
					{!draft.id ? (
						<div className="space-y-1">
							<div
								className="text-[11px] font-semibold"
								style={subtleTextStyle}
							>
								{t("projectDetail.goalTemplates.label")}
							</div>
							<div className="grid grid-cols-2 gap-1.5">
								{availableTemplates.map((template) => {
									const selected = selectedTemplateId === template.id;
									return (
										<button
											key={template.id}
											type="button"
											aria-pressed={selected}
											onClick={() =>
												onChange(toggleMissionGoalTemplate(draft, template))
											}
											className="flex h-8 min-w-0 cursor-pointer items-center gap-2 border px-2 text-left text-[11px] font-semibold"
											style={
												selected
													? {
															background:
																"color-mix(in srgb, var(--nw-primary) 12%, var(--nw-panel))",
															borderColor: "var(--nw-primary)",
															borderRadius: "var(--nw-control-radius)",
															color: "var(--nw-primary)",
														}
													: controlStyle
											}
										>
											<span
												aria-hidden
												className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
												style={{
													background: selected
														? "var(--nw-primary)"
														: "transparent",
													borderColor: selected
														? "var(--nw-primary)"
														: "var(--nw-border)",
												}}
											>
												{selected ? (
													<Check
														aria-hidden
														className="h-3 w-3"
														style={{
															color:
																"var(--nw-primary-foreground, var(--nw-background))",
														}}
													/>
												) : null}
											</span>
											<span className="truncate">{template.title}</span>
										</button>
									);
								})}
							</div>
						</div>
					) : null}
					<label className="block text-xs font-semibold">
						{t("projectDetail.goalDialog.title")}
						<input
							value={draft.title}
							onChange={(event) =>
								onChange({ ...draft, title: event.target.value })
							}
							className="mt-1 h-9 w-full border px-2"
							style={controlStyle}
						/>
					</label>
					<label className="block text-xs font-semibold">
						{t("projectDetail.goalDialog.definition")}
						<textarea
							value={draft.goalText}
							onChange={(event) =>
								onChange({ ...draft, goalText: event.target.value })
							}
							className="mt-1 min-h-28 w-full border px-2 py-2"
							style={controlStyle}
						/>
					</label>
					<label className="flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							checked={draft.active}
							onChange={(event) =>
								onChange({ ...draft, active: event.target.checked })
							}
						/>
						{t("projectDetail.goalDialog.active")}
					</label>
				</div>
				<div className="mt-4 flex justify-end gap-2">
					<Button
						type="button"
						onClick={onClose}
						disabled={busy}
						style={controlStyle}
					>
						{t("projectDetail.goalDialog.cancel")}
					</Button>
					<Button
						type="button"
						onClick={onSave}
						disabled={busy || !draft.title.trim() || !draft.goalText.trim()}
						style={primaryButtonStyle}
					>
						{t("projectDetail.goalDialog.save")}
					</Button>
				</div>
			</div>
		</div>
	);
}

export function GoalDetailModal({
	goal,
	missionCount,
	candidateCount,
	busy,
	onClose,
	onEdit,
	onToggle,
	onDelete,
	onGenerateTaskCandidates,
}: {
	goal: MissionGoal;
	missionCount: number;
	candidateCount: number;
	busy: boolean;
	onClose: () => void;
	onEdit: (goal: MissionGoal) => void;
	onToggle: (goal: MissionGoal) => void;
	onDelete: (goal: MissionGoal) => void;
	onGenerateTaskCandidates: (goal: MissionGoal) => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="task-generation-goal-detail-title"
				className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden border"
				style={panelStyle}
			>
				<div className="flex shrink-0 items-start justify-between gap-3 p-4 pb-0">
					<div className="min-w-0">
						<div
							id="task-generation-goal-detail-title"
							className="text-base font-bold"
						>
							{goal.title}
						</div>
						<div className="mt-1">
							<ActiveChip active={goal.active} />
						</div>
					</div>
					<IconActionButton
						label={t("projectDetail.mission.close")}
						onClick={onClose}
						disabled={busy}
					>
						<X className="h-3.5 w-3.5" />
					</IconActionButton>
				</div>
				<div className="nightworkers-scrollbar min-h-0 overflow-y-auto px-4 pb-4">
					<DrawerSection
						title={t("projectDetail.field.goalDefinition")}
						body={goal.goalText}
					/>
					<div className="mt-4 grid grid-cols-2 gap-2 text-xs">
						<KpiTile
							label={t("projectDetail.tree.kind.mission")}
							value={String(missionCount)}
							sub={t("projectDetail.mission.childCountSub")}
						/>
						<KpiTile
							label={t("projectDetail.tree.kind.taskCandidate")}
							value={String(candidateCount)}
							sub={t("projectDetail.mission.childCountSub")}
						/>
					</div>
					<div className="mt-4 flex flex-wrap justify-end gap-2">
						<Button
							type="button"
							onClick={() => onEdit(goal)}
							disabled={busy}
							style={controlStyle}
						>
							<Pencil className="h-3.5 w-3.5" />
							{t("projectDetail.goalDialog.editTitle")}
						</Button>
						<Button
							type="button"
							onClick={() => onToggle(goal)}
							disabled={busy}
							style={controlStyle}
						>
							<Check className="h-3.5 w-3.5" />
							{goal.active
								? t("projectDetail.status.inactive")
								: t("projectDetail.status.active")}
						</Button>
						<Button
							type="button"
							onClick={() => onDelete(goal)}
							disabled={busy}
							style={controlStyle}
						>
							<Trash2 className="h-3.5 w-3.5" />
							{t("projectDetail.goals.delete")}
						</Button>
						<Button
							type="button"
							onClick={() => onGenerateTaskCandidates(goal)}
							disabled={busy}
							style={primaryButtonStyle}
						>
							<Zap className="h-3.5 w-3.5" />
							{t("projectDetail.mission.generate")}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
