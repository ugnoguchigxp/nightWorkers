import type { Dispatch, SetStateAction } from "react";
import type {
	DesignQuestionnaireAnswer,
	DesignQuestionnaireSession,
	TaskMessage,
} from "../nightworkers/types";
import {
	generateAdditionalDesignQuestionnaireQuestions,
	startDesignQuestionnaire,
	submitDesignQuestionnaireAnswers,
} from "../questionnaire";
import type { PlanWorkspaceTab } from "../specification";
import { buildSubmittableQuestionnaireAnswers } from "./PlanModeQuestionnaire";
import { isCompletedQuestionnaireSession } from "./PlanModeWorkspaceViewer.helpers";

export function usePlanModeQuestionnaireActions(input: {
	sessionId: string | null;
	isImplementationLocked: boolean;
	questionnaireEnabled: boolean;
	activeBlueprintMessage: Pick<TaskMessage, "id"> | null;
	activeQuestionnaireSession: DesignQuestionnaireSession | null;
	unansweredQuestions: unknown[];
	questionGroups: Parameters<typeof buildSubmittableQuestionnaireAnswers>[0];
	answers: Record<string, DesignQuestionnaireAnswer>;
	runAction: (
		action: string,
		fn: () => Promise<{ focusTab?: PlanWorkspaceTab | null } | undefined>,
	) => Promise<void>;
	selectActiveTab: (tab: PlanWorkspaceTab) => void;
	setActiveSessionId: Dispatch<SetStateAction<string | null>>;
	setAnswers: Dispatch<
		SetStateAction<Record<string, DesignQuestionnaireAnswer>>
	>;
	setSessions: Dispatch<SetStateAction<DesignQuestionnaireSession[]>>;
	setAssemblyReadySessionIds: Dispatch<SetStateAction<Set<string>>>;
	setActionNotice: Dispatch<SetStateAction<string | null>>;
}) {
	const {
		sessionId,
		isImplementationLocked,
		questionnaireEnabled,
		activeBlueprintMessage,
		activeQuestionnaireSession,
		unansweredQuestions,
		questionGroups,
		answers,
		runAction,
		selectActiveTab,
		setActiveSessionId,
		setAnswers,
		setSessions,
		setAssemblyReadySessionIds,
		setActionNotice,
	} = input;
	async function startQuestionnaire() {
		if (!sessionId) return;
		if (isImplementationLocked) return;
		if (!questionnaireEnabled) return;
		await runAction("start", async () => {
			const res = await startDesignQuestionnaire(sessionId, {
				sourceBlueprintMessageId: activeBlueprintMessage?.id ?? null,
			});
			if (!res.ok) throw new Error(await res.text());
			const created = (await res.json()) as DesignQuestionnaireSession;
			setActiveSessionId(created.id);
			selectActiveTab("questionnaire");
		});
	}

	async function submitAnswersForNextStep() {
		if (!sessionId || !activeQuestionnaireSession) return;
		if (isCompletedQuestionnaireSession(activeQuestionnaireSession)) {
			selectActiveTab("status");
			return;
		}
		if (unansweredQuestions.length > 0) return;
		if (isImplementationLocked) return;
		await runAction("submit-answers", async () => {
			const answersRes = await submitDesignQuestionnaireAnswers(
				sessionId,
				activeQuestionnaireSession.id,
				{
					answers: buildSubmittableQuestionnaireAnswers(
						questionGroups,
						answers,
					),
				},
			);
			if (!answersRes.ok) throw new Error(await answersRes.text());
			const updatedSession =
				(await answersRes.json()) as DesignQuestionnaireSession;
			setSessions((prev) => {
				const exists = prev.some((session) => session.id === updatedSession.id);
				if (!exists) return [updatedSession, ...prev];
				return prev.map((session) =>
					session.id === updatedSession.id ? updatedSession : session,
				);
			});
			setActiveSessionId(updatedSession.id);
			setAnswers(
				Object.fromEntries(
					updatedSession.answers.map((item) => [item.questionId, item.answer]),
				),
			);
			if (isCompletedQuestionnaireSession(updatedSession)) {
				setAssemblyReadySessionIds(
					(prev) => new Set([...prev, updatedSession.id]),
				);
				selectActiveTab("status");
			}
		});
	}

	async function requestAdditionalQuestionnaireQuestions() {
		if (!sessionId) return;
		if (isImplementationLocked) return;
		if (!questionnaireEnabled) return;
		await runAction("questionnaire-additional", async () => {
			const res = await generateAdditionalDesignQuestionnaireQuestions(
				sessionId,
				{
					source: "user_requested",
					reason: "Plan Mode Status からの追加確認",
					maxQuestions: 5,
				},
			);
			if (!res.ok) throw new Error(await res.text());
			const payload = (await res.json()) as {
				session: DesignQuestionnaireSession | null;
				result: {
					addedCount: number;
					skippedDuplicateCount: number;
				};
			};
			if (payload.session) {
				setActiveSessionId(payload.session.id);
				setAnswers(
					Object.fromEntries(
						payload.session.answers.map((item) => [
							item.questionId,
							item.answer,
						]),
					),
				);
			}
			if (payload.result.addedCount > 0) {
				setActionNotice(
					`追加質問を ${payload.result.addedCount} 件作成しました。`,
				);
				selectActiveTab("questionnaire");
			} else {
				setActionNotice("追加質問はありません。");
			}
		});
	}

	return {
		startQuestionnaire,
		submitAnswersForNextStep,
		requestAdditionalQuestionnaireQuestions,
	};
}
