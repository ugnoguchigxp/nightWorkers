import type { ReactNode } from 'react';

type ThreadMessageProps = {
  messageRole: 'user' | 'assistant' | 'system';
  children: ReactNode;
  timestamp?: string;
};

export function ThreadMessage({ messageRole, children, timestamp }: ThreadMessageProps) {
  const isUser = messageRole === 'user';
  const bubbleClass = isUser
    ? 'bg-[#242530] border-[#30313f] text-zinc-100'
    : messageRole === 'assistant'
      ? 'bg-[#191924] border-[#2b2c3d]/60 text-zinc-100'
      : 'bg-zinc-900/70 border-zinc-700/50 text-zinc-300';

  return (
    <div className={`flex w-full flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl border px-5 py-3 text-sm leading-relaxed whitespace-pre-wrap ${bubbleClass}`}
      >
        {children}
      </div>
      {timestamp ? <span className="mt-1 text-[10px] text-zinc-500">{timestamp}</span> : null}
    </div>
  );
}
