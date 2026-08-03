import { describe, expect, test } from 'bun:test';
import { runComponent, runHandler } from '../../core/testing.ts';
import module from './module.ts';

describe('модуль buttons', () => {
  const handler = module.handlers.find((h) => h.name === 'counter')!;

  test('/counter стартует с заданным значением', async () => {
    const result = await runHandler(handler, { args: { start: 5 } });
    expect(result).toMatchObject({ kind: 'component', content: '**Счётчик:** 5' });
    if (result.kind === 'component') {
      const ids = result.rows.flatMap((r) => r.buttons.map((b) => b.id));
      expect(ids).toEqual(['step:1', 'step:-1', 'reset']);
    }
  });

  test('/counter без start — с нуля', async () => {
    const result = await runHandler(handler, { args: {} });
    if (result.kind === 'component') expect(result.content).toBe('**Счётчик:** 0');
  });

  test('кнопка step:1 прибавляет', async () => {
    const result = await runComponent(handler, { id: 'step', customId: 'counter:step:1' });
    expect(result).toMatchObject({ kind: 'update' });
    if (result.kind === 'update' && result.result.kind === 'component') {
      expect(result.result.content).toBe('**Счётчик:** 1');
    }
  });

  test('кнопка step:-1 вычитает, payload — шаг', async () => {
    const result = await runComponent(handler, { id: 'step', customId: 'counter:step:-1' });
    if (result.kind === 'update' && result.result.kind === 'component') {
      expect(result.result.content).toBe('**Счётчик:** -1');
    }
  });

  test('кнопка reset обнуляет', async () => {
    const result = await runComponent(handler, { id: 'reset' });
    expect(result).toMatchObject({ kind: 'update' });
    if (result.kind === 'update' && result.result.kind === 'component') {
      expect(result.result.content).toBe('**Счётчик:** 0');
    }
  });
});
