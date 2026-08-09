import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { NumberField } from "../src/modules/settings/SettingsFields";

type NumberInputElement = ReactElement<{
	onChange: (event: { target: { value: string } }) => void;
	onBlur: (event: { currentTarget: { value: string } }) => void;
}>;

function inputOf(field: ReactElement): NumberInputElement {
	const children = (field.props as { children: ReactElement[] }).children;
	return children[1] as NumberInputElement;
}

describe("NumberField", () => {
	it("keeps intermediate timeout values while typing", () => {
		const onChange = vi.fn();
		const input = inputOf(
			NumberField({
				id: "request-timeout",
				label: "Request timeout",
				value: 300,
				min: 30,
				max: 1200,
				clampOnBlur: true,
				onChange,
			}),
		);

		input.props.onChange({ target: { value: "6" } });
		input.props.onChange({ target: { value: "60" } });
		input.props.onChange({ target: { value: "600" } });

		expect(onChange.mock.calls).toEqual([[6], [60], [600]]);
	});

	it.each([
		{ value: 6, expected: 30 },
		{ value: 1201, expected: 1200 },
	])("clamps $value to $expected on blur", ({ value, expected }) => {
		const onChange = vi.fn();
		const input = inputOf(
			NumberField({
				id: "request-timeout",
				label: "Request timeout",
				value,
				min: 30,
				max: 1200,
				clampOnBlur: true,
				onChange,
			}),
		);

		input.props.onBlur({ currentTarget: { value: String(value) } });

		expect(onChange).toHaveBeenCalledWith(expected);
	});
});
