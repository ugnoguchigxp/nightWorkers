import type {
	CodingAgentRunCommandResult,
	ResumeCodingAgentRunTodoCommand,
	StartCodingAgentRunCommand,
} from "../contracts/coding-agent-run";

export type StartCodingAgentRunHandler = (
	command: StartCodingAgentRunCommand,
) => Promise<CodingAgentRunCommandResult>;

export type ResumeCodingAgentRunTodoHandler = (
	command: ResumeCodingAgentRunTodoCommand,
) => Promise<CodingAgentRunCommandResult>;

let startHandler: StartCodingAgentRunHandler | null = null;
let resumeHandler: ResumeCodingAgentRunTodoHandler | null = null;

export function registerCodingAgentRunHandlers(input: {
	start: StartCodingAgentRunHandler;
	resume: ResumeCodingAgentRunTodoHandler;
}) {
	startHandler = input.start;
	resumeHandler = input.resume;
	return () => {
		if (startHandler === input.start) startHandler = null;
		if (resumeHandler === input.resume) resumeHandler = null;
	};
}

export async function startCodingAgentRun(command: StartCodingAgentRunCommand) {
	if (!startHandler)
		throw new Error("Coding Agent start handler is not registered.");
	return startHandler(command);
}

export async function resumeCodingAgentRunTodo(
	command: ResumeCodingAgentRunTodoCommand,
) {
	if (!resumeHandler)
		throw new Error("Coding Agent resume handler is not registered.");
	return resumeHandler(command);
}
