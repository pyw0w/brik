import type { Database } from '../../database.ts';
import type { Store } from '../../types.ts';

/**
 * Персистентный KV-слой модуля на базе единой SQLite БД (_kv_store таблица).
 * Заменяет FileStore: атомарно, быстро, надежно при сбоях.
 */
export class SqliteStore implements Store {
  constructor(
    private readonly db: Database,
    private readonly namespace: string,
  ) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = await this.db.queryOne<{ value: string }>(
      'SELECT value FROM _kv_store WHERE namespace = ? AND key = ?',
      [this.namespace, key],
    );
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return row.value as unknown as T;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const serialized = JSON.stringify(value);
    await this.db.run(
      'INSERT INTO _kv_store (namespace, key, value) VALUES (?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value',
      [this.namespace, key, serialized],
    );
  }

  async delete(key: string): Promise<void> {
    await this.db.run('DELETE FROM _kv_store WHERE namespace = ? AND key = ?', [this.namespace, key]);
  }

  async has(key: string): Promise<boolean> {
    const row = await this.db.queryOne<{ '1': number }>(
      'SELECT 1 FROM _kv_store WHERE namespace = ? AND key = ? LIMIT 1',
      [this.namespace, key],
    );
    return row !== null;
  }

  async clear(): Promise<void> {
    await this.db.run('DELETE FROM _kv_store WHERE namespace = ?', [this.namespace]);
  }
}
