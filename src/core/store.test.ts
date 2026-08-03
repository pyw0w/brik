import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore, InMemoryChannelMemory } from './internal/store.ts';

describe('FileStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-store-'));

  test('set/get/has/delete', async () => {
    const store = new FileStore('test', dir);
    await store.set('key', { a: 1 });
    expect(await store.has('key')).toBe(true);
    expect(await store.get<{ a: number }>('key')).toEqual({ a: 1 });
    await store.delete('key');
    expect(await store.has('key')).toBe(false);
  });

  test('персистентность: новый инстанс видит записанное', async () => {
    const a = new FileStore('persist', dir);
    await a.set('x', 5);
    const b = new FileStore('persist', dir);
    expect(await b.get<number>('x')).toBe(5);
  });

  test('разные модули не пересекаются', async () => {
    const a = new FileStore('one', dir);
    const b = new FileStore('two', dir);
    await a.set('k', 'A');
    expect(await b.has('k')).toBe(false);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('InMemoryChannelMemory', () => {
  test('память разделена по каналам', async () => {
    const memory = new InMemoryChannelMemory();
    await memory.set('c1', 'step', 'two');
    expect(await memory.get('c2', 'step')).toBeUndefined();
    expect(await memory.get('c1', 'step')).toBe('two');
    await memory.delete('c1', 'step');
    expect(await memory.get('c1', 'step')).toBeUndefined();
  });
});
