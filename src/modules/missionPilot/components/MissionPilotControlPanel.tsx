import { Loader2, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MissionPilotControlSummary } from "../../../../shared/schemas/mission-pilot.schema";
import type { MissionPilotActionConfirmation } from "../../../../shared/schemas/mission-pilot-agent.schema";
import {
	fetchMissionPilotActionConfirmations,
	resolveMissionPilotActionConfirmation,
} from "../missionPilotCommands";
import { missionPilotPresentation } from "../missionPilotPresentation";
import { useMissionPilotControls } from "../useMissionPilotControls";

export function MissionPilotControlPanel({
	taskId,
	summary,
	initialPrompt,
	placement,
}: {
	taskId: string;
	summary: MissionPilotControlSummary;
	initialPrompt?: string;
	placement: "sidebar" | "composer";
}) {
	const { t } = useTranslation();
	const controls = useMissionPilotControls(taskId, summary, initialPrompt);
	const state = missionPilotPresentation(summary);
	const stopping =
		controls.pending === "stop" || summary.activityState === "stopping";
	const running =
		!stopping && (controls.pending === "play" || state.busy || state.canStop);
	const controlLabel = stopping
		? "missionPilot.stopping"
		: running
			? "missionPilot.pause"
			: "missionPilot.play";
	const className =
		placement === "sidebar"
			? "mission-pilot-task-control"
			: "mission-pilot-composer-controls mission-pilot-composer-panel";
	const runtimeStatusLabel =
		summary.runtimeKind === "agent"
			? t(`missionPilot.runtime.${summary.runtimeState}`)
			: null;
	const [confirmations, setConfirmations] = useState<
		MissionPilotActionConfirmation[]
	>([]);
	const [resolvingConfirmation, setResolvingConfirmation] = useState(false);
	const [confirmationError, setConfirmationError] = useState<string | null>(
		null,
	);

	useEffect(() => {
		if (
			placement !== "composer" ||
			summary.runtimeKind !== "agent" ||
			summary.runtimeState !== "attention"
		) {
			setConfirmations([]);
			return;
		}
		let active = true;
		setConfirmationError(null);
		void fetchMissionPilotActionConfirmations(taskId)
			.then(async (response) => {
				if (!response.ok)
					throw new Error(t("missionPilot.confirmation.loadFailed"));
				const rows =
					(await response.json()) as MissionPilotActionConfirmation[];
				if (active)
					setConfirmations(rows.filter((row) => row.status === "pending"));
			})
			.catch((error) => {
				if (active)
					setConfirmationError(
						error instanceof Error ? error.message : String(error),
					);
			});
		return () => {
			active = false;
		};
	}, [placement, summary.runtimeKind, summary.runtimeState, t, taskId]);

	const confirmation = confirmations[0] ?? null;
	const resolveConfirmation = async (decision: "approved" | "denied") => {
		if (!confirmation || resolvingConfirmation) return;
		setResolvingConfirmation(true);
		setConfirmationError(null);
		try {
			const response = await resolveMissionPilotActionConfirmation(
				confirmation,
				decision,
			);
			if (!response.ok)
				throw new Error(t("missionPilot.confirmation.resolveFailed"));
			setConfirmations((current) =>
				current.filter((row) => row.id !== confirmation.id),
			);
		} catch (error) {
			setConfirmationError(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setResolvingConfirmation(false);
		}
	};

	return (
		<div className={className} aria-live="polite">
			{placement === "composer" && confirmation ? (
				<div className="absolute bottom-full right-0 z-50 mb-2 w-80 rounded-md border border-amber-500/40 bg-background p-3 text-sm shadow-lg">
					<div className="font-medium">
						{t("missionPilot.confirmation.title")}: {confirmation.actionId}
					</div>
					<pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs">
						{JSON.stringify(confirmation.arguments, null, 2)}
					</pre>
					<div className="mt-2 flex gap-2">
						<button
							type="button"
							className="rounded bg-primary px-3 py-1 text-primary-foreground"
							disabled={resolvingConfirmation}
							onClick={() => void resolveConfirmation("approved")}
						>
							{t("missionPilot.confirmation.approve")}
						</button>
						<button
							type="button"
							className="rounded border px-3 py-1"
							disabled={resolvingConfirmation}
							onClick={() => void resolveConfirmation("denied")}
						>
							{t("missionPilot.confirmation.deny")}
						</button>
					</div>
				</div>
			) : null}
			<button
				type="button"
				className="mission-pilot-control-button"
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void (running ? controls.stop() : controls.play());
				}}
				disabled={stopping}
				aria-busy={Boolean(controls.pending) || state.busy}
				aria-label={t(controlLabel)}
				title={controls.error || runtimeStatusLabel || t(controlLabel)}
			>
				{running ? (
					<span className="mission-pilot-starting-control">
						<Loader2 className="mission-pilot-starting-spinner h-5 w-5 animate-spin" />
						<span className="mission-pilot-starting-pause">
							<Pause className="h-4 w-4" />
						</span>
					</span>
				) : stopping ? (
					<Loader2 className="h-5 w-5 animate-spin" />
				) : (
					<Play className="h-6 w-6" />
				)}
			</button>
			{placement === "composer" && runtimeStatusLabel ? (
				<span className="text-xs text-muted-foreground">
					{runtimeStatusLabel}
				</span>
			) : null}
			{placement === "composer" ? (
				<MissionPilotCountdown
					nextWakeAt={
						summary.desiredState === "playing" ? summary.nextWakeAt : null
					}
					disabled={stopping}
					onPause={() => controls.stop()}
				/>
			) : null}
			{controls.error ? (
				<span className="sr-only" role="status">
					{controls.error}
				</span>
			) : null}
			{confirmationError ? (
				<span className="text-xs text-destructive" role="alert">
					{confirmationError}
				</span>
			) : null}
		</div>
	);
}

function MissionPilotCountdown({
	nextWakeAt,
	disabled,
	onPause,
}: {
	nextWakeAt: string | Date | null;
	disabled: boolean;
	onPause: () => Promise<void>;
}) {
	const { t } = useTranslation();
	const [now, setNow] = useState(() => Date.now());
	const deadline = nextWakeAt ? new Date(nextWakeAt).getTime() : Number.NaN;
	const remainingMs = Number.isFinite(deadline)
		? Math.max(0, deadline - now)
		: 0;

	useEffect(() => {
		if (!Number.isFinite(deadline) || deadline <= Date.now()) return;
		setNow(Date.now());
		const timer = window.setInterval(() => {
			const nextNow = Date.now();
			setNow(nextNow);
			if (nextNow >= deadline) window.clearInterval(timer);
		}, 1000);
		return () => window.clearInterval(timer);
	}, [deadline]);

	if (remainingMs <= 0) return null;
	const label = formatCountdown(remainingMs);
	return (
		<button
			type="button"
			className="mission-pilot-countdown"
			disabled={disabled}
			onClick={() => void onPause()}
			aria-label={t("missionPilot.pauseCountdown", { time: label })}
			title={t("missionPilot.pauseCountdown", { time: label })}
		>
			{label}
		</button>
	);
}

export function formatCountdown(remainingMs: number) {
	const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const minuteSecond = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	return hours > 0 ? `${hours}:${minuteSecond}` : minuteSecond;
}
