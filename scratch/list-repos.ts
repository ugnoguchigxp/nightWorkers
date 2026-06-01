import { db } from '../api/db/client';
import { repositories } from '../api/db/schema';

async function list() {
  const list = await db.select().from(repositories);
  console.log("Current Registered Folders:", JSON.stringify(list, null, 2));
}

list();
