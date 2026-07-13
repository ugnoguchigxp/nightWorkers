import type { ReactNode } from "react";

type ThreadMessageProps = {
	messageRole: "user" | "assistant" | "system";
	children: ReactNode;
	timestamp?: string;
};

export function ThreadMessage({
	messageRole,
	children,
	timestamp,
}: ThreadMessageProps) {
	const isUser = messageRole === "user";
	const bubbleClass = isUser
		? "nightworkers-message-bubble-user"
		: messageRole === "assistant"
			? "nightworkers-message-bubble-assistant"
			: "nightworkers-message-bubble-system";

	return (
		<div
			className={`flex w-full flex-col ${isUser ? "items-end" : "items-start"}`}
			data-testid={`message-${messageRole}`}
		>
			<div
				className={`nightworkers-message-bubble max-w-[85%] rounded-2xl border px-5 py-3 text-sm leading-relaxed whitespace-pre-wrap ${bubbleClass}`}
				data-message-role={messageRole}
			>
				{children}
			</div>
			{timestamp ? (
				<span className="nightworkers-message-timestamp mt-1 text-[10px]">
					{timestamp}
				</span>
			) : null}
		</div>
	);
}
