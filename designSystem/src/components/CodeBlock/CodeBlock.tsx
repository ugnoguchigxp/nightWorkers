'use client';

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
import type { BundledLanguage, CodeOptionsMultipleThemes } from 'shiki';
import { Button } from '@/components/Button';
import { cn } from '@/utils/cn';

type CodeBlockLanguage = BundledLanguage | string;
type CodeBlockHighlighter = {
  codeToHtml: (
    code: string,
    options: {
      lang: string;
      themes: CodeOptionsMultipleThemes['themes'];
      transformers: unknown[];
    }
  ) => string;
};

export interface CodeBlockData {
  value?: string;
  language?: CodeBlockLanguage;
  filename?: string;
  code: string;
}

export interface CodeBlockProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'onCopy'> {
  data: CodeBlockData[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  lineNumbers?: boolean;
  syntaxHighlighting?: boolean;
  themes?: CodeOptionsMultipleThemes['themes'];
  showHeader?: boolean;
  maxHeight?: number | string;
  copyLabel?: string;
  copiedLabel?: string;
  onCopy?: (code: string) => void;
  onCopyError?: (error: unknown) => void;
}

interface CodeBlockContentProps {
  code: string;
  language?: CodeBlockLanguage;
  themes?: CodeOptionsMultipleThemes['themes'];
  syntaxHighlighting: boolean;
  lineNumbers: boolean;
  maxHeight?: number | string;
}

const defaultThemes: CodeOptionsMultipleThemes['themes'] = {
  light: 'github-light',
  dark: 'github-dark-default',
};

let highlighterPromise: Promise<CodeBlockHighlighter> | null = null;

const lineNumberClassNames = cn(
  '[&_code]:[counter-reset:line]',
  '[&_code]:[counter-increment:line_0]',
  '[&_.line]:before:content-[counter(line)]',
  '[&_.line]:before:inline-block',
  '[&_.line]:before:[counter-increment:line]',
  '[&_.line]:before:w-5',
  '[&_.line]:before:mr-4',
  '[&_.line]:before:text-right',
  '[&_.line]:before:text-muted-foreground/45',
  '[&_.line]:before:select-none'
);

const codeBlockContentClassNames = cn(
  'relative overflow-y-auto bg-background text-[13px]',
  '[&_pre]:m-0 [&_pre]:overflow-x-auto [&_pre]:bg-transparent [&_pre]:py-4',
  '[&_code]:grid [&_code]:min-w-full [&_code]:bg-transparent [&_code]:font-mono [&_code]:leading-6',
  '[&_.line]:relative [&_.line]:block [&_.line]:w-full [&_.line]:min-h-6 [&_.line]:px-4',
  '[&_.shiki]:!bg-transparent',
  '[&_.line.highlighted]:bg-info/10',
  '[&_.line.highlighted]:after:absolute [&_.line.highlighted]:after:left-0 [&_.line.highlighted]:after:top-0 [&_.line.highlighted]:after:bottom-0 [&_.line.highlighted]:after:w-0.5 [&_.line.highlighted]:after:bg-info',
  '[&_.highlighted-word]:rounded-[var(--radius-sm)] [&_.highlighted-word]:bg-info/10 [&_.highlighted-word]:px-0.5',
  '[&_.line.diff]:after:absolute [&_.line.diff]:after:left-0 [&_.line.diff]:after:top-0 [&_.line.diff]:after:bottom-0 [&_.line.diff]:after:w-0.5',
  '[&_.line.diff.add]:bg-success/10 [&_.line.diff.add]:after:bg-success',
  '[&_.line.diff.remove]:bg-destructive/10 [&_.line.diff.remove]:after:bg-destructive',
  '[&_code:has(.focused)_.line]:blur-[2px]',
  '[&_code:has(.focused)_.line.focused]:blur-none',
  'dark:[&_.shiki]:!text-[var(--shiki-dark)]',
  'dark:[&_.shiki_span]:!text-[var(--shiki-dark)]',
  'dark:[&_.shiki]:![font-style:var(--shiki-dark-font-style)]',
  'dark:[&_.shiki_span]:![font-style:var(--shiki-dark-font-style)]',
  'dark:[&_.shiki]:![font-weight:var(--shiki-dark-font-weight)]',
  'dark:[&_.shiki_span]:![font-weight:var(--shiki-dark-font-weight)]',
  'dark:[&_.shiki]:![text-decoration:var(--shiki-dark-text-decoration)]',
  'dark:[&_.shiki_span]:![text-decoration:var(--shiki-dark-text-decoration)]'
);

const fileIconClassName = 'h-4 w-4 shrink-0 text-muted-foreground';

const getItemValue = (item: CodeBlockData, index: number) =>
  item.value ?? item.filename ?? item.language ?? `item-${index}`;

const getItemLabel = (item: CodeBlockData) => item.filename ?? item.language ?? 'Code';

const getLanguageLabel = (language?: CodeBlockLanguage) => String(language ?? 'text');

const normalizeLanguage = (language?: CodeBlockLanguage) => {
  const value = getLanguageLabel(language).toLowerCase();
  const languageMap: Record<string, string> = {
    bash: 'bash',
    css: 'css',
    diff: 'diff',
    docker: 'docker',
    dockerfile: 'docker',
    html: 'html',
    js: 'javascript',
    javascript: 'javascript',
    json: 'json',
    jsx: 'jsx',
    markdown: 'markdown',
    md: 'markdown',
    mdx: 'markdown',
    shell: 'shellscript',
    shellscript: 'shellscript',
    sh: 'bash',
    sql: 'sql',
    ts: 'typescript',
    tsx: 'tsx',
    typescript: 'typescript',
    yaml: 'yaml',
    yml: 'yaml',
  };

  return languageMap[value] ?? 'text';
};

const getCodeBlockHighlighter = () => {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/tsx.mjs'),
      import('shiki/langs/javascript.mjs'),
      import('shiki/langs/jsx.mjs'),
      import('shiki/langs/json.mjs'),
      import('shiki/langs/bash.mjs'),
      import('shiki/langs/shellscript.mjs'),
      import('shiki/langs/diff.mjs'),
      import('shiki/langs/markdown.mjs'),
      import('shiki/langs/css.mjs'),
      import('shiki/langs/html.mjs'),
      import('shiki/langs/sql.mjs'),
      import('shiki/langs/yaml.mjs'),
      import('shiki/langs/docker.mjs'),
      import('shiki/themes/github-light.mjs'),
      import('shiki/themes/github-dark-default.mjs'),
    ]).then(
      ([
        core,
        engine,
        typescript,
        tsx,
        javascript,
        jsx,
        json,
        bash,
        shellscript,
        diff,
        markdown,
        css,
        html,
        sql,
        yaml,
        docker,
        githubLight,
        githubDarkDefault,
      ]) =>
        core.createHighlighterCore({
          engine: engine.createJavaScriptRegexEngine(),
          langs: [
            typescript.default,
            tsx.default,
            javascript.default,
            jsx.default,
            json.default,
            bash.default,
            shellscript.default,
            diff.default,
            markdown.default,
            css.default,
            html.default,
            sql.default,
            yaml.default,
            docker.default,
          ],
          themes: [githubLight.default, githubDarkDefault.default],
        }) as Promise<CodeBlockHighlighter>
    );
  }

  return highlighterPromise;
};

const normalizeMaxHeight = (maxHeight?: number | string): React.CSSProperties | undefined => {
  if (typeof maxHeight === 'number') {
    return { maxHeight };
  }

  if (typeof maxHeight === 'string') {
    return { maxHeight };
  }

  return undefined;
};

const getCodeIcon = (item: CodeBlockData) => {
  const filename = item.filename?.toLowerCase() ?? '';
  const language = getLanguageLabel(item.language).toLowerCase();
  const target = filename || language;

  if (target.includes('package.json') || target.endsWith('.json')) {
    return <Database className={fileIconClassName} />;
  }

  if (target.endsWith('.md') || target.endsWith('.mdx') || language === 'markdown') {
    return <FileText className={fileIconClassName} />;
  }

  if (target.includes('dockerfile') || language === 'bash' || language === 'shell' || target.endsWith('.sh')) {
    return <Terminal className={fileIconClassName} />;
  }

  if (target.includes('config') || target.endsWith('.toml') || target.endsWith('.yaml') || target.endsWith('.yml')) {
    return <Settings className={fileIconClassName} />;
  }

  if (language === 'tsx' || language === 'jsx' || language === 'typescript' || language === 'javascript') {
    return <Braces className={fileIconClassName} />;
  }

  if (item.language || filename.match(/\.(ts|tsx|js|jsx|css|html|sql)$/)) {
    return <FileCode className={fileIconClassName} />;
  }

  return <File className={fileIconClassName} />;
};

const useControllableValue = ({
  value,
  defaultValue,
  onValueChange,
}: {
  value?: string;
  defaultValue: string;
  onValueChange?: (value: string) => void;
}) => {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const setValue = React.useCallback(
    (nextValue: string) => {
      if (!isControlled) {
        setInternalValue(nextValue);
      }
      onValueChange?.(nextValue);
    },
    [isControlled, onValueChange]
  );

  return [currentValue, setValue] as const;
};

const CodeBlockFallback = ({ code }: { code: string }) => (
  <pre className="m-0 overflow-x-auto bg-transparent py-4">
    <code className="grid min-w-full bg-transparent font-mono leading-6">
      {code.split('\n').map((line, index) => (
        <span className="line block min-h-6 w-full px-4" key={`${index}-${line}`}>
          {line || ' '}
        </span>
      ))}
    </code>
  </pre>
);

const CodeBlockContent = ({
  code,
  language,
  themes,
  syntaxHighlighting,
  lineNumbers,
  maxHeight,
}: CodeBlockContentProps) => {
  const [html, setHtml] = React.useState<string | null>(null);
  const [highlightFailed, setHighlightFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    if (!syntaxHighlighting) {
      setHtml(null);
      setHighlightFailed(false);
      return () => {
        cancelled = true;
      };
    }

    setHighlightFailed(false);

    Promise.all([getCodeBlockHighlighter(), import('@shikijs/transformers')])
      .then(([highlighter, transformers]) =>
        highlighter.codeToHtml(code, {
          lang: normalizeLanguage(language),
          themes: themes ?? defaultThemes,
          transformers: [
            transformers.transformerNotationDiff({ matchAlgorithm: 'v3' }),
            transformers.transformerNotationHighlight({ matchAlgorithm: 'v3' }),
            transformers.transformerNotationWordHighlight({ matchAlgorithm: 'v3' }),
            transformers.transformerNotationFocus({ matchAlgorithm: 'v3' }),
            transformers.transformerNotationErrorLevel({ matchAlgorithm: 'v3' }),
          ],
        })
      )
      .then((nextHtml) => {
        if (!cancelled) {
          setHtml(nextHtml);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtml(null);
          setHighlightFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, language, syntaxHighlighting, themes]);

  return (
    <div
      className={cn(codeBlockContentClassNames, lineNumbers && lineNumberClassNames)}
      data-line-numbers={lineNumbers}
      data-syntax-highlighting={syntaxHighlighting && !highlightFailed}
      style={normalizeMaxHeight(maxHeight)}
    >
      {syntaxHighlighting && html ? (
        <div
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki returns escaped code HTML with token spans.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <CodeBlockFallback code={code} />
      )}
    </div>
  );
};

export const CodeBlock = React.forwardRef<HTMLDivElement, CodeBlockProps>(
  (
    {
      className,
      data,
      value,
      defaultValue,
      onValueChange,
      lineNumbers = true,
      syntaxHighlighting = true,
      themes,
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
    const firstValue = data[0] ? getItemValue(data[0], 0) : '';
    const [activeValue, setActiveValue] = useControllableValue({
      value,
      defaultValue: defaultValue ?? firstValue,
      onValueChange,
    });
    const [isCopied, setIsCopied] = React.useState(false);
    const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(
      () => () => {
        if (copyTimerRef.current) {
          clearTimeout(copyTimerRef.current);
        }
      },
      []
    );

    const activeItem =
      data.find((item, index) => getItemValue(item, index) === activeValue) ?? data[0];
    const activeIndex = data.findIndex((item, index) => getItemValue(item, index) === activeValue);
    const activeLabel = activeItem ? getItemLabel(activeItem) : 'Code';

    const handleCopy = async () => {
      if (!activeItem || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        return;
      }

      try {
        await navigator.clipboard.writeText(activeItem.code);
        setIsCopied(true);
        onCopy?.(activeItem.code);

        if (copyTimerRef.current) {
          clearTimeout(copyTimerRef.current);
        }
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
        {showHeader && (
          <div className="flex min-h-10 items-center gap-2 border-b border-border bg-muted/50 px-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
              {data.length > 1 ? (
                data.map((item, index) => {
                  const itemValue = getItemValue(item, index);
                  const isActive = itemValue === activeValue;

                  return (
                    <button
                      aria-pressed={isActive}
                      className={cn(
                        'inline-flex h-8 max-w-48 shrink-0 items-center gap-2 rounded-[var(--radius-sm)] px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                        isActive && 'bg-background text-foreground shadow-xs'
                      )}
                      key={itemValue}
                      onClick={() => setActiveValue(itemValue)}
                      type="button"
                    >
                      {getCodeIcon(item)}
                      <span className="truncate">{getItemLabel(item)}</span>
                    </button>
                  );
                })
              ) : (
                <div className="flex min-w-0 items-center gap-2 px-2 text-muted-foreground text-xs">
                  {activeItem ? getCodeIcon(activeItem) : <Code2 className={fileIconClassName} />}
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
        )}
        {activeItem ? (
          <CodeBlockContent
            code={activeItem.code}
            language={activeItem.language}
            lineNumbers={lineNumbers}
            maxHeight={maxHeight}
            syntaxHighlighting={syntaxHighlighting}
            themes={themes}
          />
        ) : (
          <div className="flex min-h-24 items-center justify-center bg-background text-muted-foreground text-sm">
            No code available.
          </div>
        )}
        {activeItem && (
          <div className="sr-only" aria-live="polite">
            Showing {activeLabel}
            {activeIndex >= 0 ? `, item ${activeIndex + 1} of ${data.length}` : ''}
          </div>
        )}
      </div>
    );
  }
);

CodeBlock.displayName = 'CodeBlock';
