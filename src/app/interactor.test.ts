import { describe, expect, test } from 'bun:test';
import type { InteractionEnv } from '../core/discord/adapter.ts';
import { arg, defineHandler, defineModule } from '../core/index.ts';
import { createLogger } from '../core/internal/logger.ts';
import { Pipeline } from '../core/internal/pipeline.ts';
import { Registry } from '../core/internal/registry.ts';
import { InMemoryChannelMemory, MemoryStore } from '../core/internal/store.ts';
import { createInput } from '../core/testing.ts';
import { InteractionInteractor } from './interactor.ts';

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
    });
    const result = await interactor.handle(createInput({ commandName: 'nostore' }), fullGrant);
    expect(result).toBeUndefined();
  });
});
