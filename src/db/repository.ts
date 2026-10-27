import { db } from './index.ts';
import { users, sessions, login_limits, reports } from './schema.ts';
import { eq, desc, and, sql, lt, gt } from 'drizzle-orm';

// Query Layer for Reports
export async function getReports() {
  try {
    const rows = await db
      .select({
        id: reports.id,
        report_no: reports.report_no,
        data: reports.data,
        version: reports.version,
      })
      .from(reports)
      .orderBy(desc(sql`CAST(${reports.report_no} AS INTEGER)`));
    return rows;
  } catch (error) {
    console.error('Database query getReports failed:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function getReportById(id: string) {
  try {
    const rows = await db
      .select({
        id: reports.id,
        report_no: reports.report_no,
        data: reports.data,
        version: reports.version,
      })
      .from(reports)
      .where(eq(reports.id, id))
      .limit(1);
    return rows[0] || null;
  } catch (error) {
    console.error('Database query getReportById failed:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function insertReport(row: { id: string; report_no: string; data: string; version?: number }) {
  try {
    const [created] = await db
      .insert(reports)
      .values({
        id: row.id,
        report_no: row.report_no,
        data: row.data,
        version: row.version ?? 1,
      })
      .returning();
    return created;
  } catch (error) {
    console.error('Database insertReport failed:', error);
    throw new Error('Failed to create report.', { cause: error });
  }
}

export async function updateReport(id: string, currentVersion: number, update: { report_no: string; data: string }) {
  try {
    const updated = await db
      .update(reports)
      .set({
        report_no: update.report_no,
        data: update.data,
        version: sql`${reports.version} + 1`,
      })
      .where(and(eq(reports.id, id), eq(reports.version, currentVersion)))
      .returning();
    return updated.length > 0;
  } catch (error) {
    console.error('Database updateReport failed:', error);
    throw new Error('Failed to update report.', { cause: error });
  }
}

export async function deleteReportByIdAndVersion(id: string, version: number) {
  try {
    const deleted = await db
      .delete(reports)
      .where(and(eq(reports.id, id), eq(reports.version, version)))
      .returning();
    return deleted.length > 0;
  } catch (error) {
    console.error('Database deleteReportByIdAndVersion failed:', error);
    throw new Error('Failed to delete report.', { cause: error });
  }
}

export async function deleteAllReportsWithCount(expectedCount: number) {
  try {
    const countRows = await db.select({ count: sql<number>`count(*)` }).from(reports);
    const count = Number(countRows[0]?.count || 0);
    if (count !== expectedCount) {
      return { success: false, changes: 0 };
    }
    const deleted = await db.delete(reports).returning();
    return { success: true, changes: deleted.length };
  } catch (error) {
    console.error('Database deleteAllReportsWithCount failed:', error);
    throw new Error('Failed to delete all reports.', { cause: error });
  }
}

export async function upsertReportRecord(row: { id: string; report_no: string; data: string; version?: number }) {
  try {
    const [res] = await db
      .insert(reports)
      .values({
        id: row.id,
        report_no: row.report_no,
        data: row.data,
        version: row.version ?? 1,
      })
      .onConflictDoUpdate({
        target: reports.report_no,
        set: {
          data: row.data,
          version: sql`${reports.version} + 1`,
        },
      })
      .returning();
    return res;
  } catch (error) {
    console.error('Database upsertReportRecord failed:', error);
    throw new Error('Failed to restore report record.', { cause: error });
  }
}

// Query Layer for Users & Sessions
export async function getUsers() {
  try {
    return await db
      .select({
        username: users.username,
        role: users.role,
        created_at: users.created_at,
      })
      .from(users)
      .orderBy(users.username);
  } catch (error) {
    console.error('Database getUsers failed:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function getUsersBackup() {
  try {
    return await db
      .select({
        username: users.username,
        salt: users.salt,
        password_hash: users.password_hash,
        role: users.role,
        created_at: users.created_at,
      })
      .from(users)
      .orderBy(users.username);
  } catch (error) {
    console.error('Database getUsersBackup failed:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function getUserByUsername(username: string) {
  try {
    const rows = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return rows[0] || null;
  } catch (error) {
    console.error('Database getUserByUsername failed:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function insertUser(userData: {
  username: string;
  salt: string;
  password_hash: string;
  role: string;
  created_at: string;
  uid?: string;
}) {
  try {
    const [created] = await db.insert(users).values(userData).returning();
    return created;
  } catch (error) {
    console.error('Database insertUser failed:', error);
    throw new Error('Failed to create user.', { cause: error });
  }
}

export async function upsertUserRecord(userData: {
  username: string;
  salt: string;
  password_hash: string;
  role: string;
  created_at: string;
}) {
  try {
    const [res] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.username,
        set: {
          salt: userData.salt,
          password_hash: userData.password_hash,
          role: userData.role,
        },
      })
      .returning();
    return res;
  } catch (error) {
    console.error('Database upsertUserRecord failed:', error);
    throw new Error('Failed to upsert user.', { cause: error });
  }
}

export async function deleteUserAccount(username: string) {
  try {
    await db.delete(sessions).where(eq(sessions.username, username));
    const deleted = await db
      .delete(users)
      .where(and(eq(users.username, username), sql`${users.role} IN ('user', 'viewer')`))
      .returning();
    return deleted.length > 0;
  } catch (error) {
    console.error('Database deleteUserAccount failed:', error);
    throw new Error('Failed to delete user account.', { cause: error });
  }
}

export async function createSessionRecord(token_hash: string, username: string, expires_at: number) {
  try {
    await db.insert(sessions).values({ token_hash, username, expires_at });
  } catch (error) {
    console.error('Database createSessionRecord failed:', error);
    throw new Error('Failed to create session.', { cause: error });
  }
}

export async function getSessionUser(token_hash: string, now: number) {
  try {
    const rows = await db
      .select({
        username: users.username,
        role: users.role,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.username, users.username))
      .where(and(eq(sessions.token_hash, token_hash), gt(sessions.expires_at, now)))
      .limit(1);
    return rows[0] || null;
  } catch (error) {
    console.error('Database getSessionUser failed:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}

export async function deleteSessionRecord(token_hash: string) {
  try {
    await db.delete(sessions).where(eq(sessions.token_hash, token_hash));
  } catch (error) {
    console.error('Database deleteSessionRecord failed:', error);
    throw new Error('Failed to delete session.', { cause: error });
  }
}

export async function cleanExpiredSessions(now: number) {
  try {
    await db.delete(sessions).where(lt(sessions.expires_at, now));
  } catch (error) {
    console.error('Database cleanExpiredSessions failed:', error);
  }
}

export async function checkAndIncrementLogin(key: string, now: number, windowMs: number) {
  try {
    await db.delete(login_limits).where(lt(login_limits.expires_at, now));
    const expiresAt = now + windowMs;
    const [row] = await db
      .insert(login_limits)
      .values({ key, attempts: 1, expires_at: expiresAt })
      .onConflictDoUpdate({
        target: login_limits.key,
        set: {
          attempts: sql`${login_limits.attempts} + 1`,
        },
      })
      .returning({ attempts: login_limits.attempts });
    return row?.attempts ?? 1;
  } catch (error) {
    console.error('Database checkAndIncrementLogin failed:', error);
    throw new Error('Failed to process login limit.', { cause: error });
  }
}
