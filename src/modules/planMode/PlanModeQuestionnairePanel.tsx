import { LoaderCircle } from "lucide-react";
import type { MissionPilotQuestionnaireDraft } from "../../../shared/modules/missionPilot";
import type {
	DesignQuestionnaireAnswer,
	DesignQuestionnaireSession,
	TaskMessage,
} from "../nightworkers/types";
import {
	ActionButton,
	getQuestionCount,
	QuestionnaireForm,
} from "./PlanModeQuestionnaire";

type QuestionnaireFormQuestionGroups = Parameters<
	typeof QuestionnaireForm
>[0]["questionGroups"];
type QuestionnaireSubmissionState = {
	label: string;
	icon?: string;
	disabled: boolean;
	readOnly: boolean;
	state: string;
};

export function PlanModeQuestionnairePanel({
	showQuestionnaireStartAction,
	isQuestionnaireGenerating,
	onStartQuestionnaire,
	busyAction,
	isImplementationLocked,
	questionnaireEnabled,
	activeBlueprintMessage,
	planModeDisabledReason,
	onRequestAdditionalQuestionnaireQuestions,
	sessions,
	activeQuestionnaireSession,
	onSelectSession,
	questionGroups,
	answers,
	onAnswersChange,
	questionnaireSubmissionState,
	missionPilotDraft,
	missionPilotSecondsRemaining,
	onSubmitAnswers,
	answerProgress,
	unansweredQuestions,
}: {
	showQuestionnaireStartAction: boolean;
	isQuestionnaireGenerating: boolean;
	onStartQuestionnaire: () => void | Promise<void>;
	busyAction: string | null;
	isImplementationLocked: boolean;
	questionnaireEnabled: boolean;
	activeBlueprintMessage: TaskMessage | null;
	planModeDisabledReason: string;
	onRequestAdditionalQuestionnaireQuestions: () => void | Promise<void>;
	sessions: DesignQuestionnaireSession[];
	activeQuestionnaireSession: DesignQuestionnaireSession | null;
	onSelectSession: (session: DesignQuestionnaireSession) => void;
	questionGroups: QuestionnaireFormQuestionGroups;
	answers: Record<string, DesignQuestionnaireAnswer>;
	onAnswersChange: (answers: Record<string, DesignQuestionnaireAnswer>) => void;
	questionnaireSubmissionState: QuestionnaireSubmissionState;
	missionPilotDraft: MissionPilotQuestionnaireDraft | null;
	missionPilotSecondsRemaining: number | null;
	onSubmitAnswers: () => void | Promise<void>;
	answerProgress: { answeredCount: number; totalCount: number };
	unansweredQuestions: Array<{ question?: unknown }>;
}) {
	return (
		<div className="grid gap-4">
			{isQuestionnaireGenerating ? (
				<div
					className="flex items-center gap-2 rounded border border-cyan-700/60 bg-cyan-950/30 px-3 py-2 text-cyan-100 text-sm"
					role="status"
				>
					<LoaderCircle className="h-4 w-4 animate-spin" />
					Design Questionnaireを生成しています
				</div>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				{showQuestionnaireStartAction ? (
					<button
						type="button"
						className="inline-flex items-center gap-1.5 rounded border border-cyan-500/60 bg-cyan-950/30 px-2 py-1 text-xs text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
						onClick={onStartQuestionnaire}
						disabled={
							Boolean(busyAction) ||
							isQuestionnaireGenerating ||
							isImplementationLocked ||
							!questionnaireEnabled
						}
					>
						{busyAction === "start" ? (
							<LoaderCircle className="h-3 w-3 animate-spin" />
						) : null}
						{activeBlueprintMessage ? "この画面案から質問を作成" : "質問を作成"}
					</button>
				) : null}
				{!questionnaireEnabled ? (
					<span className="text-[11px] text-amber-300">
						{planModeDisabledReason}
					</span>
				) : null}
				{questionnaireEnabled ? (
					<button
						type="button"
						className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-950/20 px-2 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
						onClick={onRequestAdditionalQuestionnaireQuestions}
						disabled={
							Boolean(busyAction) ||
							isQuestionnaireGenerating ||
							isImplementationLocked ||
							!questionnaireEnabled
						}
					>
						{busyAction === "questionnaire-additional" ? (
							<LoaderCircle className="h-3 w-3 animate-spin" />
						) : null}
						追加確認
					</button>
				) : null}
				{sessions.map((session) => (
					<button
						key={session.id}
						type="button"
						className={`rounded border px-2 py-1 text-xs ${
							activeQuestionnaireSession?.id === session.id
								? "border-cyan-400/70 bg-cyan-950/40 text-cyan-100"
								: "border-slate-700 text-slate-300"
						}`}
						onClick={() => onSelectSession(session)}
					>
						{session.status} {session.answers.length}/
						{getQuestionCount(session)}
					</button>
				))}
			</div>
			{activeQuestionnaireSession ? (
				<>
					<QuestionnaireForm
						questionGroups={questionGroups}
						answers={answers}
						onChange={onAnswersChange}
						readOnly={questionnaireSubmissionState.readOnly}
						answerEvidence={missionPilotDraft?.answerEvidence}
					/>
					{missionPilotDraft?.state === "waiting_user" ? (
						<div
							className="flex items-center gap-2 rounded bg-slate-800/55 px-3 py-2 text-xs text-slate-300"
							data-mission-pilot-questionnaire-countdown
						>
							<span>Mission Pilotの回答案を表示中</span>
							<span className="font-mono font-semibold text-slate-100">
								{missionPilotSecondsRemaining}秒
							</span>
							<span className="text-slate-500">
								未操作ならこの内容で自動確定します
							</span>
						</div>
					) : null}
					{missionPilotDraft?.state === "failed" ? (
						<div className="rounded bg-red-950/35 px-3 py-2 text-xs text-red-200">
							自動確定に失敗しました。回答案は保持されています。Mission
							Pilotを再開して再試行してください。
						</div>
					) : null}
					{missionPilotDraft?.state === "submitted" ? (
						<div
							className="rounded bg-emerald-950/35 px-3 py-2 text-xs text-emerald-200"
							data-mission-pilot-questionnaire-submitted
						>
							Mission Pilotが{missionPilotDraft.answers.length}
							件の回答を確定しました。選択内容と根拠はこの画面に証跡として保持されています。
						</div>
					) : null}
					<div className="flex flex-wrap items-center gap-2">
						<ActionButton
							label={questionnaireSubmissionState.label}
							icon={
								questionnaireSubmissionState.icon === "send"
									? "send"
									: undefined
							}
							busy={busyAction === "submit-answers"}
							disabled={questionnaireSubmissionState.disabled}
							onClick={onSubmitAnswers}
						/>
						<span
							className="text-[11px] text-slate-500"
							aria-live="polite"
							data-questionnaire-state={questionnaireSubmissionState.state}
						>
							{answerProgress.answeredCount}/{answerProgress.totalCount}{" "}
							回答済み
						</span>
						{unansweredQuestions.length > 0 ? (
							<span className="text-[11px] text-amber-300" aria-live="polite">
								未回答:{" "}
								{unansweredQuestions
									.map((question) => String(question.question || ""))
									.join(" / ")}
							</span>
						) : null}
						{!questionnaireEnabled ? (
							<span className="text-[11px] text-amber-300">
								{planModeDisabledReason}
							</span>
						) : null}
					</div>
				</>
			) : (
				<p className="text-xs text-slate-500">No questionnaire session.</p>
			)}
		</div>
	);
}
