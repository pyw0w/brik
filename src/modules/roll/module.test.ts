import { describe, expect, test } from 'bun:test';
import { runComponent, runHandler } from '../../core/testing.ts';
import module from './module.ts';

describe('модуль roll', () => {
  const handler = module.handlers.find((h) => h.name === 'roll')!;

  test('дефолт: 2d6 с кнопкой переброса', async () => {
    const result = await runHandler(handler, { args: {} });
    expect(result).toMatchObject({ kind: 'component' });
    if (result.kind === 'component') {
      expect(result.content).toMatch(/^🎲 2d6 → \[.*\] = \*\*\d+\*\*$/);
      expect(result.rows[0]?.buttons[0]).toMatchObject({ id: 'reroll', label: '🎲 Ещё раз' });
    }
  });

  test('явная формула', async () => {
    const result = await runHandler(handler, { args: { dice: '1d20' } });
    if (result.kind === 'component') {
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

  test('кнопка «Ещё раз» перебрасывает и возвращает update', async () => {
    const result = await runComponent(handler, { id: 'reroll' });
    expect(result).toMatchObject({ kind: 'update' });
    if (result.kind === 'update') {
      expect(result.result).toMatchObject({ kind: 'component' });
      if (result.result.kind === 'component') {
        expect(result.result.content).toMatch(/^🎲 2d6 → \[.*\] = \*\*\d+\*\*$/);
      }
    }
  });
});
