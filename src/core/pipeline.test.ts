import { describe, expect, setSystemTime, test } from 'bun:test';
import { arg, defineHandler, type ServiceMap } from './index.ts';
import { createLogger } from './internal/logger.ts';
import { Pipeline } from './internal/pipeline.ts';
import { InMemoryChannelMemory, MemoryStore } from './internal/store.ts';

function baseCtx(overrides: { dm?: boolean; authorId?: string } = {}) {
  return {
    input: {
      commandName: 'test',
      args: {},
      author: { id: overrides.authorId ?? 'user1', username: 'User' },
      channel: overrides.dm
        ? { id: 'channel1' }
        : { id: 'channel1', guildId: 'guild1' },
    },
    store: new MemoryStore(),
    memory: new InMemoryChannelMemory(),
    logger: createLogger('test', 'error'),
    services: {} as ServiceMap,
  };
}

const handler = defineHandler({
  name: 'test',
  description: 'тест',
  run: () => ({ kind: 'message', content: 'ok' }),
});

describe('Pipeline.checkPreconditions', () => {
  test('guildOnly: в ДМ отклоняет', async () => {
    const h = defineHandler({
      name: 'g',
      description: 'г',
      preconditions: [{ type: 'guildOnly' }],
      run: () => ({ kind: 'message', content: 'ok' }),
    });
    const pipeline = new Pipeline();
    const out = await pipeline.checkPreconditions(h, baseCtx({ dm: true }));
    expect(out.ok).toBe(false);
  });

  test('guildOnly: на сервере пропускает', async () => {
    const h = defineHandler({
      name: 'g',
      description: 'г',
      preconditions: [{ type: 'guildOnly' }],
      run: () => ({ kind: 'message', content: 'ok' }),
    });
    const pipeline = new Pipeline();
    const out = await pipeline.checkPreconditions(h, baseCtx());
    expect(out.ok).toBe(true);
  });

  test('permissions: не хватает прав', async () => {
    const h = defineHandler({
      name: 'p',
      description: 'п',
      preconditions: [{ type: 'permissions', permissions: ['Administrator'] }],
      run: () => ({ kind: 'message', content: 'ok' }),
    });
    const pipeline = new Pipeline();
    const out = await pipeline.checkPreconditions(h, baseCtx(), {
      memberPermissions: new Set(['KickMembers']),
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('Administrator');
  });

  test('ownerOnly: не владелец отклоняется', async () => {
    const h = defineHandler({
      name: 'o',
      description: 'о',
      preconditions: [{ type: 'ownerOnly' }],
      run: () => ({ kind: 'message', content: 'ok' }),
    });
    const pipeline = new Pipeline();
    const out = await pipeline.checkPreconditions(h, baseCtx({ authorId: 'stranger' }), {
      owners: ['owner1'],
    });
    expect(out.ok).toBe(false);
  });

  test('cooldown: детерминировано через setSystemTime', async () => {
    const h = defineHandler({
      name: 'c',
      description: 'к',
      preconditions: [{ type: 'cooldown', seconds: 60 }],
      run: () => ({ kind: 'message', content: 'ok' }),
    });
    const pipeline = new Pipeline();
    const now = Date.now();
    setSystemTime(new Date(now));
    expect((await pipeline.checkPreconditions(h, baseCtx())).ok).toBe(true);
    const second = await pipeline.checkPreconditions(h, baseCtx());
    expect(second.ok).toBe(false);
    setSystemTime(new Date(now + 61_000));
    const third = await pipeline.checkPreconditions(h, baseCtx());
    expect(third.ok).toBe(true);
    setSystemTime(new Date(now));
  });

  test('custom: кастомное предусловие', async () => {
    const h = defineHandler({
      name: 'x',
      description: 'x',
      preconditions: [{ type: 'custom', check: () => ({ ok: false, reason: 'заблокирован' }) }],
      run: () => ({ kind: 'message', content: 'ok' }),
    });
    const pipeline = new Pipeline();
    const out = await pipeline.checkPreconditions(h, baseCtx());
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('заблокирован');
  });
});

describe('Pipeline.missingCapabilities', () => {
  test('не хватает только EmbedLinks', () => {
    const h = defineHandler({
      name: 'e',
      description: 'э',
      capabilities: ['EmbedLinks', 'SendMessages'],
      run: () => ({ kind: 'message', content: 'ok' }),
    });
    const pipeline = new Pipeline();
    const missing = pipeline.missingCapabilities(h, new Set(['SendMessages']));
    expect(missing).toEqual(['EmbedLinks']);
  });
});

describe('Pipeline.run (parse args)', () => {
  test('дефолт применяется', async () => {
    const h = defineHandler({
      name: 'r',
      description: 'р',
      args: { dice: arg.string('формула').default('2d6') },
      run: ({ args }) => ({ kind: 'message', content: args.dice }),
    });
    const pipeline = new Pipeline();
    const result = await pipeline.run(h, { ...baseCtx(), input: { ...baseCtx().input, args: {} } });
    expect(result).toEqual({ kind: 'message', content: '2d6' });
  });

  test('переданное значение парсится', async () => {
    const h = defineHandler({
      name: 'n',
      description: 'н',
      args: { count: arg.integer('число') },
      run: ({ args }) => ({ kind: 'message', content: String(args.count) }),
    });
    const pipeline = new Pipeline();
    const result = await pipeline.run(h, {
      ...baseCtx(),
      input: { ...baseCtx().input, args: { count: 42 } },
    });
    expect(result).toEqual({ kind: 'message', content: '42' });
  });
});

describe('Handler', () => {
  test('description обязателен (тип); handler хранит метаданные', () => {
    expect(handler.name).toBe('test');
    expect(handler.description).toBe('тест');
    expect(handler.capabilities).toEqual([]);
    expect(handler.preconditions).toEqual([]);
  });
});
