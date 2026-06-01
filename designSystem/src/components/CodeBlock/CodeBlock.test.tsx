import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock';

const mockCodeToHtml = vi.fn(async (code: string) => {
  const lines = code
    .split('\n')
    .map((line) => `<span class="line">${line}</span>`)
    .join('');
  return `<pre class="shiki"><code>${lines}</code></pre>`;
});

vi.mock('shiki/core', () => ({
  createHighlighterCore: vi.fn(async () => ({
    codeToHtml: mockCodeToHtml,
  })),
}));

vi.mock('shiki/engine/javascript', () => ({
  createJavaScriptRegexEngine: vi.fn(() => ({})),
}));

vi.mock('@shikijs/transformers', () => ({
  transformerNotationDiff: vi.fn(() => ({ name: 'diff' })),
  transformerNotationErrorLevel: vi.fn(() => ({ name: 'error-level' })),
  transformerNotationFocus: vi.fn(() => ({ name: 'focus' })),
  transformerNotationHighlight: vi.fn(() => ({ name: 'highlight' })),
  transformerNotationWordHighlight: vi.fn(() => ({ name: 'word-highlight' })),
}));

const mockWriteText = vi.fn();

Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: mockWriteText,
  },
  writable: true,
});

describe('CodeBlock', () => {
  beforeEach(() => {
    mockCodeToHtml.mockClear();
    mockWriteText.mockClear();
    mockWriteText.mockResolvedValue(undefined);
  });

  it('renders filename and code fallback immediately', () => {
    render(
      <CodeBlock
        data={[
          {
            filename: 'example.ts',
            language: 'typescript',
            code: 'const value = 1;',
          },
        ]}
      />
    );

    expect(screen.getByText('example.ts')).toBeInTheDocument();
    expect(screen.getByText('const value = 1;')).toBeInTheDocument();
  });

  it('highlights code with shiki when syntax highlighting is enabled', async () => {
    render(
      <CodeBlock
        data={[
          {
            filename: 'example.ts',
            language: 'typescript',
            code: 'const value = 1;',
          },
        ]}
      />
    );

    await waitFor(() => {
      expect(mockCodeToHtml).toHaveBeenCalledWith(
        'const value = 1;',
        expect.objectContaining({ lang: 'typescript' })
      );
    });
  });

  it('does not call shiki when syntax highlighting is disabled', async () => {
    render(
      <CodeBlock
        data={[
          {
            filename: 'run.log',
            language: 'text',
            code: 'plain log output',
          },
        ]}
        syntaxHighlighting={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('plain log output')).toBeInTheDocument();
    });
    expect(mockCodeToHtml).not.toHaveBeenCalled();
  });

  it('copies the active code to clipboard', async () => {
    render(
      <CodeBlock
        data={[
          {
            filename: 'example.ts',
            language: 'typescript',
            code: 'const value = 1;',
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith('const value = 1;');
    });
  });

  it('switches files and copies the selected file content', async () => {
    const onValueChange = vi.fn();

    render(
      <CodeBlock
        data={[
          {
            filename: 'one.ts',
            language: 'typescript',
            code: 'const one = 1;',
          },
          {
            filename: 'two.ts',
            language: 'typescript',
            code: 'const two = 2;',
          },
        ]}
        onValueChange={onValueChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /two.ts/i }));

    expect(onValueChange).toHaveBeenCalledWith('two.ts');
    expect(screen.getByText('const two = 2;')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith('const two = 2;');
    });
  });

  it('marks line number state on the rendered content', () => {
    const { rerender } = render(
      <CodeBlock
        data={[
          {
            filename: 'example.ts',
            language: 'typescript',
            code: 'const value = 1;',
          },
        ]}
      />
    );

    expect(document.querySelector('[data-line-numbers="true"]')).toBeInTheDocument();

    rerender(
      <CodeBlock
        data={[
          {
            filename: 'example.ts',
            language: 'typescript',
            code: 'const value = 1;',
          },
        ]}
        lineNumbers={false}
      />
    );

    expect(document.querySelector('[data-line-numbers="false"]')).toBeInTheDocument();
  });

  it('shows an empty state when no data is provided', () => {
    render(<CodeBlock data={[]} />);

    expect(screen.getByText('No code available.')).toBeInTheDocument();
  });
});
