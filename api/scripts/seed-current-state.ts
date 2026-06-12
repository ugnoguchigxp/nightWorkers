import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { ensureNightWorkersSchema } from '../db/bootstrap';
import { client } from '../db/client';

loadEnv({ quiet: true });

const SNAPSHOT_RELATIVE_PATH = 'drizzle/seeds/current-state.sql';
const RESET_TABLES = [
  'activity_artifacts',
  'activity_events',
  'artifacts',
  'background_processes',
  'blueprint_artifact_adoptions',
  'blueprint_db_design_adoptions',
  'blueprint_design_settings',
  'blueprint_design_token_adoptions',
  'conversation_context_snapshots',
  'design_questionnaire_answers',
  'design_questionnaire_question_sets',
  'design_questionnaire_reviews',
  'design_questionnaire_sessions',
  'implementation_queue_entries',
  'implementation_queue_settings',
  'llm_model_pricing',
  'llm_usage_records',
  'refresh_tokens',
  'task_events',
  'task_messages',
  'task_run_todos',
  'task_runs',
  'tasks',
  'todo_workflow_settings',
  'user_external_accounts',
  'users',
  'repositories',
] as const;

function resolveDatabasePath() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  if (
    databaseUrl.startsWith('libsql:') ||
    databaseUrl.startsWith('http:') ||
    databaseUrl.startsWith('https:')
  ) {
    throw new Error(
      `db:seed:current only supports local SQLite files. Received DATABASE_URL=${databaseUrl}`
    );
  }
  const rawPath = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl;
  return path.resolve(process.cwd(), rawPath);
}

function buildSeedSql() {
  const snapshotPath = path.resolve(process.cwd(), SNAPSHOT_RELATIVE_PATH);
  const snapshotSql = readFileSync(snapshotPath, 'utf8');
  const deleteSql = RESET_TABLES.map((table) => `DELETE FROM ${table};`).join('\n');
  return [
    '.timeout 10000',
    'PRAGMA foreign_keys=OFF;',
    'BEGIN;',
    deleteSql,
    snapshotSql,
    'COMMIT;',
    'PRAGMA foreign_keys=ON;',
    'PRAGMA foreign_key_check;',
  ].join('\n');
}

async function main() {
  const databasePath = resolveDatabasePath();
  await ensureNightWorkersSchema();
  await Promise.resolve(client.close());
  const sql = buildSeedSql();
  const output = execFileSync('sqlite3', [databasePath], {
    input: sql,
    encoding: 'utf8',
  }).trim();

  if (output.length > 0) {
    throw new Error(`Foreign key check failed:\n${output}`);
  }

  console.log(`Restored current DB snapshot into ${databasePath}`);
}

void main();
