import { pgTable, text, integer, bigint } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  username: text('username').primaryKey(),
  uid: text('uid').unique(),
  salt: text('salt'),
  password_hash: text('password_hash'),
  role: text('role').notNull().default('user'),
  created_at: text('created_at').notNull(),
});

export const sessions = pgTable('sessions', {
  token_hash: text('token_hash').primaryKey(),
  username: text('username').notNull(),
  expires_at: bigint('expires_at', { mode: 'number' }).notNull(),
});

export const login_limits = pgTable('login_limits', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull().default(1),
  expires_at: bigint('expires_at', { mode: 'number' }).notNull(),
});

export const reports = pgTable('reports', {
  id: text('id').primaryKey(),
  report_no: text('report_no').notNull().unique(),
  data: text('data').notNull(),
  version: integer('version').notNull().default(1),
});
