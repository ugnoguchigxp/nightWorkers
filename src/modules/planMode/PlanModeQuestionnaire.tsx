import { ChevronDown, ChevronUp, LoaderCircle, Send } from "lucide-react";
import type { MissionPilotAnswerEvidence } from "../../../shared/modules/missionPilot";
import type {
	DesignQuestion,
	DesignQuestionOption,
	DesignQuestionSet,
} from "../../../shared/schemas/design-questionnaire.schema";
import type { DesignQuestionnaireAnswer } from "../nightworkers/types";
import {
	emptyQuestionnaireAnswer,
	getUnansweredQuestions,
	isQuestionDependencySatisfied,
} from "../questionnaire";

export {
	buildSubmittableQuestionnaireAnswers,
	getAnswerProgress,
	getQuestionCount,
	getUnansweredQuestions,
	getVisibleQuestionnaireQuestions,
	isAnswered,
	isQuestionAnswered,
} from "../questionnaire";

export function QuestionnaireForm({
	questionGroups,
	answers,
	onChange,
	readOnly = false,
	answerEvidence,
}: {
	questionGroups: DesignQuestionSet[];
	answers: Record<string, DesignQuestionnaireAnswer>;
	onChange: (answers: Record<string, DesignQuestionnaireAnswer>) => void;
	readOnly?: boolean;
	answerEvidence?: Record<string, MissionPilotAnswerEvidence>;
}) {
	if (questionGroups.length === 0)
		return <p className="text-xs text-slate-500">No valid question set.</p>;
	const updateAnswer = (
		questionId: string,
		patch: Partial<DesignQuestionnaireAnswer>,
	) => {
		const current = answers[questionId] || emptyQuestionnaireAnswer(questionId);
		onChange({ ...answers, [questionId]: { ...current, ...patch } });
	};
	return (
		<div className="grid gap-4">
			{questionGroups.map((group) => {
				const questions = (
					Array.isArray(group.questions) ? group.questions : []
				).filter((question) =>
					isQuestionDependencySatisfied(question, answers),
				);
				const unanswered = getUnansweredQuestions([group], answers).length;
				return (
					<section key={String(group.id)} className="grid gap-2">
						<div className="flex items-center justify-between gap-3 border-slate-800 border-b pb-1">
							<div>
								<h2 className="text-sm font-semibold text-slate-100">
									{String(group.title)}
								</h2>
								<p className="text-[11px] text-slate-500">
									{String(group.purpose || group.category || "")}
								</p>
							</div>
							<span className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300">
								{unanswered} unanswered
							</span>
						</div>
						{questions.map((question) => (
							<QuestionCard
								key={String(question.id)}
								question={question}
								answer={
									answers[question.id] || emptyQuestionnaireAnswer(question.id)
								}
								onChange={(patch) => updateAnswer(question.id, patch)}
								readOnly={readOnly}
								evidence={answerEvidence?.[question.id]}
							/>
						))}
					</section>
				);
			})}
		</div>
	);
}

function QuestionCard({
	question,
	answer,
	onChange,
	readOnly = false,
	evidence,
}: {
	question: DesignQuestion;
	answer: DesignQuestionnaireAnswer;
	onChange: (patch: Partial<DesignQuestionnaireAnswer>) => void;
	readOnly?: boolean;
	evidence?: MissionPilotAnswerEvidence;
}) {
	const options = Array.isArray(question.options) ? question.options : [];
	const isMultiChoice = question.answerType === "multi_choice";
	const isChoice = question.answerType === "single_choice" || isMultiChoice;
	const rankedOptions = [
		...answer.rankedOptionIds
			.map((id) => options.find((option) => option.id === id))
			.filter((option): option is DesignQuestionOption => Boolean(option)),
		...options.filter((option) => !answer.rankedOptionIds.includes(option.id)),
	];
	return (
		<div className="rounded border border-slate-800 bg-slate-950/20 p-3 text-xs">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="mt-1 text-sm font-medium text-slate-100">
						{String(question.question)}
					</h3>
				</div>
				<label className="flex items-center gap-1 text-[11px] text-slate-400">
					<input
						type="checkbox"
						checked={answer.deferred}
						disabled={readOnly}
						onChange={(event) => onChange({ deferred: event.target.checked })}
					/>
					Later
				</label>
			</div>
			{evidence ? (
				<div
					className="nightworkers-questionnaire-evidence mt-2 flex items-start gap-2 rounded px-2.5 py-2 text-[11px]"
					data-answer-evidence={evidence.source}
				>
					<span className="nightworkers-questionnaire-evidence-label shrink-0 rounded px-1.5 py-0.5 font-semibold">
						{evidence.source === "user"
							? "ユーザー変更"
							: evidence.source === "user_confirmed"
								? "ユーザー確認"
								: "AI提案"}
					</span>
					<span>{evidence.reason}</span>
				</div>
			) : null}
			{isChoice && options.length > 0 ? (
				<div className="mt-3 grid gap-2">
					{options.map((option: DesignQuestionOption) => {
						const selected = answer.selectedOptionIds.includes(option.id);
						return (
							<label
								key={String(option.id)}
								className={`flex cursor-pointer items-center gap-2 rounded border p-2 text-left ${
									selected
										? "border-cyan-400/70 bg-cyan-950/30 text-cyan-50"
										: "border-slate-800 bg-slate-950/20 text-slate-300 hover:border-slate-600"
								}`}
							>
								<input
									type={isMultiChoice ? "checkbox" : "radio"}
									name={String(question.id)}
									checked={selected}
									disabled={readOnly}
									onChange={() => {
										if (isMultiChoice) {
											onChange({
												selectedOptionIds: selected
													? answer.selectedOptionIds.filter(
															(id) => id !== option.id,
														)
													: [...answer.selectedOptionIds, option.id],
											});
											return;
										}
										onChange({
											selectedOptionIds: selected ? [] : [option.id],
										});
									}}
								/>
								<span className="font-medium">{String(option.label)}</span>
							</label>
						);
					})}
				</div>
			) : null}
			{question.answerType === "boolean" ? (
				<div className="mt-3 flex gap-2">
					{[
						{ label: "はい", value: true },
						{ label: "いいえ", value: false },
					].map((option) => (
						<label
							key={option.label}
							className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 ${
								answer.booleanValue === option.value
									? "border-cyan-400/70 bg-cyan-950/30 text-cyan-50"
									: "border-slate-800 text-slate-300"
							}`}
						>
							<input
								type="radio"
								name={String(question.id)}
								checked={answer.booleanValue === option.value}
								disabled={readOnly}
								onChange={() => onChange({ booleanValue: option.value })}
							/>
							{option.label}
						</label>
					))}
				</div>
			) : null}
			{question.answerType === "free_text" ? (
				<textarea
					className="mt-3 min-h-24 w-full rounded border border-slate-700 bg-slate-950/40 p-2 text-slate-100 outline-none focus:border-cyan-500"
					value={answer.freeText ?? ""}
					disabled={readOnly}
					onChange={(event) => onChange({ freeText: event.target.value })}
				/>
			) : null}
			{question.answerType === "ranked" && rankedOptions.length > 0 ? (
				<div className="mt-3 grid gap-2">
					{rankedOptions.map((option, index) => (
						<div
							key={option.id}
							className="flex items-center gap-2 rounded border border-slate-800 px-2 py-1.5 text-slate-300"
						>
							<span className="w-5 text-center font-mono text-slate-500">
								{index + 1}
							</span>
							<span className="flex-1">{option.label}</span>
							<button
								type="button"
								disabled={readOnly || index === 0}
								onClick={() => {
									const next = rankedOptions.map((item) => item.id);
									[next[index - 1], next[index]] = [
										next[index],
										next[index - 1],
									];
									onChange({ rankedOptionIds: next });
								}}
								aria-label={`${option.label}を上へ`}
							>
								<ChevronUp className="h-4 w-4" />
							</button>
							<button
								type="button"
								disabled={readOnly || index === rankedOptions.length - 1}
								onClick={() => {
									const next = rankedOptions.map((item) => item.id);
									[next[index], next[index + 1]] = [
										next[index + 1],
										next[index],
									];
									onChange({ rankedOptionIds: next });
								}}
								aria-label={`${option.label}を下へ`}
							>
								<ChevronDown className="h-4 w-4" />
							</button>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

export function ActionButton({
	label,
	icon,
	busy,
	disabled,
	onClick,
}: {
	label: string;
	icon?: "send";
	busy?: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-950/20 px-2 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
			onClick={onClick}
			disabled={busy || disabled}
		>
			{busy ? (
				<LoaderCircle className="h-3 w-3 animate-spin" />
			) : icon === "send" ? (
				<Send className="h-3 w-3" />
			) : null}
			{label}
		</button>
	);
}

export function getQuestionnaireSubmissionState({
	unansweredCount,
	isCompleted,
	isImplementationLocked,
	isCapabilityEnabled,
}: {
	unansweredCount: number;
	isCompleted: boolean;
	isImplementationLocked: boolean;
	isCapabilityEnabled: boolean;
}) {
	if (isCompleted) {
		return {
			disabled: true,
			icon: undefined,
			label: "回答済み",
			readOnly: true,
			state: "completed",
		} as const;
	}
	return {
		disabled:
			unansweredCount > 0 || isImplementationLocked || !isCapabilityEnabled,
		icon: "send",
		label:
			unansweredCount > 0
				? `未回答 ${unansweredCount}件`
				: "回答を送信して次へ",
		readOnly: isImplementationLocked,
		state: unansweredCount > 0 ? "incomplete" : "ready",
	} as const;
}
