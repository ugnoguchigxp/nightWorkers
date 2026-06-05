import { createHash } from 'node:crypto';
import type { CallSupervisorOptions } from './types';

export type JsonFixWrapperResult = {
  parsedJson: unknown;
  sourceText: string;
  repaired: boolean;
  repairKind: 'none' | 'extracted_candidate' | 'balanced_json' | 'extracted_and_balanced_json';
};

export function jsonFixWrapper(raw: string): JsonFixWrapperResult | null {
  const direct = raw.trim();
  const extracted = tryExtractJsonCandidate(raw);
  const candidates = [
    { text: direct, extracted: false },
    ...(extracted && extracted !== direct ? [{ text: extracted, extracted: true }] : []),
  ].filter((candidate) => candidate.text.length > 0);

  for (const candidate of candidates) {
    try {
      return {
        parsedJson: JSON.parse(candidate.text),
        sourceText: candidate.text,
        repaired: candidate.extracted,
        repairKind: candidate.extracted ? 'extracted_candidate' : 'none',
      };
    } catch {
      const balanced = balanceJsonCandidate(candidate.text);
      if (!balanced || balanced === candidate.text) continue;
      try {
        return {
          parsedJson: JSON.parse(balanced),
          sourceText: balanced,
          repaired: true,
          repairKind: candidate.extracted ? 'extracted_and_balanced_json' : 'balanced_json',
        };
      } catch {
        // Try the next candidate.
      }
    }
  }

  return null;
}

export function createSupervisorLlmAbortSignal(options: CallSupervisorOptions): AbortSignal {
  return AbortSignal.timeout(getSupervisorLlmTimeoutMs(options));
}

export function digestLlmText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tryExtractJsonCandidate(raw: string): string | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i) || raw.match(/```\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1).trim();
  return null;
}

function balanceJsonCandidate(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of trimmed) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') {
      if (stack.at(-1) !== char) return null;
      stack.pop();
    }
  }

  const stringSuffix = inString ? '"' : '';
  return `${trimmed}${stringSuffix}${stack.reverse().join('')}`;
}

function getSupervisorLlmTimeoutMs(options: CallSupervisorOptions): number {
  if (options.timeoutMs && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
    return Math.floor(options.timeoutMs);
  }
  const configured = Number(process.env.SUPERVISOR_LLM_TIMEOUT_MS || 120_000);
  if (!Number.isFinite(configured) || configured <= 0) return 120_000;
  return Math.floor(configured);
}
