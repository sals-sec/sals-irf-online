import { db } from './index.ts';
import { users } from './schema.ts';

export async function getOrCreateUser(uid: string, email: string) {
  const username = (email ? email.split('@')[0] : uid).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const result = await db.insert(users)
    .values({
      username,
      uid,
      role: 'user',
      created_at: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: {
        created_at: new Date().toISOString(),
      },
    })
    .returning();

  return result[0];
}
