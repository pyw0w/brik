export type QueryValue = string | number | boolean | null | bigint | Uint8Array;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export type FilterOperator<V> = {
  $eq?: V;
  $ne?: V;
  $gt?: V;
  $gte?: V;
  $lt?: V;
  $lte?: V;
  $in?: V[];
  $like?: string;
};

export type QueryFilter<T> = {
  [K in keyof T]?: T[K] | FilterOperator<T[K]>;
};

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string | Record<string, 'asc' | 'desc'>;
}

export interface Collection<T = Record<string, unknown>> {
  readonly name: string;
  insert(doc: T): Promise<T>;
  insertMany(docs: T[]): Promise<T[]>;
  find(filter?: QueryFilter<T>, options?: QueryOptions): Promise<T[]>;
  findOne(filter?: QueryFilter<T>): Promise<T | null>;
  update(filter: QueryFilter<T>, patch: Partial<T>): Promise<number>;
  delete(filter: QueryFilter<T>): Promise<number>;
  count(filter?: QueryFilter<T>): Promise<number>;
  clear(): Promise<void>;
}

export interface Database {
  /** Получить типизированную коллекцию документов модуля с автосозданием таблицы */
  collection<T = Record<string, unknown>>(name: string): Collection<T>;

  /** Выполнить SELECT-запрос и вернуть массив строк */
  query<T = unknown>(sql: string, params?: QueryValue[] | Record<string, QueryValue>): Promise<T[]>;

  /** Выполнить SELECT-запрос и вернуть первую найденную строку или null */
  queryOne<T = unknown>(sql: string, params?: QueryValue[] | Record<string, QueryValue>): Promise<T | null>;

  /** Выполнить параметризованную мутацию (INSERT, UPDATE, DELETE, DDL) */
  run(sql: string, params?: QueryValue[] | Record<string, QueryValue>): Promise<RunResult>;

  /** Выполнить одну или несколько SQL-инструкций без параметров (схемы, миграции) */
  exec(sql: string): Promise<void>;

  /** Выполнить серию операций в транзакции (поддерживает вложенные вызовы через SAVEPOINT) */
  transaction<R>(fn: (tx: Database) => Promise<R> | R): Promise<R>;
}
