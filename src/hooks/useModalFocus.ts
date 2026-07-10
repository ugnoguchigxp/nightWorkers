import { type RefObject, useEffect, useRef } from "react";

const focusableSelector = [
	"button:not([disabled])",
	"[href]",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

export function useModalFocus<T extends HTMLElement>(input: {
	open: boolean;
	onClose: () => void;
}): RefObject<T | null> {
	const dialogRef = useRef<T | null>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const onCloseRef = useRef(input.onClose);
	useEffect(() => {
		onCloseRef.current = input.onClose;
	}, [input.onClose]);
	useEffect(() => {
		if (!input.open) return;
		returnFocusRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const dialog = dialogRef.current;
		const focusable = () =>
			[
				...(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? []),
			].filter(
				(element) =>
					!element.hidden && element.getAttribute("aria-hidden") !== "true",
			);
		focusable()[0]?.focus();
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onCloseRef.current();
				return;
			}
			if (event.key !== "Tab") return;
			const elements = focusable();
			if (elements.length === 0) {
				event.preventDefault();
				dialog?.focus();
				return;
			}
			const first = elements[0];
			const last = elements[elements.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first?.focus();
			}
		};
		const handleFocusIn = (event: FocusEvent) => {
			if (
				dialog &&
				event.target instanceof Node &&
				!dialog.contains(event.target)
			) {
				(focusable()[0] ?? dialog).focus();
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		document.addEventListener("focusin", handleFocusIn);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			document.removeEventListener("focusin", handleFocusIn);
			returnFocusRef.current?.focus();
		};
	}, [input.open]);
	return dialogRef;
}
