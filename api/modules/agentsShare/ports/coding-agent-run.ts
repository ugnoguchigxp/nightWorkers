import type {
	CodingAgentRunCommandResult,
	ResumeCodingAgentRunTodoCommand,
	ResumeInterruptedCodingAgentRunCommand,
	StartCodingAgentRunCommand,
} from "../contracts/coding-agent-run";

export type StartCodingAgentRunHandler = (
	command: StartCodingAgentRunCommand,
) => Promise<CodingAgentRunCommandResult>;

export type ResumeCodingAgentRunTodoHandler = (
	command: ResumeCodingAgentRunTodoCommand,
) => Promise<CodingAgentRunCommandResult>;

export type ResumeInterruptedCodingAgentRunHandler = (
	command: ResumeInterruptedCodingAgentRunCommand,
) => Promise<CodingAgentRunCommandResult>;

let startHandler: StartCodingAgentRunHandler | null = null;
let resumeHandler: ResumeCodingAgentRunTodoHandler | null = null;
let resumeInterruptedHandler: ResumeInterruptedCodingAgentRunHandler | null =
	null;

export function registerCodingAgentRunHandlers(input: {
	start: StartCodingAgentRunHandler;
	resume: ResumeCodingAgentRunTodoHandler;
	resumeInterrupted?: ResumeInterruptedCodingAgentRunHandler;
}) {
	startHandler = input.start;
	resumeHandler = input.resume;
	resumeInterruptedHandler = input.resumeInterrupted ?? null;
	return () => {
		if (startHandler === input.start) startHandler = null;
		if (resumeHandler === input.resume) resumeHandler = null;
		if (resumeInterruptedHandler === input.resumeInterrupted)
			resumeInterruptedHandler = null;
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

export async function resumeInterruptedCodingAgentRun(
	command: ResumeInterruptedCodingAgentRunCommand,
) {
	if (!resumeInterruptedHandler)
		throw new Error("Coding Agent interrupted-run handler is not registered.");
	return resumeInterruptedHandler(command);
}
