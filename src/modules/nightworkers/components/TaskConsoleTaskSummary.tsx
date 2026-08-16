import { GitPullRequest, MessageSquare, Play, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import type { Repository, Task } from "../types";
import {
	getTaskConsoleStatusColor,
	getTaskConsoleStatusLabel,
} from "./task-console-model";

export function TaskConsoleHeader({
	task,
	repository,
	canStart,
	isStarting,
	onStart,
}: {
	task: Task;
	repository: Repository | null | undefined;
	canStart: boolean;
	isStarting: boolean;
	onStart: () => void;
}) {
	const { t } = useTranslation();
	const canRerun = ![
		"running",
		"context_compiling",
		"compiling_context",
		"finalizing",
	].includes(task.status);
	return (
		<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6 mb-8">
			<div>
				<div className="flex items-center gap-3 mb-1">
					<span
						className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${getTaskConsoleStatusColor(task.status)}`}
					>
						{t(`taskConsole.status.${getTaskConsoleStatusLabel(task.status)}`)}
					</span>
					<span className="text-xs text-muted-foreground font-mono">
						{t("taskConsole.id")}: {task.id.slice(0, 8)}
					</span>
				</div>
				<h1 className="text-3xl font-extrabold tracking-tight text-foreground">
					{task.title}
				</h1>
				{repository && (
					<p className="text-sm text-muted-foreground mt-1">
						{t("taskConsole.repository")}:{" "}
						<span className="font-mono">
							{repository.name} ({repository.localPath})
						</span>
					</p>
				)}
			</div>
			{canRerun ? (
				<Button
					onClick={onStart}
					disabled={isStarting || !canStart}
					className="gap-1.5"
				>
					<Play className="h-4 w-4 fill-current" />
					{t("taskConsole.rerun")}
				</Button>
			) : null}
		</div>
	);
}

export function TaskConsoleSidebar({ task }: { task: Task }) {
	const { t } = useTranslation();
	return (
		<div className="space-y-6 lg:col-span-1">
			<div className="bg-card border border-border rounded-xl p-5 shadow-sm">
				<h2 className="text-lg font-bold mb-3 text-foreground flex items-center gap-2">
					<GitPullRequest className="h-5 w-5 text-primary" />
					{t("taskConsole.goalInstructions")}
				</h2>
				<div className="text-sm text-muted-foreground bg-background/50 rounded-lg p-3 border border-border/60 min-h-[100px] whitespace-pre-wrap">
					{task.description || t("taskConsole.noDescription")}
				</div>
			</div>

			<div className="bg-card border border-border rounded-xl p-5 shadow-sm">
				<h2 className="text-lg font-bold mb-3 text-foreground flex items-center gap-2">
					<MessageSquare className="h-5 w-5 text-cyan-400" />
					{t("taskConsole.runtimePrompt")}
				</h2>
				<p className="text-xs text-muted-foreground mb-2">
					{t("taskConsole.runtimePromptHelp")}
				</p>
				<div className="text-xs text-muted-foreground bg-background/50 rounded-lg p-3 border border-border/60 font-mono min-h-[100px] max-h-[250px] overflow-y-auto whitespace-pre-wrap">
					{task.compiledPrompt || t("taskConsole.noPrompt")}
				</div>
			</div>

			<div className="bg-card border border-border rounded-xl p-5 shadow-sm">
				<h2 className="text-lg font-bold mb-3 text-foreground flex items-center gap-2">
					<ShieldAlert className="h-5 w-5 text-amber-400" />
					{t("taskConsole.boundaries")}
				</h2>
				<div className="space-y-2 text-sm text-muted-foreground">
					<div className="flex justify-between border-b border-border/50 pb-1">
						<span>{t("taskConsole.timeout")}</span>
						<span className="font-mono">{task.timeoutSeconds}s</span>
					</div>
					<div className="flex justify-between border-b border-border/50 pb-1">
						<span>{t("taskConsole.safeMode")}</span>
						<span className="text-emerald-400">
							{t("taskConsole.commandBlocklists")}
						</span>
					</div>
					<div className="flex justify-between">
						<span>{t("taskConsole.memoryLoop")}</span>
						<span className="text-cyan-400">
							{t("taskConsole.postEvaluation")}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}
