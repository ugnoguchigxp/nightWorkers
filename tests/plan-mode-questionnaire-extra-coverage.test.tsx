import {
	Fragment,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("lucide-react", () => ({
	ChevronDown: () => <span data-icon="down" />,
	ChevronUp: () => <span data-icon="up" />,
	LoaderCircle: () => <span data-icon="loading" />,
	Send: () => <span data-icon="send" />,
}));

import type {
	DesignQuestion,
	DesignQuestionOption,
	DesignQuestionSet,
} from "../shared/schemas/design-questionnaire.schema";
import type { DesignQuestionnaireAnswer } from "../src/modules/nightworkers/types";
import {
	ActionButton,
	getQuestionnaireSubmissionState,
	QuestionnaireForm,
} from "../src/modules/planMode/PlanModeQuestionnaire";

type HostElement = ReactElement<Record<string, unknown>, string>;

function collectHostElements(node: ReactNode, result: HostElement[] = []) {
	if (node === null || node === undefined || typeof node === "boolean")
		return result;
	if (Array.isArray(node)) {
		for (const child of node) collectHostElements(child, result);
		return result;
	}
	if (!isValidElement<Record<string, unknown>>(node)) return result;
	if (typeof node.type === "function") {
		return collectHostElements(node.type(node.props), result);
	}
	if (node.type === Fragment) {
		return collectHostElements(node.props.children as ReactNode, result);
	}
	if (typeof node.type === "string") {
		result.push(node as HostElement);
		collectHostElements(node.props.children as ReactNode, result);
	}
	return result;
}

function option(id: string): DesignQuestionOption {
	return {
		id,
		label: `Option ${id}`,
		tradeoff: `Tradeoff ${id}`,
	};
}

function question(
	id: string,
	answerType: DesignQuestion["answerType"],
	options?: DesignQuestionOption[],
): DesignQuestion {
	return {
		id,
		topic: `Topic ${id}`,
		question: `Question ${id}`,
		why: `Why ${id}`,
		answerType,
		options,
		blocks: [`Block ${id}`],
		outputSection: id,
	};
}

function answer(
	questionId: string,
	overrides: Partial<DesignQuestionnaireAnswer> = {},
): DesignQuestionnaireAnswer {
	return {
		questionId,
		selectedOptionIds: [],
		rankedOptionIds: [],
		deferred: false,
		...overrides,
	};
}

function questionGroups(): DesignQuestionSet[] {
	return [
		{
			id: "primary",
			title: "Primary questions",
			category: "Design",
			purpose: "Choose implementation details",
			questions: [
				question("single", "single_choice", [
					option("single-a"),
					option("single-b"),
				]),
				question("multi", "multi_choice", [
					option("multi-a"),
					option("multi-b"),
				]),
				question("boolean", "boolean", "invalid-options" as never),
				question("free-empty", "free_text"),
				question("free-filled", "free_text"),
				question("ranked", "ranked", [
					option("rank-a"),
					option("rank-b"),
					option("rank-c"),
				]),
				question("choice-empty", "single_choice", []),
				question("ranked-empty", "ranked", []),
				{
					...question("hidden", "boolean"),
					dependsOn: [
						{
							questionId: "missing-parent",
							operator: "equals",
							value: true,
						},
					],
				},
			],
		},
		{
			id: "category-fallback",
			title: "Category fallback",
			category: "Fallback category",
			purpose: "",
			questions: [],
		},
		{
			id: "empty-description",
			title: "No description",
			category: "",
			purpose: "",
			questions: [],
		},
		{
			id: "invalid-questions",
			title: "Invalid questions",
			category: "Invalid",
			purpose: "",
			questions: null as never,
		},
	];
}

const answers: Record<string, DesignQuestionnaireAnswer> = {
	single: answer("single", { selectedOptionIds: ["single-a"] }),
	multi: answer("multi", { selectedOptionIds: ["multi-a"] }),
	boolean: answer("boolean", { booleanValue: true }),
	"free-filled": answer("free-filled", { freeText: "existing notes" }),
	ranked: answer("ranked", {
		rankedOptionIds: ["missing-rank", "rank-b"],
	}),
	"choice-empty": answer("choice-empty", { deferred: true }),
};

describe("PlanModeQuestionnaire extra coverage", () => {
	it("renders the empty state", () => {
		const markup = renderToStaticMarkup(
			<QuestionnaireForm questionGroups={[]} answers={{}} onChange={vi.fn()} />,
		);
		expect(markup).toContain("No valid question set.");
	});

	it("renders every question type, optional description, selection, and readonly state", () => {
		const onChange = vi.fn();
		const markup = renderToStaticMarkup(
			<QuestionnaireForm
				questionGroups={questionGroups()}
				answers={answers}
				onChange={onChange}
			/>,
		);

		expect(markup).toContain("Choose implementation details");
		expect(markup).toContain("Fallback category");
		expect(markup).toContain("Question single");
		expect(markup).toContain("Question multi");
		expect(markup).toContain("Question boolean");
		expect(markup).toContain("existing notes");
		expect(markup).toContain("Option rank-b");
		expect(markup).not.toContain("Question hidden");
		expect(markup).toContain("border-cyan-400/70");
		expect(markup).toContain('type="checkbox"');
		expect(markup).toContain('type="radio"');
		expect(markup).toContain("unanswered");

		const readOnlyMarkup = renderToStaticMarkup(
			<QuestionnaireForm
				questionGroups={questionGroups()}
				answers={answers}
				onChange={onChange}
				readOnly={true}
			/>,
		);
		expect(readOnlyMarkup).toContain("disabled");
	});

	it("updates deferred, single, multi, boolean, text, and ranked answers", () => {
		const onChange = vi.fn();
		const tree = QuestionnaireForm({
			questionGroups: questionGroups(),
			answers,
			onChange,
		});
		const hosts = collectHostElements(tree);
		const inputs = hosts.filter((element) => element.type === "input");
		const namedInputs = (name: string) =>
			inputs.filter((element) => element.props.name === name);

		const later = inputs.find((element) => element.props.name === undefined);
		if (!later) throw new Error("Expected a Later checkbox");
		(later.props.onChange as (event: { target: { checked: boolean } }) => void)(
			{
				target: { checked: true },
			},
		);

		for (const input of namedInputs("single")) {
			(input.props.onChange as () => void)();
		}
		for (const input of namedInputs("multi")) {
			(input.props.onChange as () => void)();
		}
		for (const input of namedInputs("boolean")) {
			(input.props.onChange as () => void)();
		}

		const textareas = hosts.filter((element) => element.type === "textarea");
		for (const textarea of textareas) {
			(
				textarea.props.onChange as (event: {
					target: { value: string };
				}) => void
			)({ target: { value: "updated text" } });
		}

		const rankedButtons = hosts.filter(
			(element) =>
				element.type === "button" &&
				typeof element.props["aria-label"] === "string" &&
				element.props.disabled === false,
		);
		for (const button of rankedButtons) {
			(button.props.onClick as () => void)();
		}

		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				single: expect.objectContaining({ selectedOptionIds: [] }),
			}),
		);
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				single: expect.objectContaining({ selectedOptionIds: ["single-b"] }),
			}),
		);
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				multi: expect.objectContaining({ selectedOptionIds: [] }),
			}),
		);
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				multi: expect.objectContaining({
					selectedOptionIds: ["multi-a", "multi-b"],
				}),
			}),
		);
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				"free-empty": expect.objectContaining({ freeText: "updated text" }),
			}),
		);
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				ranked: expect.objectContaining({
					rankedOptionIds: expect.arrayContaining([
						"rank-a",
						"rank-b",
						"rank-c",
					]),
				}),
			}),
		);
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				boolean: expect.objectContaining({ booleanValue: false }),
			}),
		);
	});

	it("renders and invokes idle, send, busy, and disabled action buttons", () => {
		const onClick = vi.fn();
		const variants = [
			ActionButton({ label: "Plain", onClick }),
			ActionButton({ label: "Send", icon: "send", busy: false, onClick }),
			ActionButton({ label: "Busy", icon: "send", busy: true, onClick }),
			ActionButton({ label: "Disabled", disabled: true, onClick }),
		];
		const markup = variants
			.map((variant) => renderToStaticMarkup(variant))
			.join("");
		expect(markup).toContain('data-icon="send"');
		expect(markup).toContain('data-icon="loading"');
		expect(markup).toContain("disabled");

		for (const variant of variants) {
			const button = collectHostElements(variant).find(
				(element) => element.type === "button",
			);
			if (!button) throw new Error("Expected an action button");
			(button.props.onClick as () => void)();
		}
		expect(onClick).toHaveBeenCalledTimes(4);
	});

	it("derives completed, incomplete, locked, unavailable, and ready submission states", () => {
		expect(
			getQuestionnaireSubmissionState({
				unansweredCount: 3,
				isCompleted: true,
				isImplementationLocked: false,
				isCapabilityEnabled: true,
			}),
		).toEqual({
			disabled: true,
			icon: undefined,
			label: "回答済み",
			readOnly: true,
			state: "completed",
		});
		expect(
			getQuestionnaireSubmissionState({
				unansweredCount: 2,
				isCompleted: false,
				isImplementationLocked: false,
				isCapabilityEnabled: true,
			}),
		).toMatchObject({
			disabled: true,
			label: "未回答 2件",
			state: "incomplete",
		});
		expect(
			getQuestionnaireSubmissionState({
				unansweredCount: 0,
				isCompleted: false,
				isImplementationLocked: true,
				isCapabilityEnabled: true,
			}),
		).toMatchObject({ disabled: true, readOnly: true, state: "ready" });
		expect(
			getQuestionnaireSubmissionState({
				unansweredCount: 0,
				isCompleted: false,
				isImplementationLocked: false,
				isCapabilityEnabled: false,
			}),
		).toMatchObject({ disabled: true, readOnly: false, state: "ready" });
		expect(
			getQuestionnaireSubmissionState({
				unansweredCount: 0,
				isCompleted: false,
				isImplementationLocked: false,
				isCapabilityEnabled: true,
			}),
		).toMatchObject({
			disabled: false,
			label: "回答を送信して次へ",
			state: "ready",
		});
	});
});
