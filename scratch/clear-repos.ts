import { db } from '../api/db/client';
import { repositories } from '../api/db/schema';

async function clear() {
  const deleted = await db.delete(repositories).returning();
  console.log(`Successfully purged ${deleted.length} test folders from the database!`);
}

clear();
