import { RefreshCw } from 'lucide-react';
import type { Task, TaskMessage, TaskRun } from '../types';
import { formatFinishedTime } from '../utils/time';
import { ThreadMessage } from './ThreadMessage';

type ThreadTimelineProps = {
  session: Task;
  runs: TaskRun[];
  latestRun?: TaskRun;
  taskMessages: TaskMessage[];
  latestRunEvents: Array<{
    id: string;
    actor?: string;
    type?: string;
    message: string;
    timestamp?: unknown;
  }>;
  isAgentWorking: boolean;
  onReviewRun: (runId: string) => void;
};

export function ThreadTimeline({
  session,
  runs,
  taskMessages,
  latestRunEvents,
  isAgentWorking,
  onReviewRun,
}: ThreadTimelineProps) {
  const chatMessages = taskMessages.filter(
    (message) => message.role === 'user' || message.role === 'assistant'
  );
  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-6">
      {chatMessages.map((message) => (
        <ThreadMessage
          key={message.id}
          messageRole={
            message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : 'system'
          }
          timestamp={formatFinishedTime(message.createdAt)}
        >
          <MessagePayload message={message} />
        </ThreadMessage>
      ))}
      {isAgentWorking ? (
        <ThreadMessage messageRole="assistant">
          <span className="inline-flex items-center gap-2 text-cyan-300">
            <RefreshCw className="h-4 w-4 animate-spin" />
            AIが返答を生成中です...
          </span>
        </ThreadMessage>
      ) : null}
    </div>
  );
}

function MessagePayload({ message }: { message: TaskMessage }) {
  const metadata = message.metadataJson as any;
  if (message.messageType === 'chart' && metadata?.chartData) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-zinc-300">Chart</div>
        <pre className="overflow-x-auto rounded-md bg-black/30 p-2 text-xs">
          {JSON.stringify(metadata.chartData, null, 2)}
        </pre>
      </div>
    );
  }
  if (message.messageType === 'browser' && metadata?.browserFrameData?.url) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-zinc-300">Browser</div>
        <a
          className="text-cyan-300 underline"
          href={metadata.browserFrameData.url}
          target="_blank"
          rel="noreferrer"
        >
          {metadata.browserFrameData.url}
        </a>
      </div>
    );
  }
  if (message.messageType === 'flow' && metadata?.flowData) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-zinc-300">Flow</div>
        <pre className="overflow-x-auto rounded-md bg-black/30 p-2 text-xs">
          {JSON.stringify(metadata.flowData, null, 2)}
        </pre>
      </div>
    );
  }
  if (message.messageType === 'playwright' && metadata?.playwrightResult) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold text-zinc-300">Playwright</div>
        <pre className="overflow-x-auto rounded-md bg-black/30 p-2 text-xs">
          {JSON.stringify(metadata.playwrightResult, null, 2)}
        </pre>
      </div>
    );
  }
  if (message.messageType === 'markdown_document' && metadata?.markdownDocumentData?.content) {
    return (
      <pre className="overflow-x-auto rounded-md bg-black/30 p-2 text-xs">
        {metadata.markdownDocumentData.content}
      </pre>
    );
  }
  return <>{message.content}</>;
}
