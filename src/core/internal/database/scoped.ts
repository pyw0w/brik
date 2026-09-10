import type { Collection, Database, QueryValue, RunResult } from '../../database.ts';
import { SqliteCollection } from './collection.ts';

/**
 * ScopedDatabase оборачивает Database для конкретного модуля или сервиса.
 * Автоматически изолирует коллекции в пространство имён модуля (`mod_<name>_*`).
 */
export class ScopedDatabase implements Database {
  private readonly collections = new Map<string, SqliteCollection<any>>();

  constructor(
    private readonly engine: Database,
    readonly namespace: string,
  ) {}

  collection<T = Record<string, unknown>>(name: string): Collection<T> {
    const existing = this.collections.get(name);
    if (existing) return existing as Collection<T>;
    const col = new SqliteCollection<T>(this, this.namespace, name);
    this.collections.set(name, col);
    return col;
  }

  query<T = unknown>(sql: string, params?: QueryValue[] | Record<string, QueryValue>): Promise<T[]> {
    return this.engine.query<T>(sql, params);
  }

  queryOne<T = unknown>(sql: string, params?: QueryValue[] | Record<string, QueryValue>): Promise<T | null> {
    return this.engine.queryOne<T>(sql, params);
  }

  run(sql: string, params?: QueryValue[] | Record<string, QueryValue>): Promise<RunResult> {
    return this.engine.run(sql, params);
  }

  exec(sql: string): Promise<void> {
    return this.engine.exec(sql);
  }

  async transaction<R>(fn: (tx: Database) => Promise<R> | R): Promise<R> {
    return this.engine.transaction(async (tx) => {
      return fn(new ScopedDatabase(tx, this.namespace));
    });
  }
}
