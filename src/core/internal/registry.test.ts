import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { defineHandler, defineModule } from '../index.ts';
import { Registry } from './registry.ts';

const discoveredModuleNames = (): string[] =>
  readdirSync('src/modules', { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join('src/modules', e.name, 'module.ts')))
    .map((e) => e.name)
    .sort();

describe('Registry.register', () => {
  test('находит модуль и команду', () => {
    const registry = new Registry();
    registry.register(defineModule({
      name: 'demo',
      description: 'Демо',
      handlers: [
        defineHandler({ name: 'demo', description: 'Команда', run: () => ({ kind: 'message', content: 'ok' }) }),
      ],
    }));

    expect(registry.size).toBe(1);
    expect(registry.findModule('demo')).toBeDefined();
    const found = registry.findHandler('demo');
    expect(found?.module.name).toBe('demo');
    expect(found?.handler.name).toBe('demo');
  });

  test('дубликат имени модуля бросает', () => {
    const registry = new Registry();
    registry.register(defineModule({ name: 'm', handlers: [] }));
    expect(() =>
      registry.register(defineModule({ name: 'm', handlers: [] })),
    ).toThrow('Дубликат');
  });

  test('дубликат команды бросает с владельцем', () => {
    const registry = new Registry();
    registry.register(defineModule({
      name: 'a',
      handlers: [defineHandler({ name: 'x', description: 'x', run: () => ({ kind: 'message', content: '1' }) })],
    }));
    expect(() =>
      registry.register(defineModule({
        name: 'b',
        handlers: [defineHandler({ name: 'x', description: 'x', run: () => ({ kind: 'message', content: '2' }) })],
      })),
    ).toThrow('уже объявлена в модуле a');
  });

  test('дубликат компонента в handler бросает', () => {
    const registry = new Registry();
    expect(() =>
      registry.register(defineModule({
        name: 'm',
        handlers: [defineHandler({
          name: 'x',
          description: 'x',
          components: [
            { id: 'a', run: () => ({ kind: 'message', content: '1' }) },
            { id: 'a', run: () => ({ kind: 'message', content: '2' }) },
          ],
          run: () => ({ kind: 'message', content: 'ok' }),
        })],
      })),
    ).toThrow('Дубликат компонента');
  });

  test('id компонента с ":" бросает', () => {
    const registry = new Registry();
    expect(() =>
      registry.register(defineModule({
        name: 'm',
        handlers: [defineHandler({
          name: 'x',
          description: 'x',
          components: [{ id: 'a:b', run: () => ({ kind: 'message', content: '1' }) }],
          run: () => ({ kind: 'message', content: 'ok' }),
        })],
      })),
    ).toThrow("не должен содержать ':'");
  });
});

describe('Registry.findComponent', () => {
  function makeRegistry() {
    const registry = new Registry();
    registry.register(defineModule({
      name: 'demo',
      handlers: [
        defineHandler({
          name: 'roll',
          description: 'бросок',
          components: [
            { id: 'reroll', run: () => ({ kind: 'message', content: 'ещё' }) },
            { id: 'step', run: () => ({ kind: 'message', content: 'шаг' }) },
          ],
          run: () => ({ kind: 'message', content: 'ok' }),
        }),
      ],
    }));
    return registry;
  }

  test('роутит exact-клик: <handler>:<id>', () => {
    const found = makeRegistry().findComponent('roll:reroll');
    expect(found?.module.name).toBe('demo');
    expect(found?.handler.name).toBe('roll');
    expect(found?.component.id).toBe('reroll');
    expect(found?.payload).toBe('');
  });

  test('payload после второго двоеточия', () => {
    const found = makeRegistry().findComponent('roll:step:2');
    expect(found?.component.id).toBe('step');
    expect(found?.payload).toBe('2');
  });

  test('payload с двоеточиями сохраняется целиком', () => {
    const found = makeRegistry().findComponent('roll:step:a:b');
    expect(found?.component.id).toBe('step');
    expect(found?.payload).toBe('a:b');
  });

  test('неизвестный handler → undefined', () => {
    expect(makeRegistry().findComponent('nope:id')).toBeUndefined();
  });

  test('неизвестный компонент → undefined', () => {
    expect(makeRegistry().findComponent('roll:missing')).toBeUndefined();
  });

  test('без двоеточия → undefined', () => {
    expect(makeRegistry().findComponent('roll')).toBeUndefined();
  });
});

describe('Registry.discover', () => {
  test('находит встроенные модули по конвенции', async () => {
    const registry = new Registry();
    await registry.discover('src/modules');
    const names = registry.getModules().map((m) => m.name).sort();
    expect(names).toEqual(discoveredModuleNames());
    const roll = registry.findHandler('roll');
    expect(roll).toBeDefined();
    expect(roll?.module.name).toBe('roll');
  });
});
