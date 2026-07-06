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
		? "nightworkers-message-bubble-user bg-[#242530] border-[#30313f] text-zinc-100"
		: messageRole === "assistant"
			? "nightworkers-message-bubble-assistant bg-[#191924] border-[#2b2c3d]/60 text-zinc-100"
			: "nightworkers-message-bubble-system bg-zinc-900/70 border-zinc-700/50 text-zinc-300";

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
				<span className="nightworkers-message-timestamp mt-1 text-[10px] text-zinc-500">
					{timestamp}
				</span>
			) : null}
		</div>
	);
}
