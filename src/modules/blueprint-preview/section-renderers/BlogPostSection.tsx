import { PreviewBadge } from '../BlueprintPreviewPrimitives';
import { toObjectArray } from '../previewModel';
import type { SectionRendererInput } from './types';

export function renderBlogPostSection({ componentName, props, t }: SectionRendererInput) {
  const title = String(props.title || props.headline || 'Designing a better product workflow');
  const dek = String(
    props.dek || props.description || props.subtitle || 'A text-forward section for article pages.'
  );
  const author = String(props.author || props.byline || 'Editorial Team');
  const date = String(props.date || props.publishedAt || 'June 15, 2026');
  const readingTime = String(props.readingTime || props.duration || '6 min read');
  const paragraphs = textList(props.paragraphs || props.body || props.content, [
    'Great product pages need more than a heading and a card grid. The article surface should make long-form text comfortable to scan while still preserving enough structure for review.',
    'This section keeps the title, byline, introduction, body copy, pull quote, and tags visible in one coherent editorial block.',
    'Use it when the primary job of the screen is reading, publishing, documentation, announcements, release notes, or thought leadership.',
  ]);
  const tags = textList(props.tags || props.categories, ['Product', 'Design', 'Workflow']);
  const quote = String(props.quote || props.pullQuote || '');

  return (
    <article className="mx-auto grid max-w-3xl gap-5 border-border border-y py-6">
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
          <span>{author}</span>
          <span aria-hidden="true">/</span>
          <span>{date}</span>
          <span aria-hidden="true">/</span>
          <span>{readingTime}</span>
        </div>
        <h2 className="text-3xl font-semibold leading-tight tracking-normal text-foreground">
          {title}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">{dek}</p>
      </header>

      <div className="grid gap-4 text-sm leading-7 text-foreground">
        {paragraphs.slice(0, 4).map((paragraph, index) => (
          <p key={`${componentName}-paragraph-${index}`}>{paragraph}</p>
        ))}
      </div>

      {quote ? (
        <blockquote className="border-primary border-l-4 pl-4 text-base font-medium leading-7 text-foreground">
          {quote}
        </blockquote>
      ) : null}

      <footer className="flex flex-wrap gap-2">
        {tags.slice(0, 5).map((tag) => (
          <PreviewBadge key={tag}>{tag}</PreviewBadge>
        ))}
      </footer>
    </article>
  );
}

function textList(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return String(
            (item as Record<string, unknown>).text ||
              (item as Record<string, unknown>).label ||
              (item as Record<string, unknown>).title ||
              ''
          );
        }
        return '';
      })
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
  }
  const objectItems = toObjectArray(value);
  if (objectItems.length > 0) {
    return objectItems
      .map((item) => String(item.text || item.label || item.title || ''))
      .filter(Boolean);
  }
  return fallback;
}
