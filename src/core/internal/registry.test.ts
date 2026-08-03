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
