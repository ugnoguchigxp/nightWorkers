import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { users, threads, comments } from '../api/db/schema';
import { hashPassword } from '../api/lib/password';
import { config } from '../api/config';

async function main() {
  console.log('Seeding database...');
  const client = postgres(config.DATABASE_URL, { max: 1 });
  const db = drizzle(client);

  try {
    // Check if user already exists
    const [existing] = await db.select().from(users).limit(1);
    
    if (!existing) {
      const passwordHash = await hashPassword('password123');
      const [user] = await db.insert(users).values({
        email: 'test@example.com',
        name: 'Test User',
        passwordHash,
      }).returning();

      console.log('Created test user:', user.email);

      const [thread] = await db.insert(threads).values({
        title: 'Welcome to Hono Standard BBS',
        content: 'This is a sample thread to get you started.',
        authorId: user.id
      }).returning();

      console.log('Created sample thread');

      await db.insert(comments).values({
        threadId: thread.id,
        content: 'And this is a sample comment!',
        authorId: user.id
      });

      console.log('Created sample comment');
    } else {
      console.log('Database already has data. Skipping seed.');
    }
  } catch (err) {
    console.error('Error seeding DB:', err);
  } finally {
    await client.end();
  }
}

main();
