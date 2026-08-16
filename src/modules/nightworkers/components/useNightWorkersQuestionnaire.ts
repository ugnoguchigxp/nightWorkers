import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
} from "react";
import { toDeepRecord } from "../../../../shared/json-record";
import { readJsonResponse } from "../../../lib/api-error";
import { fetchDesignQuestionnaireSession } from "../../questionnaire";
import { fetchPlanModeWorkspace } from "../../specification";
import type { NightWorkersWorkspaceState } from "../hooks/useNightWorkersWorkspace";
import {
	isActiveSessionWorkbenchRoute,
	shouldAutoOpenPlanArtifact,
} from "../planArtifactVisibility";
import type { WorkbenchRouteState } from "../routing/workbench-route-state";
import type { TaskMessage } from "../types";
import { buildPlanModeWorkspaceArtifactRef } from "../workbenchSelectors";
import type { ArtifactPaneFocus } from "./nightworkers-shell-route-effects";
import {
	isDesignQuestionnaireReadyMessage,
	isDesignQuestionnaireStartingMessage,
	resolveQuestionnaireReadyInitialTab,
} from "./nightworkers-shell-utils";

export function useNightWorkersQuestionnaire(input: {
	routeState: WorkbenchRouteState;
	workspace: NightWorkersWorkspaceState;
	onNavigate: (routeState: WorkbenchRouteState) => void;
	setArtifactFocus: Dispatch<SetStateAction<ArtifactPaneFocus>>;
	setClearedArtifactContextId: Dispatch<SetStateAction<string | null>>;
}) {
	const {
		routeState,
		workspace,
		onNavigate,
		setArtifactFocus,
		setClearedArtifactContextId,
	} = input;

	const openedQuestionnaireMessageIdsRef = useRef<Set<string>>(new Set());
	const openingQuestionnaireMessageIdsRef = useRef<Set<string>>(new Set());

	const waitForQuestionnaireWorkspaceReady = useCallback(
		async (message: TaskMessage) => {
			const sessionId = String(
				toDeepRecord(message.metadataJson).questionnaireSessionId || "",
			);
			if (!sessionId) return false;
			for (let attempt = 0; attempt < 6; attempt += 1) {
				const [workspaceRes, sessionRes] = await Promise.all([
					fetchPlanModeWorkspace(message.taskId),
					fetchDesignQuestionnaireSession(message.taskId, sessionId),
				]);
				try {
					await readJsonResponse(workspaceRes);
					const questionnaireSession = await readJsonResponse<{
						questionSets?: unknown[];
					}>(sessionRes);
					if (questionnaireSession.questionSets?.length) return true;
				} catch {
					// Readiness remains false until both snapshots satisfy their contract.
				}
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			return false;
		},
		[],
	);

	const openQuestionnaireWorkspace = useCallback(
		async (
			message: TaskMessage,
			initialTab: "questionnaire" | "status" = "questionnaire",
			shouldOpen: () => boolean = () => true,
		) => {
			if (openingQuestionnaireMessageIdsRef.current.has(message.id)) return;
			openingQuestionnaireMessageIdsRef.current.add(message.id);
			try {
				const ready = await waitForQuestionnaireWorkspaceReady(message);
				if (!ready || !shouldOpen()) return;
				openedQuestionnaireMessageIdsRef.current.add(message.id);
				setClearedArtifactContextId(null);
				setArtifactFocus({
					type: "artifact",
					artifact: buildPlanModeWorkspaceArtifactRef(message, initialTab),
				});
				onNavigate({
					kind: "session",
					sessionId: message.taskId,
					artifact: { kind: "plan_mode_workspace", tab: initialTab },
				});
			} finally {
				openingQuestionnaireMessageIdsRef.current.delete(message.id);
			}
		},
		[
			waitForQuestionnaireWorkspaceReady,
			setArtifactFocus,
			setClearedArtifactContextId,
			onNavigate,
		],
	);

	useEffect(() => {
		if (!isActiveSessionWorkbenchRoute(routeState, workspace.activeSessionId))
			return;
		const latestQuestionnaireMessage = [...workspace.taskMessages]
			.reverse()
			.find(
				(message) =>
					message.taskId === workspace.activeSessionId &&
					(isDesignQuestionnaireReadyMessage(message) ||
						isDesignQuestionnaireStartingMessage(message)),
			);
		if (!latestQuestionnaireMessage) return;
		if (
			!shouldAutoOpenPlanArtifact({
				activeSession: workspace.activeSession,
				sessionView: workspace.activeSessionView,
				latestRun: workspace.latestRun,
				isChatSubmitting: workspace.isChatSubmitting,
				hasPlanArtifact: true,
			})
		)
			return;
		if (
			openedQuestionnaireMessageIdsRef.current.has(
				latestQuestionnaireMessage.id,
			)
		)
			return;
		let cancelled = false;
		if (isDesignQuestionnaireStartingMessage(latestQuestionnaireMessage)) {
			openedQuestionnaireMessageIdsRef.current.add(
				latestQuestionnaireMessage.id,
			);
			setClearedArtifactContextId(null);
			setArtifactFocus({
				type: "artifact",
				artifact: buildPlanModeWorkspaceArtifactRef(
					latestQuestionnaireMessage,
					"questionnaire",
				),
			});
			onNavigate({
				kind: "session",
				sessionId: latestQuestionnaireMessage.taskId,
				artifact: { kind: "plan_mode_workspace", tab: "questionnaire" },
			});
		} else {
			void openQuestionnaireWorkspace(
				latestQuestionnaireMessage,
				resolveQuestionnaireReadyInitialTab(latestQuestionnaireMessage),
				() => !cancelled,
			);
		}
		return () => {
			cancelled = true;
		};
	}, [
		openQuestionnaireWorkspace,
		workspace.activeSession,
		workspace.isChatSubmitting,
		workspace.activeSessionId,
		workspace.taskMessages,
		workspace.latestRun,
		workspace.activeSessionView,
		routeState,
		onNavigate,
		setArtifactFocus,
		setClearedArtifactContextId,
	]);

	return { openQuestionnaireWorkspace };
}
