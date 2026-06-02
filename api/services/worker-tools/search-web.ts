import type { WorkerToolResult } from './types';

export interface SearchWebInput {
  query: string;
  maxResults?: number;
}

export interface SearchWebResultItem {
  title: string;
  url: string;
  snippet: string;
  position: number;
}

export interface SearchWebOutput {
  query: string;
  engine: 'duckduckgo-lite';
  results: SearchWebResultItem[];
  truncated: boolean;
}

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_CAP = 10;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const numeric = Number.parseInt(code, 10);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : _match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
      const numeric = Number.parseInt(code, 16);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : _match;
    });
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDuckDuckGoUrl(rawHref: string): string {
  try {
    const href = rawHref.startsWith('//') ? `https:${rawHref}` : rawHref;
    const parsed = new URL(href);
    const redirected = parsed.searchParams.get('uddg');
    if (redirected) return decodeURIComponent(redirected);
    return parsed.href;
  } catch {
    return rawHref;
  }
}

function isDuckDuckGoAdLink(rawHref: string): boolean {
  try {
    const href = rawHref.startsWith('//') ? `https:${rawHref}` : rawHref;
    const parsed = new URL(href);
    return (
      parsed.hostname === 'duckduckgo.com' &&
      (parsed.pathname === '/y.js' ||
        parsed.searchParams.has('ad_domain') ||
        parsed.searchParams.has('ad_provider'))
    );
  } catch {
    return false;
  }
}

function extractResultSnippet(slice: string): string {
  const match = slice.match(
    /class=['"](?:result-snippet|result__snippet)['"][^>]*>([\s\S]*?)<\/(?:td|a)>/i
  );
  if (match?.[1]) return stripTags(match[1]);
  return '';
}

function parseDuckDuckGoResults(html: string): SearchWebResultItem[] {
  const linkRegex =
    /<a[^>]+class=['"](?:result-link|result__a)['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
  const links = [...html.matchAll(linkRegex)];
  const results: SearchWebResultItem[] = [];

  for (let i = 0; i < links.length; i += 1) {
    const match = links[i];
    const nextIndex = links[i + 1]?.index ?? html.length;
    const href = match[1];
    const title = stripTags(match[2]);
    const slice = html.slice((match.index ?? 0) + match[0].length, nextIndex);
    const snippet = extractResultSnippet(slice) || stripTags(slice);

    if (!title || !href) continue;
    if (isDuckDuckGoAdLink(href)) continue;

    const normalizedUrl = normalizeDuckDuckGoUrl(href);
    if (!/^https?:\/\//i.test(normalizedUrl)) continue;
    const normalizedHost = (() => {
      try {
        return new URL(normalizedUrl).hostname;
      } catch {
        return '';
      }
    })();
    if (!normalizedHost || normalizedHost === 'duckduckgo.com') continue;

    results.push({
      position: results.length + 1,
      title,
      url: normalizedUrl,
      snippet,
    });
  }

  return results;
}

async function fetchDuckDuckGoSearch(query: string, variant: 'lite' | 'html'): Promise<string> {
  const baseUrl =
    variant === 'lite'
      ? 'https://lite.duckduckgo.com/lite/?q='
      : 'https://html.duckduckgo.com/html/?q=';
  const url = `${baseUrl}${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    },
  });
  if (!response.ok) {
    throw new Error(`search_web HTTP ${response.status}`);
  }
  return response.text();
}

export async function searchWebTool(
  input: SearchWebInput
): Promise<WorkerToolResult<SearchWebOutput>> {
  const startedAt = new Date().toISOString();
  const query = input.query.trim();
  const maxResults = Math.max(
    1,
    Math.min(input.maxResults ?? DEFAULT_MAX_RESULTS, MAX_RESULTS_CAP)
  );

  if (!query) {
    return {
      ok: false,
      toolName: 'search_web',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        query: '',
        engine: 'duckduckgo-lite',
        results: [],
        truncated: false,
      },
      error: {
        code: 'INVALID_TOOL_ARGS',
        message: 'search_web requires a non-empty query.',
      },
    };
  }

  try {
    const liteHtml = await fetchDuckDuckGoSearch(query, 'lite');
    let results = parseDuckDuckGoResults(liteHtml);
    if (results.length === 0) {
      const html = await fetchDuckDuckGoSearch(query, 'html');
      results = parseDuckDuckGoResults(html);
    }
    results = results.slice(0, maxResults);
    return {
      ok: true,
      toolName: 'search_web',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        query,
        engine: 'duckduckgo-lite',
        results,
        truncated: results.length >= maxResults,
      },
    };
  } catch (err: any) {
    return {
      ok: false,
      toolName: 'search_web',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        query,
        engine: 'duckduckgo-lite',
        results: [],
        truncated: false,
      },
      error: {
        code: 'SEARCH_WEB_FAILED',
        message: `Failed to search the web: ${err?.message ?? String(err)}`,
      },
    };
  }
}
