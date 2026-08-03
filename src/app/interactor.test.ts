import { describe, expect, test } from 'bun:test';
import type { InteractionEnv } from '../core/discord/adapter.ts';
import { arg, defineHandler, defineModule, type ServiceMap } from '../core/index.ts';
import { createLogger } from '../core/internal/logger.ts';
import { Pipeline } from '../core/internal/pipeline.ts';
import { Registry } from '../core/internal/registry.ts';
import { InMemoryChannelMemory, MemoryStore } from '../core/internal/store.ts';
import { createInput } from '../core/testing.ts';
import { InteractionInteractor, withCustomIds } from './interactor.ts';

const logger = createLogger('test', 'error');

function makeInteractor() {
  const registry = new Registry();
  registry.register(defineModule({
    name: 'demo',
    description: 'Демо',
    handlers: [
      defineHandler({
        name: 'demo',
        description: 'Демо-команда',
        args: { n: arg.integer('число').default(1) },
        preconditions: [{ type: 'guildOnly' }],
        capabilities: ['EmbedLinks'],
        run: ({ args }) => ({ kind: 'message', content: `n=${args.n}` }),
      }),
    ],
  }));
  const stores = new Map<string, MemoryStore>();
  stores.set('demo', new MemoryStore());
  const interactor = new InteractionInteractor({
    registry,
    pipeline: new Pipeline(),
    memory: new InMemoryChannelMemory(),
    logger,
    storeFor: (name) => stores.get(name),
    servicesFor: () => ({}) as ServiceMap,
  });
  return interactor;
}

const fullGrant = { preconditions: {}, granted: new Set(['EmbedLinks'] as const) } satisfies InteractionEnv;

describe('InteractionInteractor', () => {
  test('выполняет команду с аргументами', async () => {
    const result = await makeInteractor().handle(
      createInput({ commandName: 'demo', args: { n: 7 } }),
      fullGrant,
    );
    expect(result).toEqual({ kind: 'message', content: 'n=7' });
  });

  test('применяет дефолт аргумента', async () => {
    const result = await makeInteractor().handle(createInput({ commandName: 'demo' }), fullGrant);
    expect(result).toEqual({ kind: 'message', content: 'n=1' });
  });

  test('неизвестная команда → undefined (молчать)', async () => {
    const result = await makeInteractor().handle(createInput({ commandName: 'nope' }), fullGrant);
    expect(result).toBeUndefined();
  });

  test('guildOnly в ДМ → понятное сообщение', async () => {
    const result = await makeInteractor().handle(
      createInput({ commandName: 'demo', channel: { id: 'dm' } }),
      { preconditions: {}, granted: new Set(['EmbedLinks'] as const) },
    );
    expect(result).toMatchObject({ kind: 'message', ephemeral: true });
    if (result && result.kind === 'message') {
      expect(result.content).toContain('только на сервере');
    }
  });

  test('не хватает Capability → сообщение о правах', async () => {
    const result = await makeInteractor().handle(createInput({ commandName: 'demo' }), {
      preconditions: {},
      granted: new Set<never>(),
    });
    expect(result).toMatchObject({ kind: 'message', ephemeral: true });
    if (result && result.kind === 'message') {
      expect(result.content).toContain('нет прав');
    }
  });

  test('ошибка в run → сообщение об ошибке', async () => {
    const registry = new Registry();
    registry.register(defineModule({
      name: 'boom',
      handlers: [
        defineHandler({
          name: 'boom',
          description: 'падает',
          run: () => { throw new Error('взрыв'); },
        }),
      ],
    }));
    const stores = new Map<string, MemoryStore>();
    stores.set('boom', new MemoryStore());
    const interactor = new InteractionInteractor({
      registry,
      pipeline: new Pipeline(),
      memory: new InMemoryChannelMemory(),
      logger,
      storeFor: (name) => stores.get(name),
    servicesFor: () => ({}) as ServiceMap,
    });
    const result = await interactor.handle(createInput({ commandName: 'boom' }), fullGrant);
    expect(result).toMatchObject({ kind: 'message', ephemeral: true });
    if (result && result.kind === 'message') {
      expect(result.content).toContain('Произошла ошибка');
    }
  });

  test('нет store у модуля → undefined', async () => {
    const registry = new Registry();
    registry.register(defineModule({
      name: 'nostore',
      handlers: [defineHandler({ name: 'nostore', description: 'x', run: () => ({ kind: 'message', content: 'x' }) })],
    }));
    const interactor = new InteractionInteractor({
      registry,
      pipeline: new Pipeline(),
      memory: new InMemoryChannelMemory(),
      logger,
      storeFor: () => undefined,
      servicesFor: () => ({}) as ServiceMap,
    });
    const result = await interactor.handle(createInput({ commandName: 'nostore' }), fullGrant);
    expect(result).toBeUndefined();
  });
});

describe('InteractionInteractor.handleComponent', () => {
  function makeButtonInteractor() {
    const registry = new Registry();
    registry.register(defineModule({
      name: 'buttons',
      description: 'Демо кнопок',
      handlers: [
        defineHandler({
          name: 'counter',
          description: 'Счётчик',
          components: [
            {
              id: 'step',
              capabilities: ['EmbedLinks'],
              run: ({ payload, input }) =>
                ({ kind: 'message', content: `шаг ${payload} от ${input.author.id}` }),
            },
            {
              id: 'reset',
              preconditions: [{ type: 'ownerOnly' }],
              run: () => ({ kind: 'update', result: { kind: 'message', content: 'сброшен' } }),
            },
            {
              id: 'menu',
              run: () => ({
                kind: 'component',
                content: 'меню',
                rows: [{ buttons: [{ id: 'step:2', label: 'шаг' }] }],
              }),
            },
          ],
          run: () => ({ kind: 'message', content: 'ok' }),
        }),
      ],
    }));
    const stores = new Map<string, MemoryStore>();
    stores.set('buttons', new MemoryStore());
    const interactor = new InteractionInteractor({
      registry,
      pipeline: new Pipeline(),
      memory: new InMemoryChannelMemory(),
      logger,
      storeFor: (name) => stores.get(name),
      servicesFor: () => ({}) as ServiceMap,
    });
    return interactor;
  }

  const click = (customId: string) => ({ customId, author: { id: 'user1', username: 'User' }, channel: { id: 'c1', guildId: 'g1' } });

  test('выполняет component-хэндлер с payload', async () => {
    const result = await makeButtonInteractor().handleComponent(click('counter:step:7'), {
      preconditions: {},
      granted: new Set(['EmbedLinks']),
    });
    expect(result).toEqual({ kind: 'message', content: 'шаг 7 от user1' });
  });

  test('неизвестный customId → undefined', async () => {
    const result = await makeButtonInteractor().handleComponent(click('nope:id'), fullGrant);
    expect(result).toBeUndefined();
  });

  test('не хватает Capability → сообщение о правах', async () => {
    const result = await makeButtonInteractor().handleComponent(click('counter:step'), {
      preconditions: {},
      granted: new Set<never>(),
    });
    expect(result).toMatchObject({ kind: 'message', ephemeral: true });
    if (result?.kind === 'message') expect(result.content).toContain('нет прав');
  });

  test('ownerOnly от не-владельца → отклонено', async () => {
    const result = await makeButtonInteractor().handleComponent(click('counter:reset'), {
      preconditions: { owners: ['owner1'] },
      granted: new Set([]),
    });
    expect(result).toMatchObject({ kind: 'message', ephemeral: true });
    if (result?.kind === 'message') expect(result.content).toContain('Только владелец');
  });

  test('component-Result наследует проставляет customId', async () => {
    const result = await makeButtonInteractor().handleComponent(click('counter:menu'), fullGrant);
    expect(result).toMatchObject({ kind: 'component' });
    if (result?.kind === 'component') {
      expect(result.rows[0]!.buttons[0]!.id).toBe('counter:step:2');
    }
  });

  test('update-Result возвращается как есть (перезапись сообщения)', async () => {
    const result = await makeButtonInteractor().handleComponent(click('counter:reset'), {
      preconditions: { owners: ['user1'] },
      granted: new Set([]),
    });
    expect(result).toEqual({ kind: 'update', result: { kind: 'message', content: 'сброшен' } });
  });
});

describe('withCustomIds', () => {
  test('проставляет <handler>:<id> кнопкам, ссылки не трогает', () => {
    const out = withCustomIds({
      kind: 'component',
      rows: [
        { buttons: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
        { buttons: [{ id: 'link', label: 'X', url: 'https://x.example' }] },
      ],
    }, 'roll');
    expect(out.kind).toBe('component');
    if (out.kind === 'component') {
      expect(out.rows[0]!.buttons.map((b) => b.id)).toEqual(['roll:a', 'roll:b']);
      // link-кнопка: id остаётся как задекларирован, без префикса
      expect(out.rows[1]!.buttons[0]!.id).toBe('link');
    }
  });

  test('рекурсивно для multiple и update', () => {
    const out = withCustomIds({
      kind: 'update',
      result: {
        kind: 'multiple',
        results: [
          { kind: 'message', content: 'x' },
          { kind: 'component', rows: [{ buttons: [{ id: 'page:2', label: '2' }] }] },
        ],
      },
    }, 'list');
    expect(out.kind).toBe('update');
    if (out.kind === 'update') {
      const inner = out.result;
      expect(inner.kind).toBe('multiple');
      if (inner.kind === 'multiple') {
        const comp = inner.results[1];
        expect(comp?.kind).toBe('component');
        if (comp?.kind === 'component') expect(comp.rows[0]!.buttons[0]!.id).toBe('list:page:2');
      }
    }
  });

  test('не-компонентные Result — без изменений', () => {
    expect(withCustomIds({ kind: 'message', content: 'hi' }, 'x')).toEqual({ kind: 'message', content: 'hi' });
  });
});
