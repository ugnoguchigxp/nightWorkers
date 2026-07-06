import type { MouseEvent } from "react";

export function handleWorkbenchAnchorClick(
	event: MouseEvent<HTMLAnchorElement>,
	action: () => void,
) {
	if (event.defaultPrevented || event.button !== 0) return;
	if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
	event.preventDefault();
	action();
}
