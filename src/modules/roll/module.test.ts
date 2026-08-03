import { describe, expect, test } from 'bun:test';
import { runHandler } from '../../core/testing.ts';
import module from './module.ts';

describe('модуль roll', () => {
  const handler = module.handlers.find((h) => h.name === 'roll')!;

  test('дефолт: 2d6', async () => {
    const result = await runHandler(handler, { args: {} });
    expect(result).toMatchObject({ kind: 'message' });
    if (result.kind === 'message') {
      expect(result.content).toMatch(/^🎲 2d6 → \[.*\] = \*\*\d+\*\*$/);
    }
  });

  test('явная формула', async () => {
    const result = await runHandler(handler, { args: { dice: '1d20' } });
    if (result.kind === 'message') {
      expect(result.content).toMatch(/^🎲 1d20 → \[\d+\] = \*\*\d+\*\*$/);
    }
  });

  test('инвалидная формула → ephemeral-ошибка', async () => {
    const result = await runHandler(handler, { args: { dice: 'abc' } });
    expect(result).toMatchObject({ kind: 'message', ephemeral: true });
    if (result.kind === 'message') {
      expect(result.content).toContain('Не понял формулу');
    }
  });

  test('слишком много кубиков отклоняется', async () => {
    const result = await runHandler(handler, { args: { dice: '101d6' } });
    if (result.kind === 'message') {
      expect(result.content).toContain('Не понял формулу');
    }
  });
});
