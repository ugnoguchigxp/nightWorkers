import {
  Braces,
  Check,
  Code2,
  Copy,
  Database,
  File,
  FileCode,
  FileText,
  Settings,
  Terminal,
} from 'lucide-react';
import * as React from 'react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

export type CodeBlockLanguage = string;

export interface CodeBlockData {
  value?: string;
  language?: CodeBlockLanguage;
  filename?: string;
  code: string;
}

export interface CodeBlockProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'onCopy'> {
  data: CodeBlockData[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  lineNumbers?: boolean;
  syntaxHighlighting?: boolean;
  themes?: unknown;
  showHeader?: boolean;
  maxHeight?: number | string;
  copyLabel?: string;
  copiedLabel?: string;
  onCopy?: (code: string) => void;
  onCopyError?: (error: unknown) => void;
}

const fileIconClassName = 'h-4 w-4 shrink-0 text-muted-foreground';

function itemValue(item: CodeBlockData, index: number) {
  return item.value ?? item.filename ?? item.language ?? `item-${index}`;
}

function itemLabel(item: CodeBlockData) {
  return item.filename ?? item.language ?? 'Code';
}

function normalizeMaxHeight(maxHeight?: number | string): React.CSSProperties | undefined {
  if (typeof maxHeight === 'number') return { maxHeight };
  if (typeof maxHeight === 'string') return { maxHeight };
  return undefined;
}

function codeIcon(item: CodeBlockData) {
  const filename = item.filename?.toLowerCase() ?? '';
  const language = item.language?.toLowerCase() ?? '';
  const target = filename || language;

  if (target.includes('package.json') || target.endsWith('.json'))
    return <Database className={fileIconClassName} />;
  if (target.endsWith('.md') || target.endsWith('.mdx') || language === 'markdown') {
    return <FileText className={fileIconClassName} />;
  }
  if (
    target.includes('dockerfile') ||
    language === 'bash' ||
    language === 'shell' ||
    target.endsWith('.sh')
  ) {
    return <Terminal className={fileIconClassName} />;
  }
  if (
    target.includes('config') ||
    target.endsWith('.toml') ||
    target.endsWith('.yaml') ||
    target.endsWith('.yml')
  ) {
    return <Settings className={fileIconClassName} />;
  }
  if (['tsx', 'jsx', 'typescript', 'javascript'].includes(language)) {
    return <Braces className={fileIconClassName} />;
  }
  if (item.language || filename.match(/\.(ts|tsx|js|jsx|css|html|sql)$/)) {
    return <FileCode className={fileIconClassName} />;
  }
  return <File className={fileIconClassName} />;
}

function useControllableValue({
  value,
  defaultValue,
  onValueChange,
}: {
  value?: string;
  defaultValue: string;
  onValueChange?: (value: string) => void;
}) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const setValue = React.useCallback(
    (nextValue: string) => {
      if (!isControlled) setInternalValue(nextValue);
      onValueChange?.(nextValue);
    },
    [isControlled, onValueChange]
  );

  return [currentValue, setValue] as const;
}

function CodeLines({ code, lineNumbers }: { code: string; lineNumbers: boolean }) {
  return (
    <pre className="m-0 overflow-x-auto bg-transparent py-4">
      <code className="grid min-w-full bg-transparent font-mono leading-6">
        {code.split('\n').map((line, index) => (
          <span className="line block min-h-6 w-full px-4" key={`${index}-${line}`}>
            {lineNumbers ? (
              <span className="mr-4 inline-block w-5 select-none text-right text-muted-foreground/45">
                {index + 1}
              </span>
            ) : null}
            {line || ' '}
          </span>
        ))}
      </code>
    </pre>
  );
}

export const CodeBlock = React.forwardRef<HTMLDivElement, CodeBlockProps>(
  (
    {
      className,
      data,
      value,
      defaultValue,
      onValueChange,
      lineNumbers = true,
      syntaxHighlighting: _syntaxHighlighting = false,
      themes: _themes,
      showHeader = true,
      maxHeight = 420,
      copyLabel = 'Copy code',
      copiedLabel = 'Copied',
      onCopy,
      onCopyError,
      ...props
    },
    ref
  ) => {
    const firstValue = data[0] ? itemValue(data[0], 0) : '';
    const [activeValue, setActiveValue] = useControllableValue({
      value,
      defaultValue: defaultValue ?? firstValue,
      onValueChange,
    });
    const [isCopied, setIsCopied] = React.useState(false);
    const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(
      () => () => {
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      },
      []
    );

    const activeItem =
      data.find((item, index) => itemValue(item, index) === activeValue) ?? data[0];
    const activeIndex = data.findIndex((item, index) => itemValue(item, index) === activeValue);
    const activeLabel = activeItem ? itemLabel(activeItem) : 'Code';

    const handleCopy = async () => {
      if (!activeItem || typeof navigator === 'undefined' || !navigator.clipboard?.writeText)
        return;

      try {
        await navigator.clipboard.writeText(activeItem.code);
        setIsCopied(true);
        onCopy?.(activeItem.code);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setIsCopied(false), 1800);
      } catch (error) {
        onCopyError?.(error);
      }
    };

    return (
      <div
        ref={ref}
        className={cn(
          'overflow-hidden rounded-[var(--radius-md)] border border-border bg-card text-card-foreground shadow-sm',
          className
        )}
        {...props}
      >
        {showHeader ? (
          <div className="flex min-h-10 items-center gap-2 border-border border-b bg-muted/50 px-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
              {data.length > 1 ? (
                data.map((item, index) => {
                  const tabValue = itemValue(item, index);
                  const isActive = tabValue === activeValue;
                  return (
                    <button
                      aria-pressed={isActive}
                      className={cn(
                        'inline-flex h-8 max-w-48 shrink-0 items-center gap-2 rounded-[var(--radius-sm)] px-2.5 text-muted-foreground text-xs transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                        isActive && 'bg-background text-foreground shadow-xs'
                      )}
                      key={tabValue}
                      onClick={() => setActiveValue(tabValue)}
                      type="button"
                    >
                      {codeIcon(item)}
                      <span className="truncate">{itemLabel(item)}</span>
                    </button>
                  );
                })
              ) : (
                <div className="flex min-w-0 items-center gap-2 px-2 text-muted-foreground text-xs">
                  {activeItem ? codeIcon(activeItem) : <Code2 className={fileIconClassName} />}
                  <span className="truncate">{activeLabel}</span>
                </div>
              )}
            </div>
            <Button
              aria-label={isCopied ? copiedLabel : copyLabel}
              className="h-8 w-8 shrink-0 p-0"
              onClick={handleCopy}
              title={isCopied ? copiedLabel : copyLabel}
              variant="ghost"
            >
              {isCopied ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <Copy className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </div>
        ) : null}
        {activeItem ? (
          <div
            className="relative overflow-y-auto bg-background text-[13px] [&_.line]:relative [&_.line]:block [&_.line]:min-h-6 [&_code]:break-words [&_code]:whitespace-pre-wrap [&_pre]:overflow-x-hidden"
            data-syntax-highlighting="false"
            style={normalizeMaxHeight(maxHeight)}
          >
            <CodeLines code={activeItem.code} lineNumbers={lineNumbers} />
          </div>
        ) : (
          <div className="flex min-h-24 items-center justify-center bg-background text-muted-foreground text-sm">
            No code available.
          </div>
        )}
        {activeItem ? (
          <div className="sr-only" aria-live="polite">
            Showing {activeLabel}
            {activeIndex >= 0 ? `, item ${activeIndex + 1} of ${data.length}` : ''}
          </div>
        ) : null}
      </div>
    );
  }
);

CodeBlock.displayName = 'CodeBlock';
