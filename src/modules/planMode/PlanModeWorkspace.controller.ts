import { type Dispatch, type SetStateAction, useCallback } from "react";
import type { PlanWorkspaceTab } from "../specification";

export type PlanWorkspaceActionResult =
	| { focusTab?: PlanWorkspaceTab | null }
	| undefined;

export function usePlanWorkspaceActions(input: {
	isImplementationLocked: boolean;
	refresh: (options?: {
		preserveGeneratedBlueprintFocus?: boolean;
	}) => Promise<void>;
	selectActiveTab: (tab: PlanWorkspaceTab) => void;
	resetWorkspaceScrollTop: () => void;
	setBusyAction: Dispatch<SetStateAction<string | null>>;
	setActionError: Dispatch<SetStateAction<string | null>>;
	setActionNotice: Dispatch<SetStateAction<string | null>>;
}) {
	const {
		isImplementationLocked,
		refresh,
		resetWorkspaceScrollTop,
		selectActiveTab,
		setActionError,
		setActionNotice,
		setBusyAction,
	} = input;
	const runAction = useCallback(
		async (action: string, fn: () => Promise<PlanWorkspaceActionResult>) => {
			setBusyAction(action);
			setActionError(null);
			setActionNotice(null);
			try {
				const result = await fn();
				const focusTab = result?.focusTab ?? null;
				await refresh({
					preserveGeneratedBlueprintFocus: focusTab === "blueprint",
				});
				if (focusTab) {
					selectActiveTab(focusTab);
					resetWorkspaceScrollTop();
				}
			} catch (error) {
				setActionError(error instanceof Error ? error.message : String(error));
			} finally {
				setBusyAction(null);
			}
		},
		[
			refresh,
			resetWorkspaceScrollTop,
			selectActiveTab,
			setActionError,
			setActionNotice,
			setBusyAction,
		],
	);
	const runSessionAction = useCallback(
		async (action: string, fn?: () => Promise<void>) => {
			if (!fn || isImplementationLocked) return;
			await runAction(action, async () => {
				await fn();
				return undefined;
			});
		},
		[isImplementationLocked, runAction],
	);
	return { runAction, runSessionAction };
}
