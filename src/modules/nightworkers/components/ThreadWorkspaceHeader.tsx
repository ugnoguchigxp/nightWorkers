import { Bug, MessageCircleMore, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorkbenchArtifactRef } from "../types";
import { getRelativeTimestamp } from "../utils/time";
import { ArtifactModeNavigation } from "./ArtifactModeNavigation";
import type { ThreadWorkspaceProps } from "./ThreadWorkspace";
import { formatUsageBadge, formatUsageTitle } from "./ThreadWorkspaceBanner";

type ThreadWorkspaceHeaderProps = {
	props: ThreadWorkspaceProps;
	blueprintArtifact?: WorkbenchArtifactRef;
	showDebugEvents: boolean;
	setShowDebugEvents: (
		value: boolean | ((previous: boolean) => boolean),
	) => void;
	artifactButtonsCoolingDown: boolean;
	runArtifactButtonAction: (action: () => void) => void;
	debugModeTooltipLabel: string;
	pilotThoughtTooltipLabel: string;
};

export function ThreadWorkspaceHeader({
	props,
	blueprintArtifact,
	showDebugEvents,
	setShowDebugEvents,
	artifactButtonsCoolingDown,
	runArtifactButtonAction,
	debugModeTooltipLabel,
	pilotThoughtTooltipLabel,
}: ThreadWorkspaceHeaderProps) {
	const { t } = useTranslation();
	return (
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
							<ArtifactModeNavigation
								current={
									props.isProjectFilesOpen
										? "project_files"
										: props.isBlueprintArtifactOpen
											? "plan"
											: props.isTodoArtifactOpen
												? "todo"
												: props.isTestModeArtifactOpen
													? "test"
													: props.isReviewArtifactOpen
														? "review"
														: null
								}
								disabled={artifactButtonsCoolingDown}
								busyKind={
									props.isBlueprintActionBusy
										? "plan"
										: props.isReviewActionBusy
											? "review"
											: null
								}
								available={{
									project_files: true,
									plan: Boolean(blueprintArtifact),
									todo: props.hasTodoArtifact,
									test: Boolean(props.activeSession),
									review: props.hasReviewArtifact,
								}}
								onOpen={{
									project_files: () =>
										runArtifactButtonAction(props.onOpenProjectFiles),
									plan: () =>
										runArtifactButtonAction(() => {
											void props.onOpenBlueprintArtifact();
										}),
									todo: () => runArtifactButtonAction(props.onOpenTodoArtifact),
									test: () =>
										runArtifactButtonAction(props.onOpenTestModeArtifact),
									review: () =>
										runArtifactButtonAction(() => {
											void props.onOpenReviewArtifact();
										}),
								}}
							/>
						</div>
					</div>
				</div>
			) : (
				<div className="flex items-center justify-between gap-4">
					<p className="text-sm text-slate-300/70">{t("thread.emptyPrompt")}</p>
					<ArtifactModeNavigation
						current={props.isProjectFilesOpen ? "project_files" : null}
						disabled={artifactButtonsCoolingDown}
						available={{
							project_files: true,
							plan: false,
							todo: false,
							test: false,
							review: false,
						}}
						onOpen={{
							project_files: () =>
								runArtifactButtonAction(props.onOpenProjectFiles),
							plan: () => undefined,
							todo: () => undefined,
							test: () => undefined,
							review: () => undefined,
						}}
					/>
				</div>
			)}
		</div>
	);
}
