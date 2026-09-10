import { describe, expect, test } from 'bun:test';
import { defineHandler } from './handler.ts';
import { SqliteCollection } from './internal/database/collection.ts';
import { SqliteEngine } from './internal/database/engine.ts';
import { ScopedDatabase } from './internal/database/scoped.ts';
import { SqliteStore } from './internal/database/store.ts';
import { runHandler } from './testing.ts';

describe('SqliteEngine & SQL operations', () => {
  test('exec, run, query, queryOne', async () => {
    const db = new SqliteEngine({ path: ':memory:', wal: false });

    await db.exec(`
      CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price INTEGER NOT NULL
      );
    `);

    const insertRes = await db.run('INSERT INTO items (name, price) VALUES (?, ?)', ['Sword', 100]);
    expect(insertRes.changes).toBe(1);
    expect(Number(insertRes.lastInsertRowid)).toBe(1);

    await db.run('INSERT INTO items (name, price) VALUES (?, ?)', ['Shield', 50]);

    const all = await db.query<{ id: number; name: string; price: number }>(
      'SELECT * FROM items ORDER BY price DESC',
    );
    expect(all).toHaveLength(2);
    expect(all[0]?.name).toBe('Sword');
    expect(all[1]?.name).toBe('Shield');

    const one = await db.queryOne<{ name: string }>('SELECT name FROM items WHERE price = ?', [50]);
    expect(one?.name).toBe('Shield');

    const notFound = await db.queryOne('SELECT * FROM items WHERE price = ?', [9999]);
    expect(notFound).toBeNull();

    db.close();
  });

  test('transaction: rollback on error and nested savepoints', async () => {
    const db = new SqliteEngine({ path: ':memory:', wal: false });
    await db.exec('CREATE TABLE balances (user TEXT PRIMARY KEY, amount INT);');
    await db.run('INSERT INTO balances VALUES (?, ?)', ['u1', 100]);

    // Ошибка откатывает транзакцию
    await expect(
      db.transaction(async (tx) => {
        await tx.run('UPDATE balances SET amount = amount - 50 WHERE user = ?', ['u1']);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const balAfterFail = await db.queryOne<{ amount: number }>(
      'SELECT amount FROM balances WHERE user = ?',
      ['u1'],
    );
    expect(balAfterFail?.amount).toBe(100);

    // Успешная транзакция со вложенной
    await db.transaction(async (outerTx) => {
      await outerTx.run('UPDATE balances SET amount = 200 WHERE user = ?', ['u1']);
      try {
        await outerTx.transaction(async (innerTx) => {
          await innerTx.run('UPDATE balances SET amount = 300 WHERE user = ?', ['u1']);
          throw new Error('inner rollback');
        });
      } catch {
        // перехватываем внутреннюю ошибку
      }
      await outerTx.run('INSERT INTO balances VALUES (?, ?)', ['u2', 50]);
    });

    const finalU1 = await db.queryOne<{ amount: number }>(
      'SELECT amount FROM balances WHERE user = ?',
      ['u1'],
    );
    const finalU2 = await db.queryOne<{ amount: number }>(
      'SELECT amount FROM balances WHERE user = ?',
      ['u2'],
    );
    expect(finalU1?.amount).toBe(200);
    expect(finalU2?.amount).toBe(50);

    db.close();
  });
});

describe('Collection (Document API)', () => {
  interface UserDoc {
    id?: string;
    username: string;
    score: number;
    active: boolean;
    role?: string;
  }

  test('insert, find, findOne, count, update, delete, clear', async () => {
    const engine = new SqliteEngine({ path: ':memory:', wal: false });
    const col = new SqliteCollection<UserDoc>(engine, 'mod_test', 'users');

    expect(col.name).toBe('users');

    // insert
    const u1 = await col.insert({ username: 'Alice', score: 100, active: true, role: 'admin' });
    expect(u1.id).toBeDefined();
    expect(typeof u1.id).toBe('string');

    const u2 = await col.insert({
      id: 'custom-id',
      username: 'Bob',
      score: 50,
      active: false,
      role: 'member',
    });
    expect(u2.id).toBe('custom-id');

    // count
    expect(await col.count()).toBe(2);
    expect(await col.count({ active: true })).toBe(1);

    // find with equality
    const activeUsers = await col.find({ active: true });
    expect(activeUsers).toHaveLength(1);
    expect(activeUsers[0]?.username).toBe('Alice');

    // findOne
    const bob = await col.findOne({ id: 'custom-id' });
    expect(bob?.username).toBe('Bob');

    const missing = await col.findOne({ username: 'Charlie' });
    expect(missing).toBeNull();

    // update
    const updatedCount = await col.update({ id: 'custom-id' }, { score: 75, active: true });
    expect(updatedCount).toBe(1);

    const bobAfterUpdate = await col.findOne({ id: 'custom-id' });
    expect(bobAfterUpdate?.score).toBe(75);
    expect(bobAfterUpdate?.active).toBe(true);

    // delete
    const deletedCount = await col.delete({ id: 'custom-id' });
    expect(deletedCount).toBe(1);
    expect(await col.count()).toBe(1);

    // clear
    await col.clear();
    expect(await col.count()).toBe(0);

    engine.close();
  });

  test('insertMany in batch', async () => {
    const engine = new SqliteEngine({ path: ':memory:', wal: false });
    const col = new SqliteCollection<{ val: number }>(engine, 'mod_test', 'batch');

    const docs = await col.insertMany([{ val: 1 }, { val: 2 }, { val: 3 }]);
    expect(docs).toHaveLength(3);
    expect(await col.count()).toBe(3);

    engine.close();
  });

  test('operators: $gt, $gte, $lt, $lte, $ne, $in, $like', async () => {
    const engine = new SqliteEngine({ path: ':memory:', wal: false });
    const col = new SqliteCollection<UserDoc>(engine, 'mod_test', 'ops');

    await col.insertMany([
      { username: 'Alice', score: 100, active: true, role: 'admin' },
      { username: 'Bob', score: 80, active: true, role: 'mod' },
      { username: 'Charlie', score: 50, active: false, role: 'member' },
      { username: 'Dave', score: 20, active: false, role: 'guest' },
    ]);

    // $gt & $lt
    const mid = await col.find({ score: { $gt: 40, $lt: 90 } });
    expect(mid.map((m) => m.username)).toEqual(['Bob', 'Charlie']);

    // $gte & $lte
    const bounds = await col.find({ score: { $gte: 50, $lte: 80 } });
    expect(bounds.map((b) => b.username)).toEqual(['Bob', 'Charlie']);

    // $ne
    const notAdmin = await col.find({ role: { $ne: 'admin' } });
    expect(notAdmin).toHaveLength(3);

    // $in
    const staff = await col.find({ role: { $in: ['admin', 'mod'] } });
    expect(staff.map((s) => s.username)).toEqual(['Alice', 'Bob']);

    // $in с пустым массивом
    const emptyIn = await col.find({ role: { $in: [] } });
    expect(emptyIn).toHaveLength(0);

    // $like
    const aNames = await col.find({ username: { $like: '%li%' } });
    expect(aNames.map((n) => n.username)).toEqual(['Alice', 'Charlie']);

    engine.close();
  });

  test('sorting and pagination (orderBy, limit, offset)', async () => {
    const engine = new SqliteEngine({ path: ':memory:', wal: false });
    const col = new SqliteCollection<UserDoc>(engine, 'mod_test', 'page');

    await col.insertMany([
      { username: 'U1', score: 10, active: true },
      { username: 'U2', score: 50, active: true },
      { username: 'U3', score: 30, active: true },
      { username: 'U4', score: 90, active: true },
      { username: 'U5', score: 70, active: true },
    ]);

    // string orderBy
    const top2 = await col.find({}, { orderBy: 'score desc', limit: 2 });
    expect(top2.map((u) => u.score)).toEqual([90, 70]);

    // object orderBy & offset
    const page2 = await col.find({}, { orderBy: { score: 'desc' }, limit: 2, offset: 2 });
    expect(page2.map((u) => u.score)).toEqual([50, 30]);

    engine.close();
  });
});

describe('ScopedDatabase & isolation', () => {
  test('модули изолированы по таблицам коллекций', async () => {
    const engine = new SqliteEngine({ path: ':memory:', wal: false });

    const dbMod1 = new ScopedDatabase(engine, 'mod_first');
    const dbMod2 = new ScopedDatabase(engine, 'mod_second');

    const col1 = dbMod1.collection('items');
    const col2 = dbMod2.collection('items');

    await col1.insert({ title: 'Item from mod 1' });
    await col2.insert({ title: 'Item from mod 2' });

    expect(await col1.count()).toBe(1);
    expect(await col2.count()).toBe(1);

    const doc1 = (await col1.find())[0];
    const doc2 = (await col2.find())[0];

    expect(doc1?.title).toBe('Item from mod 1');
    expect(doc2?.title).toBe('Item from mod 2');

    // Кэш коллекций
    expect(dbMod1.collection('items')).toBe(col1);

    // query, queryOne, transaction
    await dbMod1.exec('CREATE TABLE test_scoped (id INT, name TEXT)');
    await dbMod1.run('INSERT INTO test_scoped VALUES (1, "alpha")');
    expect(await dbMod1.query('SELECT * FROM test_scoped')).toHaveLength(1);
    expect((await dbMod1.queryOne<{ name: string }>('SELECT name FROM test_scoped'))?.name).toBe('alpha');
    await dbMod1.transaction(async (tx) => {
      await tx.run('INSERT INTO test_scoped VALUES (2, "beta")');
    });
    expect(await dbMod1.query('SELECT * FROM test_scoped')).toHaveLength(2);

    engine.close();
  });
});

describe('SqliteStore (KV)', () => {
  test('get, set, has, delete, clear', async () => {
    const engine = new SqliteEngine({ path: ':memory:', wal: false });
    const storeA = new SqliteStore(engine, 'mod_a');
    const storeB = new SqliteStore(engine, 'mod_b');

    await storeA.set('key', { count: 42 });
    expect(await storeA.has('key')).toBe(true);
    expect(await storeB.has('key')).toBe(false);

    const val = await storeA.get<{ count: number }>('key');
    expect(val).toEqual({ count: 42 });

    await storeA.delete('key');
    expect(await storeA.has('key')).toBe(false);

    await storeA.set('k1', 'val1');
    await storeA.set('k2', 'val2');
    await storeA.clear();
    expect(await storeA.has('k1')).toBe(false);
    expect(await storeA.has('k2')).toBe(false);

    engine.close();
  });
});

describe('Handler with ctx.db', () => {
  test('хэндлер может писать и читать из ctx.db через runHandler', async () => {
    interface Note {
      id?: string;
      text: string;
      authorId: string;
    }

    const testHandler = defineHandler({
      name: 'addnote',
      description: 'Добавить заметку в базу',
      run: async ({ db, input }) => {
        const notes = db.collection<Note>('notes');
        await notes.insert({
          text: 'Заметка 1',
          authorId: input.author.id,
        });
        const count = await notes.count({ authorId: input.author.id });
        return { kind: 'message', content: `Заметок у вас: ${count}` };
      },
    });

    const result = await runHandler(testHandler);
    expect(result).toEqual({ kind: 'message', content: 'Заметок у вас: 1' });
  });
});
