import { eq } from 'drizzle-orm';
import { type DbTransaction, db } from '../db/client';
import { users } from '../db/schema';

// We could infer types from schema but we'll re-export for ease
export type InsertUser = typeof users.$inferInsert;
export type SelectUser = typeof users.$inferSelect;

export const findById = async (id: string, tx?: DbTransaction): Promise<SelectUser | undefined> => {
  const d = tx || db;
  const [user] = await d.select().from(users).where(eq(users.id, id));
  return user;
};

export const findByEmail = async (
  email: string,
  tx?: DbTransaction
): Promise<SelectUser | undefined> => {
  const d = tx || db;
  const [user] = await d.select().from(users).where(eq(users.email, email));
  return user;
};

export const create = async (data: InsertUser, tx?: DbTransaction): Promise<SelectUser> => {
  const d = tx || db;
  const [user] = await d.insert(users).values(data).returning();
  return user;
};

export const update = async (
  id: string,
  data: Partial<InsertUser>,
  tx?: DbTransaction
): Promise<SelectUser | undefined> => {
  const d = tx || db;
  const [user] = await d.update(users).set(data).where(eq(users.id, id)).returning();
  return user;
};
