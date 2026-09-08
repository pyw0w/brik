import type { Collection, QueryFilter, QueryOptions, QueryValue } from '../../database.ts';
import type { SqliteEngine } from './engine.ts';

export class SqliteCollection<T = Record<string, unknown>>
  implements Collection<T>
{
  readonly tableName: string;
  private tableReady = false;

  constructor(
    private readonly engine: SqliteEngine,
    readonly namespace: string,
    readonly name: string,
  ) {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      throw new Error(`Недопустимое имя коллекции: "${name}". Разрешены только буквы, цифры и символ подчеркивания.`);
    }
    const cleanNamespace = namespace.replace(/[^a-zA-Z0-9_]/g, '_');
    this.tableName = `_col_${cleanNamespace}_${name}`;
  }

  private ensureTable(): void {
    if (this.tableReady) return;
    this.engine.exec(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.tableReady = true;
  }

  async insert(doc: T): Promise<T> {
    this.ensureTable();
    const docObj = doc as Record<string, unknown>;
    const id = typeof docObj.id === 'string' && docObj.id ? docObj.id : crypto.randomUUID();
    const fullDoc = { ...docObj, id } as unknown as T;
    const now = Date.now();
    await this.engine.run(
      `INSERT INTO "${this.tableName}" (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      [id, JSON.stringify(fullDoc), now, now],
    );
    return fullDoc;
  }

  async insertMany(docs: T[]): Promise<T[]> {
    this.ensureTable();
    return this.engine.transaction(async () => {
      const results: T[] = [];
      for (const doc of docs) {
        results.push(await this.insert(doc));
      }
      return results;
    });
  }

  async find(filter?: QueryFilter<T>, options?: QueryOptions): Promise<T[]> {
    this.ensureTable();
    const { whereSql, params } = this.buildWhere(filter);
    let sql = `SELECT data FROM "${this.tableName}"${whereSql}`;

    if (options?.orderBy) {
      sql += this.buildOrderBy(options.orderBy);
    }
    if (options?.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(options.limit);
      if (options.offset !== undefined) {
        sql += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    const rows = await this.engine.query<{ data: string }>(sql, params);
    return rows.map((r) => JSON.parse(r.data) as T);
  }

  async findOne(filter?: QueryFilter<T>): Promise<T | null> {
    const list = await this.find(filter, { limit: 1 });
    return list[0] ?? null;
  }

  async update(filter: QueryFilter<T>, patch: Partial<T>): Promise<number> {
    this.ensureTable();
    const { whereSql, params } = this.buildWhere(filter);
    const now = Date.now();
    const patchJson = JSON.stringify(patch);
    const sql = `UPDATE "${this.tableName}" SET data = json_patch(data, ?), updated_at = ?${whereSql}`;
    const res = await this.engine.run(sql, [patchJson, now, ...params]);
    return res.changes;
  }

  async delete(filter: QueryFilter<T>): Promise<number> {
    this.ensureTable();
    const { whereSql, params } = this.buildWhere(filter);
    const sql = `DELETE FROM "${this.tableName}"${whereSql}`;
    const res = await this.engine.run(sql, params);
    return res.changes;
  }

  async count(filter?: QueryFilter<T>): Promise<number> {
    this.ensureTable();
    const { whereSql, params } = this.buildWhere(filter);
    const sql = `SELECT COUNT(*) as count FROM "${this.tableName}"${whereSql}`;
    const row = await this.engine.queryOne<{ count: number }>(sql, params);
    return row ? Number(row.count) : 0;
  }

  async clear(): Promise<void> {
    this.ensureTable();
    await this.engine.run(`DELETE FROM "${this.tableName}"`);
  }

  private buildWhere(filter?: QueryFilter<T>): { whereSql: string; params: QueryValue[] } {
    if (!filter || Object.keys(filter).length === 0) {
      return { whereSql: '', params: [] };
    }

    const clauses: string[] = [];
    const params: QueryValue[] = [];

    for (const [key, cond] of Object.entries(filter)) {
      if (!/^[a-zA-Z0-9_]+$/.test(key)) {
        throw new Error(`Недопустимое поле фильтра: "${key}"`);
      }

      const target = key === 'id' ? 'id' : `json_extract(data, '$.${key}')`;
      const isOp =
        cond !== null &&
        typeof cond === 'object' &&
        !Array.isArray(cond) &&
        Object.keys(cond).some((k) => k.startsWith('$'));

      if (!isOp) {
        if (cond === null) {
          clauses.push(`${target} IS NULL`);
        } else {
          clauses.push(`${target} = ?`);
          params.push(this.normalizeValue(cond));
        }
      } else {
        const ops = cond as Record<string, unknown>;
        for (const [op, val] of Object.entries(ops)) {
          switch (op) {
            case '$eq':
              if (val === null) {
                clauses.push(`${target} IS NULL`);
              } else {
                clauses.push(`${target} = ?`);
                params.push(this.normalizeValue(val));
              }
              break;
            case '$ne':
              if (val === null) {
                clauses.push(`${target} IS NOT NULL`);
              } else {
                clauses.push(`${target} != ?`);
                params.push(this.normalizeValue(val));
              }
              break;
            case '$gt':
              clauses.push(`${target} > ?`);
              params.push(this.normalizeValue(val));
              break;
            case '$gte':
              clauses.push(`${target} >= ?`);
              params.push(this.normalizeValue(val));
              break;
            case '$lt':
              clauses.push(`${target} < ?`);
              params.push(this.normalizeValue(val));
              break;
            case '$lte':
              clauses.push(`${target} <= ?`);
              params.push(this.normalizeValue(val));
              break;
            case '$like':
              clauses.push(`${target} LIKE ?`);
              params.push(String(val));
              break;
            case '$in': {
              const arr = Array.isArray(val) ? val : [];
              if (arr.length === 0) {
                clauses.push('1 = 0');
              } else {
                const placeholders = arr.map(() => '?').join(', ');
                clauses.push(`${target} IN (${placeholders})`);
                for (const v of arr) {
                  params.push(this.normalizeValue(v));
                }
              }
              break;
            }
            default:
              throw new Error(`Неизвестный оператор фильтра: "${op}"`);
          }
        }
      }
    }

    return {
      whereSql: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  private buildOrderBy(orderBy: string | Record<string, 'asc' | 'desc'>): string {
    if (typeof orderBy === 'string') {
      const parts = orderBy.trim().split(/\s+/);
      const field = parts[0];
      const dir = parts[1]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      if (!field || !/^[a-zA-Z0-9_]+$/.test(field)) {
        throw new Error(`Недопустимое поле сортировки: "${field}"`);
      }
      const target = field === 'id' ? 'id' : `json_extract(data, '$.${field}')`;
      return ` ORDER BY ${target} ${dir}`;
    }

    const entries = Object.entries(orderBy);
    if (entries.length === 0) return '';

    const clauses = entries.map(([field, dir]) => {
      if (!/^[a-zA-Z0-9_]+$/.test(field)) {
        throw new Error(`Недопустимое поле сортировки: "${field}"`);
      }
      const target = field === 'id' ? 'id' : `json_extract(data, '$.${field}')`;
      const direction = String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      return `${target} ${direction}`;
    });

    return ` ORDER BY ${clauses.join(', ')}`;
  }

  private normalizeValue(val: unknown): QueryValue {
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (val === null || val === undefined) return null;
    if (typeof val === 'number' || typeof val === 'string' || typeof val === 'bigint') return val;
    if (val instanceof Uint8Array) return val;
    return JSON.stringify(val);
  }
}
