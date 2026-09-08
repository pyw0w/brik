import { Database as BunSqlite } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Database, QueryValue, RunResult } from '../../database.ts';
import { SqliteCollection } from './collection.ts';

export interface SqliteEngineOptions {
  path?: string;
  wal?: boolean;
}

export class SqliteEngine implements Database {
  private readonly db: BunSqlite;
  private readonly collections = new Map<string, SqliteCollection<any>>();

  constructor(options: SqliteEngineOptions = {}) {
    const dbPath = options.path ?? '.data/bot.sqlite';
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new BunSqlite(dbPath);

    if (options.wal !== false && dbPath !== ':memory:') {
      this.db.run('PRAGMA journal_mode = WAL;');
    }
    this.db.run('PRAGMA foreign_keys = ON;');
    this.db.run('PRAGMA busy_timeout = 5000;');

    this.initSystemTables();
  }

  private initSystemTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS _kv_store (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (namespace, key)
      )
    `);
  }

  collection<T = Record<string, unknown>>(name: string): SqliteCollection<T> {
    const existing = this.collections.get(name);
    if (existing) return existing as SqliteCollection<T>;
    const col = new SqliteCollection<T>(this, '_root', name);
    this.collections.set(name, col);
    return col;
  }

  async query<T = unknown>(sql: string, params?: QueryValue[] | Record<string, QueryValue>): Promise<T[]> {
    const statement = this.db.query(sql);
    if (params === undefined) {
      return statement.all() as T[];
    }
    if (Array.isArray(params)) {
      return statement.all(...params) as T[];
    }
    return statement.all(params) as T[];
  }

  async queryOne<T = unknown>(sql: string, params?: QueryValue[] | Record<string, QueryValue>): Promise<T | null> {
    const statement = this.db.query(sql);
    let row: unknown;
    if (params === undefined) {
      row = statement.get();
    } else if (Array.isArray(params)) {
      row = statement.get(...params);
    } else {
      row = statement.get(params);
    }
    return (row ?? null) as T | null;
  }

  async run(sql: string, params?: QueryValue[] | Record<string, QueryValue>): Promise<RunResult> {
    const statement = this.db.query(sql);
    let res: { changes: number; lastInsertRowid: number | bigint };
    if (params === undefined) {
      res = statement.run();
    } else if (Array.isArray(params)) {
      res = statement.run(...params);
    } else {
      res = statement.run(params);
    }
    return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async transaction<R>(fn: (tx: Database) => Promise<R> | R): Promise<R> {
    const sp = `sp_${crypto.randomUUID().replace(/-/g, '')}`;
    this.db.run(`SAVEPOINT ${sp}`);
    try {
      const result = await fn(this);
      this.db.run(`RELEASE ${sp}`);
      return result;
    } catch (err) {
      this.db.run(`ROLLBACK TO ${sp}`);
      this.db.run(`RELEASE ${sp}`);
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}
