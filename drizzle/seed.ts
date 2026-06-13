import { users } from '../api/db/schema';
import { client, db } from '../api/db/client';
import { hashPassword } from '../api/lib/password';

async function main() {
  console.log('Seeding database...');

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
    } else {
      console.log('Database already has data. Skipping seed.');
    }
  } catch (err) {
    console.error('Error seeding DB:', err);
    process.exitCode = 1;
  } finally {
    client.close();
  }
}

main();
