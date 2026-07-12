import {
	Bug,
	ClipboardCheck,
	FlaskConical,
	FolderTree,
	ListTodo,
	LoaderCircle,
	MessageCircleMore,
	NotebookPen,
	Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorkbenchArtifactRef } from "../types";
import type { ThreadWorkspaceProps } from "./ThreadWorkspace";

type ThreadWorkspaceHeaderProps = {
	props: ThreadWorkspaceProps;
	blueprintArtifact?: WorkbenchArtifactRef;
	showDebugEvents: boolean;
	setShowDebugEvents: (
		value: boolean | ((previous: boolean) => boolean),
	) => void;
	artifactButtonsCoolingDown: boolean;
	runArtifactButtonAction: (action: () => void) => void;
	openTestModeArtifactWithCooldown: () => void;
	planModeWorkspaceLabel: string;
	noPlanModeWorkspaceLabel: string;
	reviewArtifactLabel: string;
	testModeArtifactLabel: string;
	debugModeTooltipLabel: string;
	pilotThoughtTooltipLabel: string;
	planModeTooltipLabel: string;
	testModeTooltipLabel: string;
	reviewModeTooltipLabel: string;
	todoListTooltipLabel: string;
};

export function ThreadWorkspaceHeader({
	props,
	blueprintArtifact,
	showDebugEvents,
	setShowDebugEvents,
	artifactButtonsCoolingDown,
	runArtifactButtonAction,
	openTestModeArtifactWithCooldown,
	planModeWorkspaceLabel,
	noPlanModeWorkspaceLabel,
	reviewArtifactLabel,
	testModeArtifactLabel,
	debugModeTooltipLabel,
	pilotThoughtTooltipLabel,
	planModeTooltipLabel,
	testModeTooltipLabel,
	reviewModeTooltipLabel,
	todoListTooltipLabel,
}: ThreadWorkspaceHeaderProps) {
	const { t } = useTranslation();
	<div className="shrink-0 border-b border-slate-700/70 bg-[#0f172a] px-6 py-3 pr-16">
		{props.activeSession ? (
			<div className="space-y-2">
				<div className="flex items-center justify-between gap-4">
					<div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm">
						<span className="max-w-[28%] shrink-0 truncate text-slate-300/80">
							{props.activeProject?.name || t("thread.noProject")}
						</span>
						<span className="shrink-0 text-slate-500">&gt;</span>
						<span className="min-w-0 flex-1 truncate font-semibold text-slate-100">
							{props.activeSession.title}
						</span>
						<span className="shrink-0 text-xs text-slate-400">
							{getRelativeTimestamp(props.activeSession.updatedAt)}
						</span>
						<span
							className="shrink-0 rounded border border-slate-700/80 bg-slate-950/35 px-2 py-0.5 font-mono text-[11px] text-slate-300"
							title={formatUsageTitle(props.llmUsageSummary)}
						>
							{formatUsageBadge(props.llmUsageSummary)}
						</span>
						{/*
	                  Do not add a session-state spinner here. The header marker has no
	                  clear meaning for draft/new sessions and repeatedly caused false
	                  "running" indicators beside the debug button.
	                */}
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<button
							type="button"
							className="inline-flex items-center gap-1.5 rounded border border-rose-500/60 bg-rose-950/20 px-2 py-1 text-[10px] uppercase text-rose-100 hover:bg-rose-900/40"
							onClick={() => {
								const ok = window.confirm(
									t("thread.confirmDeleteTask", {
										title: props.activeSession?.title,
									}),
								);
								if (!ok) return;
								props.onDeleteSession();
							}}
							title={t("thread.deleteTask")}
						>
							<Trash2 className="h-3.5 w-3.5" />
							<span>{t("thread.deleteTask")}</span>
						</button>
						<button
							type="button"
							className={`inline-flex h-7 w-7 items-center justify-center rounded border ${
								showDebugEvents
									? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100"
									: "border-slate-600/80 bg-slate-900/30 text-slate-300 hover:border-slate-400"
							}`}
							onClick={() => setShowDebugEvents((value) => !value)}
							aria-label={debugModeTooltipLabel}
							aria-pressed={showDebugEvents}
							title={debugModeTooltipLabel}
						>
							<Bug className="h-3.5 w-3.5" />
						</button>
						{props.activeSession.missionPilot &&
						props.onTogglePilotThoughtDock ? (
							<button
								type="button"
								className={`inline-flex h-7 w-7 items-center justify-center rounded border ${
									props.isPilotThoughtDockOpen
										? "border-slate-400 bg-slate-800/80 text-slate-100"
										: "border-slate-600/80 bg-slate-900/30 text-slate-300 hover:border-slate-400"
								}`}
								onClick={props.onTogglePilotThoughtDock}
								aria-label={pilotThoughtTooltipLabel}
								aria-pressed={props.isPilotThoughtDockOpen}
								title={pilotThoughtTooltipLabel}
							>
								<MessageCircleMore className="h-4 w-4" />
							</button>
						) : null}
						<button
							type="button"
							className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-wait disabled:opacity-60 ${
								props.isProjectFilesOpen
									? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100"
									: "border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400"
							}`}
							aria-pressed={props.isProjectFilesOpen}
							aria-disabled={artifactButtonsCoolingDown}
							disabled={artifactButtonsCoolingDown}
							onClick={() => runArtifactButtonAction(props.onOpenProjectFiles)}
							title={t("thread.projectFiles")}
						>
							<FolderTree className="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-wait disabled:opacity-60 ${
								props.isBlueprintArtifactOpen
									? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100 hover:bg-cyan-900/30"
									: "border-slate-600/80 bg-slate-900/30 text-slate-300 hover:border-slate-400"
							}`}
							onClick={() =>
								runArtifactButtonAction(() => {
									void props.onOpenBlueprintArtifact();
								})
							}
							disabled={
								artifactButtonsCoolingDown ||
								props.isBlueprintActionBusy ||
								!props.activeSession ||
								!blueprintArtifact
							}
							aria-disabled={artifactButtonsCoolingDown}
							title={planModeTooltipLabel}
							aria-label={
								blueprintArtifact
									? planModeWorkspaceLabel
									: noPlanModeWorkspaceLabel
							}
							aria-pressed={props.isBlueprintArtifactOpen}
						>
							{props.isBlueprintActionBusy ? (
								<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
							) : (
								<NotebookPen className="h-3.5 w-3.5" />
							)}
						</button>
						<button
							type="button"
							className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-not-allowed disabled:opacity-40 ${
								props.isTestModeArtifactOpen
									? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100"
									: "border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400"
							}`}
							aria-pressed={props.isTestModeArtifactOpen}
							aria-disabled={artifactButtonsCoolingDown}
							disabled={artifactButtonsCoolingDown || !props.activeSession}
							onClick={openTestModeArtifactWithCooldown}
							title={testModeTooltipLabel}
							aria-label={testModeArtifactLabel}
						>
							<FlaskConical className="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-not-allowed disabled:opacity-40 ${
								props.isReviewArtifactOpen
									? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100"
									: "border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400"
							}`}
							aria-pressed={props.isReviewArtifactOpen}
							aria-disabled={artifactButtonsCoolingDown}
							disabled={
								artifactButtonsCoolingDown ||
								!props.activeSession ||
								(!props.latestRun && !props.hasReviewArtifact) ||
								props.isReviewActionBusy
							}
							onClick={() =>
								runArtifactButtonAction(() => {
									void props.onOpenReviewArtifact();
								})
							}
							title={reviewModeTooltipLabel}
							aria-label={reviewArtifactLabel}
						>
							{props.isReviewActionBusy ? (
								<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
							) : (
								<ClipboardCheck className="h-3.5 w-3.5" />
							)}
						</button>
						<button
							type="button"
							className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-not-allowed disabled:opacity-40 ${
								props.isTodoArtifactOpen
									? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100"
									: "border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400"
							}`}
							aria-pressed={props.isTodoArtifactOpen}
							aria-disabled={artifactButtonsCoolingDown}
							disabled={artifactButtonsCoolingDown || !props.hasTodoArtifact}
							onClick={() => runArtifactButtonAction(props.onOpenTodoArtifact)}
							title={todoListTooltipLabel}
							aria-label={
								props.hasTodoArtifact
									? t("thread.todoArtifact")
									: t("thread.noTodoArtifact")
							}
						>
							<ListTodo className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>
			</div>
		) : (
			<div className="flex items-center justify-between gap-4">
				<p className="text-sm text-slate-300/70">{t("thread.emptyPrompt")}</p>
				<button
					type="button"
					className={`inline-flex h-7 w-7 items-center justify-center rounded border disabled:cursor-wait disabled:opacity-60 ${
						props.isProjectFilesOpen
							? "border-cyan-400/70 bg-cyan-950/30 text-cyan-100"
							: "border-slate-600/80 bg-slate-900/30 text-slate-200 hover:border-slate-400"
					}`}
					aria-pressed={props.isProjectFilesOpen}
					aria-disabled={artifactButtonsCoolingDown}
					disabled={artifactButtonsCoolingDown}
					onClick={() => runArtifactButtonAction(props.onOpenProjectFiles)}
					title={t("thread.projectFiles")}
				>
					<FolderTree className="h-3.5 w-3.5" />
				</button>
			</div>
		)}
	</div>;
}
