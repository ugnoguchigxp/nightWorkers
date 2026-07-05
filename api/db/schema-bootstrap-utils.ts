import { client } from './client';

export async function ensureColumn(table: string, column: string, definition: string) {
  const columns = await client.execute(`PRAGMA table_info(${table})`);
  const exists = columns.rows.some((row) => row.name === column);
  if (columns.rows.length > 0 && !exists) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}
