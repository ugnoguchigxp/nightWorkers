export function workbenchRunStartedMessage(
	executionMode: "general_answer" | "implementation" | "review",
) {
	if (executionMode === "general_answer")
		return "General answer run started from Workbench intake.";
	if (executionMode === "review")
		return "Review run started from Workbench intake.";
	return "Implementation run started from Workbench intake.";
}
