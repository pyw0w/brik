import { describe, expect, test } from 'bun:test';
import { createContext, runHandler } from '../../core/testing.ts';
import module from './module.ts';

describe('модуль help', () => {
  test('пустой список команд', async () => {
    module.setup?.({
      ...createContext(),
      commands: { list: () => [] },
      options: {},
    });
    const handler = module.handlers.find((h) => h.name === 'help')!;
    const result = await runHandler(handler, { args: {} });
    expect(result).toMatchObject({ kind: 'message' });
    if (result.kind === 'message') {
      expect(result.content).toContain('Команд пока нет');
    }
  });

  test('сортированный список команд', async () => {
    module.setup?.({
      ...createContext(),
      commands: {
        list: () => [
          { name: 'roll', description: 'Кубики' },
          { name: 'ping', description: 'Проверка связи' },
        ],
      },
      options: {},
    });
    const handler = module.handlers.find((h) => h.name === 'help')!;
    const result = await runHandler(handler, { args: {} });
    if (result.kind === 'message') {
      expect(result.content.indexOf('/ping')).toBeLessThan(result.content.indexOf('/roll'));
      expect(result.content).toContain('/roll — Кубики');
    }
  });
});
