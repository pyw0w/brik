import { Database as BunSqlite } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Database, QueryValue, RunResult } from '../../database.ts';
import { SqliteCollection } from './collection.ts';

export interface SqliteEngineOptions {
  path?: string;
  wal?: boolean;
}

/**
 * Асинхронный мьютекс на цепочке Promise.
 * Гарантирует последовательное выполнение транзакций и мутаций в SQLite,
 * предотвращая чередование параллельных операций внутри открытых savepoint.
 */
class AsyncLock {
  private queue: Promise<void> = Promise.resolve();

  acquire(): Promise<() => void> {
    let release: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = this.queue;
    this.queue = this.queue.then(() => next);
    return current.then(() => release);
  }
}

export class SqliteEngine implements Database {
  private readonly db: BunSqlite;
  private readonly collections = new Map<string, SqliteCollection<any>>();
  private readonly lock = new AsyncLock();

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
      CREATE TABLE IF NOT EXISTS _kv_store (\n        namespace TEXT NOT NULL,\n        key TEXT NOT NULL,\n        value TEXT NOT NULL,\n        PRIMARY KEY (namespace, key)\n      )\n    `);
  }

  collection<T = Record<string, unknown>>(name: string): SqliteCollection<T> {
    const existing = this.collections.get(name);
    if (existing) return existing as SqliteCollection<T>;
    const col = new SqliteCollection<T>(this, '_root', name);
    this.collections.set(name, col);
    return col;
  }

  // ===== Прямые вызовы к SQLite (выполняются под уже захваченным lock) =====

  private directQuery<T = unknown>(sql: string, params?: QueryValue[] | Record<string, QueryValue>): T[] {
    const statement = this.db.query(sql);
    if (params === undefined) {
      return statement.all() as T[];
    }
    if (Array.isArray(params)) {
      return statement.all(...params) as T[];
    }
    return statement.all(params) as T[];
  }

  private directQueryOne<T = unknown>(sql: string, params?: QueryValue[] | Record<string, QueryValue>): T | null {
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

  private directRun(sql: string, params?: QueryValue[] | Record<string, QueryValue>): RunResult {
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

  private directExec(sql: string): void {
    this.db.exec(sql);
  }

  // ===== Публичный интерфейс с захватом мьютекса соединения =====

  async query<T = unknown>(sql: string, params?: QueryValue[] | Record<string, QueryValue>): Promise<T[]> {
    const release = await this.lock.acquire();
    try {
      return this.directQuery<T>(sql, params);
    } finally {
      release();
    }
  }

  async queryOne<T = unknown>(sql: string, params?: QueryValue[] | Record<string, QueryValue>): Promise<T | null> {
    const release = await this.lock.acquire();
    try {
      return this.directQueryOne<T>(sql, params);
    } finally {
      release();
    }
  }

  async run(sql: string, params?: QueryValue[] | Record<string, QueryValue>): Promise<RunResult> {
    const release = await this.lock.acquire();
    try {
      return this.directRun(sql, params);
    } finally {
      release();
    }
  }

  async exec(sql: string): Promise<void> {
    const release = await this.lock.acquire();
    try {
      this.directExec(sql);
    } finally {
      release();
    }
  }

  async transaction<R>(fn: (tx: Database) => Promise<R> | R): Promise<R> {
    const release = await this.lock.acquire();
    try {
      return await this.runTransactionWithinLock(fn);
    } finally {
      release();
    }
  }

  private async runTransactionWithinLock<R>(fn: (tx: Database) => Promise<R> | R): Promise<R> {
    const sp = `sp_${crypto.randomUUID().replace(/-/g, '')}`;
    this.directRun(`SAVEPOINT ${sp}`);

    const txDb: Database = {
      collection: <T = Record<string, unknown>>(name: string) => {
        return new SqliteCollection<T>(txDb, '_root', name);
      },
      query: async <T = unknown>(sql: string, params?: QueryValue[] | Record<string, QueryValue>) => {
        return this.directQuery<T>(sql, params);
      },
      queryOne: async <T = unknown>(sql: string, params?: QueryValue[] | Record<string, QueryValue>) => {
        return this.directQueryOne<T>(sql, params);
      },
      run: async (sql: string, params?: QueryValue[] | Record<string, QueryValue>) => {
        return this.directRun(sql, params);
      },
      exec: async (sql: string) => {
        this.directExec(sql);
      },
      transaction: async <SubR>(subFn: (subTx: Database) => Promise<SubR> | SubR) => {
        return this.runTransactionWithinLock(subFn);
      },
    };

    try {
      const result = await fn(txDb);
      this.directRun(`RELEASE ${sp}`);
      return result;
    } catch (err) {
      this.directRun(`ROLLBACK TO ${sp}`);
      this.directRun(`RELEASE ${sp}`);
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}
