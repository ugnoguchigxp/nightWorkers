import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type {
	DesignQuestionnaireAnswer,
	MissionPilotQuestionnaireDraft,
} from "../contracts";
import {
	fetchMissionPilotQuestionnaireDraft,
	updateMissionPilotQuestionnaireDraft,
} from "./missionPilotCommands";
import { projectMissionPilotQuestionnaireAnswers } from "./missionPilotQuestionnaireProjection";

type AnswerMap = Record<string, DesignQuestionnaireAnswer>;

export function useMissionPilotQuestionnaireDraft(input: {
	taskId: string | null;
	questionnaireSessionId: string | null;
	setQuestionnaireSessionId: Dispatch<SetStateAction<string | null>>;
	setAnswers: Dispatch<SetStateAction<AnswerMap>>;
	setError: Dispatch<SetStateAction<string | null>>;
	onSubmitted: () => void;
}) {
	const {
		taskId,
		questionnaireSessionId,
		setQuestionnaireSessionId,
		setAnswers,
		setError,
		onSubmitted,
	} = input;
	const [draft, setDraft] = useState<MissionPilotQuestionnaireDraft | null>(
		null,
	);
	const [countdownNow, setCountdownNow] = useState(() => Date.now());
	const draftRef = useRef<MissionPilotQuestionnaireDraft | null>(null);
	const updateQueueRef = useRef<Promise<void>>(Promise.resolve());

	useEffect(() => {
		updateQueueRef.current = Promise.resolve();
		if (!taskId || !questionnaireSessionId) {
			draftRef.current = null;
			setDraft(null);
			return;
		}
		const controller = new AbortController();
		void fetchMissionPilotQuestionnaireDraft(taskId, controller.signal)
			.then(async (response) => {
				if (!response.ok)
					throw new Error(
						(await response.text()) ||
							"Questionnaire draftの取得に失敗しました。",
					);
				return (await response.json()) as MissionPilotQuestionnaireDraft | null;
			})
			.then((nextDraft) => {
				if (controller.signal.aborted) return;
				if (
					nextDraft &&
					nextDraft.questionnaireSessionId !== questionnaireSessionId
				) {
					setQuestionnaireSessionId(nextDraft.questionnaireSessionId);
					return;
				}
				draftRef.current = nextDraft;
				setDraft(nextDraft);
				if (nextDraft)
					setAnswers(
						Object.fromEntries(
							nextDraft.answers.map((answer) => [answer.questionId, answer]),
						),
					);
			})
			.catch((error) => {
				if (error?.name !== "AbortError")
					setError(
						error instanceof Error
							? error.message
							: "Questionnaire draftの取得に失敗しました。",
					);
			});
		return () => controller.abort();
	}, [
		questionnaireSessionId,
		setAnswers,
		setError,
		setQuestionnaireSessionId,
		taskId,
	]);

	useEffect(() => {
		if (draft?.state !== "waiting_user") return;
		const timer = window.setInterval(() => setCountdownNow(Date.now()), 250);
		return () => window.clearInterval(timer);
	}, [draft?.state]);

	const secondsRemaining = draft
		? Math.max(
				0,
				Math.ceil((new Date(draft.deadlineAt).getTime() - countdownNow) / 1000),
			)
		: null;
	const draftState = draft?.state;
	useEffect(() => {
		if (
			!taskId ||
			(draftState !== "waiting_user" && draftState !== "submitting") ||
			secondsRemaining !== 0
		)
			return;
		const controller = new AbortController();
		const poll = () => {
			void fetchMissionPilotQuestionnaireDraft(taskId, controller.signal)
				.then(async (response) => {
					if (!response.ok)
						throw new Error(
							(await response.text()) ||
								"Questionnaire draftの更新確認に失敗しました。",
						);
					return (await response.json()) as MissionPilotQuestionnaireDraft | null;
				})
				.then((nextDraft) => {
					if (controller.signal.aborted) return;
					draftRef.current = nextDraft;
					setDraft(nextDraft);
					if (nextDraft?.state === "submitted") onSubmitted();
				})
				.catch((error) => {
					if (error?.name !== "AbortError")
						setError(
							error instanceof Error
								? error.message
								: "Questionnaire draftの更新確認に失敗しました。",
						);
				});
		};
		const timer = window.setInterval(poll, 1_000);
		poll();
		return () => {
			controller.abort();
			window.clearInterval(timer);
		};
	}, [draftState, onSubmitted, secondsRemaining, setError, taskId]);

	const updateAnswers = useCallback(
		(nextAnswers: AnswerMap) => {
			setAnswers(nextAnswers);
			if (!taskId || draftRef.current?.state !== "waiting_user") return;
			const snapshot = Object.values(nextAnswers);
			const update = updateQueueRef.current
				.catch(() => undefined)
				.then(async () => {
					const current = draftRef.current;
					if (current?.state !== "waiting_user") return;
					const response = await updateMissionPilotQuestionnaireDraft(
						taskId,
						current.version,
						snapshot,
					);
					if (!response.ok)
						throw new Error(
							(await response.text()) ||
								"Questionnaire回答案の保存に失敗しました。",
						);
					const updated =
						(await response.json()) as MissionPilotQuestionnaireDraft;
					draftRef.current = updated;
					setDraft(updated);
				});
			updateQueueRef.current = update;
			void update.catch((error) =>
				setError(
					error instanceof Error
						? error.message
						: "Questionnaire回答案の保存に失敗しました。",
				),
			);
		},
		[setAnswers, setError, taskId],
	);
	const projectAnswers = useCallback(
		(session: {
			id: string;
			answers: Array<{ answer: DesignQuestionnaireAnswer }>;
		}) => projectMissionPilotQuestionnaireAnswers(session, draftRef.current),
		[],
	);

	return {
		draft,
		setDraft,
		draftRef,
		updateQueueRef,
		secondsRemaining,
		updateAnswers,
		projectAnswers,
	};
}
