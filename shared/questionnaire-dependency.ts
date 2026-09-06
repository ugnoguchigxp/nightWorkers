import type {
	DesignQuestionDependency,
	DesignQuestionnaireAnswer,
} from "./schemas/design-questionnaire.schema";

export function evaluateQuestionDependency(
	answer: DesignQuestionnaireAnswer,
	dependency: DesignQuestionDependency,
) {
	const expected = dependency.value;
	const values = [
		...answer.selectedOptionIds,
		...answer.rankedOptionIds,
		...(answer.freeText?.trim() ? [answer.freeText.trim()] : []),
	];
	const hasExpectedString = Array.isArray(expected)
		? expected.some((value) => values.includes(String(value)))
		: values.includes(String(expected));
	if (typeof expected === "boolean") {
		if (dependency.operator === "equals")
			return answer.booleanValue === expected;
		if (dependency.operator === "not_equals")
			return answer.booleanValue !== expected;
		return false;
	}
	if (dependency.operator === "equals" || dependency.operator === "includes") {
		return hasExpectedString;
	}
	if (
		dependency.operator === "not_equals" ||
		dependency.operator === "excludes"
	) {
		return !hasExpectedString;
	}
	return false;
}
