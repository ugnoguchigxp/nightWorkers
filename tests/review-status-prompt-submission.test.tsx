import { describe, expect, it, vi } from "vitest";

async function renderViewerWithSubmissionResult(accepted: boolean) {
	const stateSetters = [vi.fn(), vi.fn(), vi.fn()];
	let stateIndex = 0;
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useEffect: () => undefined,
			useState: <T,>(initial: T) => {
				const index = stateIndex++;
				return [initial, stateSetters[index]] as const;
			},
		};
	});
	vi.doMock("react-i18next", async () => ({
		...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
		useTranslation: () => ({ t: (key: string) => key }),
	}));
	const [{ ReviewStatusViewer }, { REVIEW_MODE_PROMPT_ACTIONS }] =
		await Promise.all([
			import("../src/modules/review/components/ReviewStatusViewer"),
			import("../src/modules/review/reviewModeLauncher"),
		]);
	const onSubmitReviewPrompt = vi.fn(async () => accepted);
	const root = ReviewStatusViewer({
		detail: null,
		onSubmitReviewPrompt,
	});
	const promptActions = findElementByTypeName(root, "ReviewPromptActions");
	const onSubmit = promptActions?.props?.onSubmit as
		| ((action: (typeof REVIEW_MODE_PROMPT_ACTIONS)[number]) => Promise<void>)
		| undefined;
	await onSubmit?.(REVIEW_MODE_PROMPT_ACTIONS[0]);
	return { onSubmitReviewPrompt, stateSetters };
}

function findElementByTypeName(
	node: unknown,
	name: string,
): { props?: Record<string, unknown> } | null {
	if (!node || typeof node !== "object") return null;
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = findElementByTypeName(child, name);
			if (found) return found;
		}
		return null;
	}
	const element = node as {
		type?: { name?: string };
		props?: Record<string, unknown>;
	};
	if (element.type?.name === name) return element;
	return findElementByTypeName(element.props?.children, name);
}

describe("Review Status prompt submission", () => {
	it("enters result waiting only after the workbench accepts the request", async () => {
		const { stateSetters } = await renderViewerWithSubmissionResult(true);

		expect(stateSetters[2]).toHaveBeenNthCalledWith(1, {
			actionId: "code_review",
			phase: "submitting",
		});
		expect(stateSetters[2]).toHaveBeenNthCalledWith(2, {
			actionId: "code_review",
			phase: "waiting",
		});
	});

	it("clears the indicator and reports an error when no request was accepted", async () => {
		const { onSubmitReviewPrompt, stateSetters } =
			await renderViewerWithSubmissionResult(false);

		expect(onSubmitReviewPrompt).toHaveBeenCalledOnce();
		expect(stateSetters[2]).toHaveBeenLastCalledWith(null);
		expect(stateSetters[1]).toHaveBeenLastCalledWith(
			"Review Codexの実行を開始できませんでした。もう一度お試しください。",
		);
	});
});
