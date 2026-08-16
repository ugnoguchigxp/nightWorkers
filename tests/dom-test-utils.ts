import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export type MountedDom = {
	container: HTMLDivElement;
	rerender: (element: ReactElement) => Promise<void>;
	unmount: () => Promise<void>;
};

export async function mountDom(element: ReactElement): Promise<MountedDom> {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await render(root, element);
	return {
		container,
		rerender: (next) => render(root, next),
		unmount: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

export async function flushDom() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

export async function clickDom(element: Element) {
	await act(async () => {
		element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await Promise.resolve();
		await Promise.resolve();
	});
}

export async function setInputValue(input: HTMLInputElement, value: string) {
	const descriptor = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	);
	descriptor?.set?.call(input, value);
	await act(async () => {
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

export function buttonByLabel(container: Element, label: string) {
	const button = [...container.querySelectorAll("button")].find(
		(candidate) =>
			candidate.textContent?.trim() === label ||
			[...candidate.querySelectorAll("[title]")].some(
				(element) => element.getAttribute("title") === label,
			),
	);
	if (!button) throw new Error(`Button not found: ${label}`);
	return button;
}

async function render(root: Root, element: ReactElement) {
	await act(async () => root.render(element));
}
