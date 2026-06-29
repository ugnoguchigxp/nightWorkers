import { type Client, createClient, type Transaction } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { config } from '../config';
import * as designQuestionnaireSchema from './design-questionnaire-schema';
import * as projectEvaluationSchema from './project-evaluation-schema';
import { withSqliteBusyRetry } from './retry';
import * as baseSchema from './schema';

type StatementLike = string | { sql?: string } | [string, unknown?];

const READ_ONLY_SQL_PREFIXES = ['select', 'pragma', 'explain'] as const;

function createWriteSerialGate() {
  let tail = Promise.resolve();

  return {
    async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    },
    async acquire() {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
      };
    },
  };
}

function statementSql(statement: StatementLike | undefined): string | null {
  if (!statement) return null;
  if (typeof statement === 'string') return statement;
  if (Array.isArray(statement)) return typeof statement[0] === 'string' ? statement[0] : null;
  return typeof statement.sql === 'string' ? statement.sql : null;
}

function isReadOnlyPragma(sqlText: string) {
  return /^\s*pragma\b(?![^;]*=)/i.test(sqlText);
}

function isWriteStatement(statement: StatementLike | undefined) {
  const sqlText = statementSql(statement);
  if (!sqlText) return true;
  const normalized = sqlText.trim().toLowerCase();
  if (!normalized) return true;
  if (isReadOnlyPragma(normalized)) return false;
  return !READ_ONLY_SQL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function batchContainsWrite(statements: unknown[]) {
  return statements.some((statement) => isWriteStatement(statement as StatementLike));
}

function wrapTransactionWithBusyRetry(
  transaction: Transaction,
  releaseWriteLock: () => void
): Transaction {
  return new Proxy(transaction, {
    get(target, prop, receiver) {
      if (prop === 'execute' || prop === 'batch' || prop === 'executeMultiple') {
        return (...args: unknown[]) =>
          withSqliteBusyRetry(() =>
            Reflect.apply(target[prop as 'execute' | 'batch' | 'executeMultiple'], target, args)
          );
      }
      if (prop === 'commit' || prop === 'rollback') {
        return async () => {
          try {
            return await withSqliteBusyRetry(() =>
              Reflect.apply(target[prop as 'commit' | 'rollback'], target, [])
            );
          } finally {
            releaseWriteLock();
          }
        };
      }
      if (prop === 'close') {
        return () => {
          try {
            return Reflect.apply(target.close, target, []);
          } finally {
            releaseWriteLock();
          }
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function wrapClientWithBusyRetry(baseClient: Client): Client {
  const writeGate = createWriteSerialGate();

  return new Proxy(baseClient, {
    get(target, prop, receiver) {
      if (
        prop === 'execute' ||
        prop === 'batch' ||
        prop === 'migrate' ||
        prop === 'executeMultiple'
      ) {
        return (...args: unknown[]) => {
          const operation = () =>
            withSqliteBusyRetry(() =>
              Reflect.apply(
                target[prop as 'execute' | 'batch' | 'migrate' | 'executeMultiple'],
                target,
                args
              )
            );
          const shouldSerialize =
            prop === 'execute'
              ? isWriteStatement(args[0] as StatementLike)
              : prop === 'batch' || prop === 'migrate'
                ? batchContainsWrite((args[0] as unknown[]) ?? [])
                : true;
          return shouldSerialize ? writeGate.runExclusive(operation) : operation();
        };
      }
      if (prop === 'transaction') {
        return async (...args: unknown[]) => {
          const releaseWriteLock = await writeGate.acquire();
          try {
            const transaction = (await withSqliteBusyRetry(() =>
              Reflect.apply(target.transaction, target, args)
            )) as Transaction;
            return wrapTransactionWithBusyRetry(transaction, releaseWriteLock);
          } catch (error) {
            releaseWriteLock();
            throw error;
          }
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export const client = wrapClientWithBusyRetry(
  createClient({
    url: config.DATABASE_URL.startsWith('file:')
      ? config.DATABASE_URL
      : `file:${config.DATABASE_URL}`,
  })
);

export const db = drizzle(client, {
  schema: { ...baseSchema, ...designQuestionnaireSchema, ...projectEvaluationSchema },
});

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
