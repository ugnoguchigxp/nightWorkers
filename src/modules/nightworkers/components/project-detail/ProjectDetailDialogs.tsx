import { Check, Loader2, Pencil, Sparkles, Trash2, X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { getMissionGoalTemplatesForStack } from "../../../../../shared/mission-goal-templates";
import type { Mission } from "../../../../../shared/schemas/mission-planner.schema";
import type {
	MissionGoal,
	ProjectStackProfile,
} from "../../../../../shared/schemas/project-detail.schema";
import {
	isMissionDeleteInProgress,
	toggleMissionGoalTemplate,
} from "./mission-model";
import { ActiveChip, IconActionButton, KpiTile } from "./ProjectDetailCommon";
import {
	controlStyle,
	mutedTextStyle,
	panelStyle,
	primaryButtonStyle,
	subtleTextStyle,
} from "./styles";
import type { GoalDraft, UnifiedTaskCandidate } from "./types";

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
				className="w-full max-w-lg border p-3"
				style={panelStyle}
			>
				<div className="text-sm font-bold">
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
	onGenerateMissionCandidates,
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
	onGenerateMissionCandidates: (goal: MissionGoal) => void;
}) {
	const { t } = useTranslation();
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<div
				role="dialog"
				aria-modal="true"
				className="nightworkers-scrollbar max-h-[90vh] w-full max-w-2xl overflow-y-auto border p-4"
				style={panelStyle}
			>
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="text-base font-bold">{goal.title}</div>
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
						onClick={() => onGenerateMissionCandidates(goal)}
						disabled={busy}
						style={controlStyle}
					>
						<Sparkles className="h-3.5 w-3.5" />
						{t("projectDetail.mission.generateMissionCandidates")}
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
	);
}

export function MissionCandidateModal({
	mission,
	goals,
	taskCandidateCount = 0,
	busy,
	onClose,
	onDecompose,
	onDelete,
}: {
	mission: Mission;
	goals: MissionGoal[];
	taskCandidateCount?: number;
	busy: boolean;
	onClose: () => void;
	onDecompose: (mission: Mission) => void;
	onDelete: (mission: Mission) => void;
}) {
	const { t } = useTranslation();
	const canDeleteMission =
		!isMissionDeleteInProgress(mission.status) && taskCandidateCount === 0;
	const sourceGoals = mission.sourceGoalIds
		.map((goalId) => goals.find((goal) => goal.id === goalId))
		.filter((goal): goal is MissionGoal => Boolean(goal));
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<div
				role="dialog"
				aria-modal="true"
				className="nightworkers-scrollbar max-h-[90vh] w-full max-w-2xl overflow-y-auto border p-4"
				style={panelStyle}
			>
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="text-base font-bold">{mission.title}</div>
						<div className="mt-1 text-xs" style={mutedTextStyle}>
							{t(`projectDetail.mission.status.${mission.status}`, {
								defaultValue: mission.status,
							})}
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
				<DrawerSection
					title={t("projectDetail.mission.goalText")}
					body={mission.goalText}
				/>
				{mission.statusReason ? (
					<DrawerSection
						title={t("projectDetail.mission.rationale")}
						body={mission.statusReason}
					/>
				) : null}
				{mission.nonGoals.length > 0 ? (
					<DrawerSection
						title={t("projectDetail.mission.nonGoals")}
						body={mission.nonGoals.join("\n")}
					/>
				) : null}
				<section className="mt-4">
					<div className="text-xs font-bold">
						{t("projectDetail.mission.linkedGoals")}
					</div>
					<div className="mt-2 space-y-2">
						{sourceGoals.length > 0 ? (
							sourceGoals.map((goal) => (
								<div
									key={goal.id}
									className="border p-2 text-xs"
									style={controlStyle}
								>
									<div className="font-semibold">{goal.title}</div>
									<div className="mt-1" style={mutedTextStyle}>
										{goal.goalText}
									</div>
								</div>
							))
						) : (
							<div className="text-xs" style={mutedTextStyle}>
								{t("projectDetail.mission.noLinkedGoal")}
							</div>
						)}
					</div>
				</section>
				<div className="mt-4 flex justify-end gap-2">
					<Button
						type="button"
						onClick={() => onDelete(mission)}
						disabled={busy || !canDeleteMission}
						title={
							taskCandidateCount > 0
								? t("projectDetail.mission.deleteMissionBlockedByChildren")
								: undefined
						}
						style={controlStyle}
					>
						<Trash2 className="h-3.5 w-3.5" />
						{t("projectDetail.mission.deleteMission")}
					</Button>
					<Button
						type="button"
						onClick={onClose}
						disabled={busy}
						style={controlStyle}
					>
						{t("projectDetail.mission.close")}
					</Button>
					<Button
						type="button"
						onClick={() => onDecompose(mission)}
						disabled={
							busy ||
							mission.status === "review_pending" ||
							mission.status === "active"
						}
						style={primaryButtonStyle}
					>
						{busy ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Sparkles className="h-3.5 w-3.5" />
						)}
						{t("projectDetail.mission.decomposeToTaskCandidates")}
					</Button>
				</div>
			</div>
		</div>
	);
}

export function TaskCandidateDetailModal({
	candidate,
	goals,
	busy,
	onClose,
	onCreateTask,
	onDismiss,
}: {
	candidate: UnifiedTaskCandidate;
	goals: MissionGoal[];
	busy: boolean;
	onClose: () => void;
	onCreateTask: (candidate: UnifiedTaskCandidate) => void;
	onDismiss: (candidate: UnifiedTaskCandidate) => void;
}) {
	const { t } = useTranslation();
	const constraintGoalLabels = candidate.constraintGoalIds.map((goalId) => {
		const goal = goals.find((item) => item.id === goalId);
		return goal?.title ?? goalId.slice(0, 8);
	});
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<div
				role="dialog"
				aria-modal="true"
				className="nightworkers-scrollbar max-h-[90vh] w-full max-w-2xl overflow-y-auto border p-4"
				style={panelStyle}
			>
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="text-base font-bold">{candidate.title}</div>
						<div className="mt-1 text-xs" style={mutedTextStyle}>
							{candidate.goalTitle ||
								candidate.goalId ||
								t("projectDetail.mission.noLinkedGoal")}
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
				<div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
					<KpiTile
						label={t("projectDetail.field.kind")}
						value={t(
							`projectDetail.mission.candidateKind.${candidate.candidateKind}`,
						)}
						sub={t("projectDetail.mission.candidateKindSub")}
					/>
					<KpiTile
						label={t("projectDetail.mission.primaryModule")}
						value={candidate.moduleRouting.primaryModule ?? "—"}
						sub={
							candidate.moduleRouting.confidencePercent > 0
								? `${candidate.moduleRouting.confidencePercent}%`
								: "—"
						}
					/>
				</div>
				{candidate.moduleRouting.secondaryModules.length > 0 ||
				candidate.moduleRouting.reason ||
				candidate.constraintGoalIds.length > 0 ? (
					<div className="mt-4 border p-2 text-xs" style={controlStyle}>
						{candidate.moduleRouting.secondaryModules.length > 0 ? (
							<div>
								<span className="font-semibold">
									{t("projectDetail.mission.secondaryModules")}:
								</span>{" "}
								{candidate.moduleRouting.secondaryModules.join(", ")}
							</div>
						) : null}
						{candidate.constraintGoalIds.length > 0 ? (
							<div className="mt-1">
								<span className="font-semibold">
									{t("projectDetail.mission.constraintGoals")}:
								</span>{" "}
								{constraintGoalLabels.join(", ")}
							</div>
						) : null}
						{candidate.moduleRouting.reason ? (
							<div className="mt-1" style={mutedTextStyle}>
								{candidate.moduleRouting.reason}
							</div>
						) : null}
					</div>
				) : null}
				<DrawerSection
					title={t("projectDetail.mission.summary")}
					body={candidate.summary}
				/>
				<DrawerSection
					title={t("projectDetail.mission.rationale")}
					body={candidate.rationale}
				/>
				<DrawerSection
					title={t("projectDetail.mission.taskPrompt")}
					body={candidate.taskPrompt}
				/>
				<DrawerSection
					title={t("projectDetail.mission.acceptanceCriteria")}
					body={candidate.acceptanceCriteria}
				/>
				<DrawerSection
					title={t("projectDetail.mission.verificationPlan")}
					body={candidate.verificationPlan}
				/>
				{candidate.planModeOpenQuestions.length > 0 ? (
					<section className="mt-4">
						<div className="text-xs font-bold">
							{t("projectDetail.mission.planModeOpenQuestions")}
						</div>
						<ul className="mt-2 space-y-1 text-xs" style={mutedTextStyle}>
							{candidate.planModeOpenQuestions.map((item) => (
								<li key={item}>- {item}</li>
							))}
						</ul>
					</section>
				) : null}
				<div className="mt-4">
					<div className="text-xs font-bold">
						{t("projectDetail.mission.evidence")}
					</div>
					<div className="mt-2 space-y-2">
						{candidate.evidence.length > 0 ? (
							candidate.evidence.map((item, _index) => (
								<div
									key={`${item.source}-${item.label}-${item.value}`}
									className="border p-2 text-xs"
									style={controlStyle}
								>
									<div className="font-semibold">{item.label}</div>
									<div className="mt-1" style={mutedTextStyle}>
										{item.value}
									</div>
								</div>
							))
						) : (
							<div className="text-xs" style={mutedTextStyle}>
								—
							</div>
						)}
					</div>
				</div>
				<div className="mt-4 grid grid-cols-2 gap-2 text-xs">
					<KpiTile
						label={t("projectDetail.field.importance")}
						value={
							candidate.importancePercent === null
								? "—"
								: `${candidate.importancePercent}%`
						}
						sub={t("projectDetail.mission.importanceSub")}
					/>
					<KpiTile
						label={t("projectDetail.field.confidence")}
						value={
							candidate.confidencePercent === null
								? "—"
								: `${candidate.confidencePercent}%`
						}
						sub={t("projectDetail.mission.confidenceSub")}
					/>
				</div>
				<div className="mt-4 flex justify-end gap-2">
					<Button
						type="button"
						onClick={() => onDismiss(candidate)}
						disabled={busy || candidate.status !== "candidate"}
						style={controlStyle}
					>
						{t("projectDetail.mission.deleteCandidate")}
					</Button>
					<Button
						type="button"
						onClick={() => onCreateTask(candidate)}
						disabled={busy || candidate.status !== "candidate"}
						style={primaryButtonStyle}
					>
						{t("projectDetail.mission.createSingleTask")}
					</Button>
				</div>
			</div>
		</div>
	);
}

function DrawerSection({ title, body }: { title: string; body: string }) {
	return (
		<section className="mt-4">
			<div className="text-xs font-bold">{title}</div>
			<p className="mt-1 whitespace-pre-wrap text-xs" style={mutedTextStyle}>
				{body}
			</p>
		</section>
	);
}
