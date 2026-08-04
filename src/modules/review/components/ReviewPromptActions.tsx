import {
	ArrowRight,
	Clock3,
	GitCommitHorizontal,
	LoaderCircle,
	ScanSearch,
	ShieldCheck,
	Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import {
	REVIEW_MODE_PROMPT_ACTIONS,
	type ReviewModePromptAction,
} from "../reviewModeLauncher";

const actionIcons: Record<ReviewModePromptAction["id"], ReactNode> = {
	code_review: <ScanSearch className="h-4 w-4 text-cyan-200" />,
	security_scan: <ShieldCheck className="h-4 w-4 text-amber-200" />,
	commit: <GitCommitHorizontal className="h-4 w-4 text-violet-200" />,
	push: <Upload className="h-4 w-4 text-emerald-200" />,
};

export function ReviewPromptActions({
	onSubmit,
	disabled = false,
	busyActionId = null,
	pendingPhase = null,
	disabledStatusMessage = null,
}: {
	onSubmit?: (action: ReviewModePromptAction) => Promise<void>;
	disabled?: boolean;
	busyActionId?: ReviewModePromptAction["id"] | null;
	pendingPhase?: "submitting" | "waiting" | null;
	disabledStatusMessage?: string | null;
}) {
	return (
		<section
			className="grid gap-3 rounded border border-cyan-900/70 bg-cyan-950/15 p-4"
			data-review-section="prompt-actions"
		>
			<div>
				<h2 className="text-sm font-semibold text-slate-100">
					実装後のアクション
				</h2>
				<p className="mt-1 text-xs leading-5 text-slate-400">
					選択した定型プロンプトをReview Codexへそのまま送信します。
				</p>
			</div>
			{pendingPhase || disabledStatusMessage ? (
				<div
					role="status"
					className="flex items-center gap-2 rounded border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs font-medium text-amber-100"
				>
					{pendingPhase === "submitting" ? (
						<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
					) : (
						<Clock3 className="h-3.5 w-3.5" />
					)}
					{pendingPhase === "submitting"
						? "プロンプトを送信しています。"
						: pendingPhase === "waiting"
							? "Review Codexの結果が確定するまで操作できません。"
							: disabledStatusMessage}
				</div>
			) : null}
			<div className="grid gap-2 md:grid-cols-2">
				{REVIEW_MODE_PROMPT_ACTIONS.map((action) => {
					const busy = busyActionId === action.id;
					return (
						<button
							type="button"
							key={action.id}
							data-review-prompt-action={action.id}
							disabled={!onSubmit || disabled || busyActionId !== null}
							aria-busy={busy}
							onClick={() => void onSubmit?.(action)}
							className="group grid min-h-28 grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-slate-600 bg-slate-900/90 p-3 text-left shadow-md transition hover:-translate-y-0.5 hover:border-cyan-500 hover:bg-slate-900 hover:shadow-lg active:translate-y-px active:shadow-inner disabled:translate-y-0 disabled:cursor-not-allowed disabled:border-slate-800 disabled:opacity-45 disabled:shadow-none"
						>
							<span className="row-span-3 mt-0.5">
								{busy ? (
									<LoaderCircle className="h-4 w-4 animate-spin text-cyan-200" />
								) : (
									actionIcons[action.id]
								)}
							</span>
							<span className="text-sm font-semibold text-slate-100">
								{action.label}
							</span>
							<span className="text-xs leading-5 text-slate-400">
								{action.description}
							</span>
							<span className="mt-1 inline-flex items-center justify-end gap-1 text-[11px] font-semibold text-cyan-200 transition group-hover:text-cyan-100">
								{busy ? "結果待ち" : "実行する"}
								{busy ? null : <ArrowRight className="h-3.5 w-3.5" />}
							</span>
						</button>
					);
				})}
			</div>
		</section>
	);
}
