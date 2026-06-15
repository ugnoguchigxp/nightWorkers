import { toObjectArray } from '../previewModel';
import type { SectionRendererInput } from './types';

export function renderChatPanelSection({ componentName, props, t }: SectionRendererInput) {
  const messages = toObjectArray(props.messages || props.items);
  const chatMessages =
    messages.length > 0
      ? messages
      : [
          {
            author: t('blueprint.preview.feed.user'),
            body: 'Can this Blueprint section support approval comments?',
            side: 'left',
          },
          {
            author: t('blueprint.preview.feed.agent'),
            body: 'Yes. The preview can show threaded review and status context.',
            side: 'right',
          },
          {
            author: t('blueprint.preview.feed.system'),
            body: 'Blueprint data bindings were mapped.',
            side: 'left',
          },
        ];
  return (
    <div className="grid gap-3">
      <div className="grid max-h-72 gap-2 overflow-y-auto rounded-md border border-border bg-muted p-3">
        {chatMessages.slice(0, 5).map((message, index) => {
          const isRight =
            message.side === 'right' ||
            message.role === 'assistant' ||
            message.author === 'Agent' ||
            message.actor === 'Agent';
          return (
            <div
              className={`grid max-w-[85%] gap-1 rounded-md border px-3 py-2 text-xs ${
                isRight
                  ? 'ml-auto border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground'
              }`}
              key={String(message.id || index)}
            >
              <div className={isRight ? 'text-primary-foreground/80' : 'text-muted-foreground'}>
                {String(message.author || message.actor || message.role || `Message ${index + 1}`)}
              </div>
              <div className="leading-5">
                {String(message.body || message.content || message.text || '')}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex min-h-[var(--blueprint-preview-control-height)] overflow-hidden rounded-md border border-border bg-card">
        <div className="flex-1 px-3 py-2 text-xs text-muted-foreground">
          {String(props.placeholder || 'Reply to this thread...')}
        </div>
        <div className="border-border border-l px-3 py-2 text-xs font-medium text-foreground">
          Send
        </div>
      </div>
    </div>
  );
}
