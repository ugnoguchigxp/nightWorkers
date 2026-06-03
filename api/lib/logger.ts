import fs from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function shouldLog(level: LogLevel): boolean {
  const configured = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
  const configuredRank = levelRank[configured] ?? levelRank.info;
  return levelRank[level] >= configuredRank;
}

function nowLabel(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function levelLabel(level: LogLevel): string {
  if (level === 'debug') return 'Debug';
  if (level === 'warn') return 'Warn';
  if (level === 'error') return 'Error';
  return 'Info';
}

function inlineMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  const pairs = Object.entries(meta)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  if (pairs.length === 0) return '';
  return ` ${pairs.join(' ')}`;
}

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const API_LOG_PATH = path.join(LOG_DIR, 'api.log');
const TRACE_LOG_PATH = path.join(LOG_DIR, 'supervisor-trace.log');

function appendLogFile(filePath: string, line: string) {
  void fs
    .mkdir(path.dirname(filePath), { recursive: true })
    .then(() => fs.appendFile(filePath, `${line}\n`, 'utf-8'))
    .catch(() => {});
}

export function logHttpEvent(params: {
  channel?: string;
  level?: LogLevel;
  method: string;
  path: string;
  message: string;
  meta?: Record<string, unknown>;
}) {
  const channel = params.channel || 'api';
  const level = params.level || 'info';
  if (!shouldLog(level)) return;
  const line = `[${channel}]${nowLabel()} [${params.method}]${params.path} ${levelLabel(level)}: ${params.message}${inlineMeta(params.meta)}`;
  // eslint-disable-next-line no-console
  console.log(line);
  appendLogFile(API_LOG_PATH, line);
}

export function logEvent(params: {
  channel?: string;
  level?: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}) {
  const channel = params.channel || 'api';
  const level = params.level || 'info';
  if (!shouldLog(level)) return;
  const line = `[${channel}]${nowLabel()} ${levelLabel(level)}: ${params.message}${inlineMeta(params.meta)}`;
  // eslint-disable-next-line no-console
  console.log(line);
  appendLogFile(API_LOG_PATH, line);
}

// LLM behavior is intentionally emitted as JSON for full-fidelity debugging.
export const llmLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { channel: 'llm' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Backward-compatible alias for existing imports.
export const logger = llmLogger;

export function appendSupervisorTrace(event: string, payload?: Record<string, unknown>) {
  const line = `[${new Date().toISOString()}] ${event}${payload ? ` ${JSON.stringify(payload)}` : ''}\n`;
  appendLogFile(TRACE_LOG_PATH, line.trimEnd());
}
